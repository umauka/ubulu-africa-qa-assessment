import { test, expect } from '../fixtures/api-fixtures.js';
import { createBooking } from '../helpers/http.js';
import { randomBooking, invertedDateRange } from '../helpers/data-builders.js';

test.describe('Negative and boundary input handling', () => {
  test('rejects create with a missing required field', async ({ request }) => {
    // BUG-3: omitting a required field (firstname) causes a 500 Internal
    // Server Error instead of a 400 Bad Request. Confirmed no booking is
    // actually persisted despite the 500, so no cleanup is needed here.
    test.fail(true, 'BUG-3: POST /booking with a missing required field returns 500 instead of 400');

    const { firstname: _firstname, ...incomplete } = randomBooking();
    const res = await createBooking(request, incomplete);
    expect(res.status()).toBe(400);
  });

  test('rejects create with a wrong-typed field', async ({ request, authedApi }) => {
    // BUG-4: sending a string for a numeric field (totalprice) is accepted
    // (200) and the value is silently coerced to null instead of the
    // request being rejected with 400.
    test.fail(
      true,
      'BUG-4: POST /booking with totalprice as a string returns 200 and silently nulls the field'
    );

    const booking = randomBooking({ totalprice: 'not-a-number' });
    const res = await createBooking(request, booking);
    try {
      expect(res.status()).toBe(400);
    } finally {
      if (res.ok()) {
        const { bookingid } = await res.json();
        await authedApi.delete(bookingid);
      }
    }
  });

  test('rejects create where checkout is before checkin', async ({ request, authedApi }) => {
    // BUG-5: an inverted date range (checkout before checkin) is accepted
    // without any validation instead of being rejected with 400.
    test.fail(true, 'BUG-5: POST /booking with checkout before checkin returns 200 instead of 400');

    const booking = randomBooking({ bookingdates: invertedDateRange() });
    const res = await createBooking(request, booking);
    try {
      expect(res.status()).toBe(400);
    } finally {
      if (res.ok()) {
        const { bookingid } = await res.json();
        await authedApi.delete(bookingid);
      }
    }
  });

  test('handles SQLi-style input safely without executing or corrupting it', async ({
    request,
    authedApi,
  }) => {
    const payload = "Robert'); DROP TABLE bookings;--";
    const booking = randomBooking({ firstname: payload });
    const res = await createBooking(request, booking);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.booking.firstname).toBe(payload);

    // Round-trip via GET to prove the value wasn't mangled, stripped, or
    // executed — no injection occurred and the store isn't corrupted.
    const readRes = await request.get(`/booking/${body.bookingid}`);
    expect(readRes.status()).toBe(200);
    const readBody = await readRes.json();
    expect(readBody.firstname).toBe(payload);

    await authedApi.delete(body.bookingid);
  });
});
