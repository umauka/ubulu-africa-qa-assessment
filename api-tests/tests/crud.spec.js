import { test, expect } from '../fixtures/api-fixtures.js';
import { createBooking } from '../helpers/http.js';
import { BookingSchema, CreateBookingResponseSchema, validate } from '../helpers/schemas.js';
import { randomBooking } from '../helpers/data-builders.js';

test.describe('Booking CRUD lifecycle', () => {
  test('full lifecycle: create -> read -> update (PUT) -> partial update (PATCH) -> delete', async ({
    request,
    authedApi,
    seededBooking,
  }) => {
    const readRes = await request.get(`/booking/${seededBooking.id}`);
    expect(readRes.status()).toBe(200);
    validate(BookingSchema, await readRes.json());

    // Full update (PUT) replaces every field.
    const fullUpdate = randomBooking();
    const putRes = await authedApi.put(seededBooking.id, fullUpdate);
    expect(putRes.status()).toBe(200);
    const putBody = await putRes.json();
    validate(BookingSchema, putBody);
    expect(putBody).toEqual(fullUpdate);

    // Partial update (PATCH) changes only the given field(s), leaving the rest
    // as set by the preceding PUT.
    const patchRes = await authedApi.patch(seededBooking.id, { totalprice: 777 });
    expect(patchRes.status()).toBe(200);
    const patchBody = await patchRes.json();
    validate(BookingSchema, patchBody);
    expect(patchBody).toEqual({ ...fullUpdate, totalprice: 777 });

    // Delete. Status-code correctness (should be 200/204, not 201) is a known
    // defect tracked separately below (BUG-1) — here we only assert the
    // delete actually took effect.
    const deleteRes = await authedApi.delete(seededBooking.id);
    expect(deleteRes.ok()).toBeTruthy();

    const afterDelete = await request.get(`/booking/${seededBooking.id}`);
    expect(afterDelete.status()).toBe(404);
  });

  test('create response is schema-valid', async ({ request, authedApi }) => {
    const booking = randomBooking();
    const res = await createBooking(request, booking);
    const body = await res.json();
    try {
      expect(res.status()).toBe(200);
      validate(CreateBookingResponseSchema, body);
      expect(body.booking).toEqual(booking);
    } finally {
      await authedApi.delete(body.bookingid);
    }
  });

  test('read-after-create response is schema-valid', async ({ request, seededBooking }) => {
    const res = await request.get(`/booking/${seededBooking.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    validate(BookingSchema, body);
    expect(body).toEqual(seededBooking.booking);
  });

  test('DELETE returns a REST-correct success status', async ({ request, authedApi }) => {
    // BUG-1: DELETE /booking/{id} returns 201 Created instead of 200/204 on a
    // successful delete. 201 means "resource created", which is semantically
    // wrong for a delete — genuine defect, not a documented quirk.
    test.fail(true, 'BUG-1: DELETE /booking/{id} returns 201 Created instead of 200/204');

    const booking = randomBooking();
    const createRes = await createBooking(request, booking);
    const { bookingid } = await createRes.json();

    const deleteRes = await authedApi.delete(bookingid);
    expect([200, 204]).toContain(deleteRes.status());
  });

  test('deleting an already-deleted booking returns 404', async ({ request, authedApi }) => {
    // BUG-2: deleting a booking that doesn't exist (already deleted, or never
    // did) returns 405 Method Not Allowed instead of 404 Not Found.
    test.fail(true, 'BUG-2: DELETE on a missing booking returns 405 instead of 404');

    const booking = randomBooking();
    const createRes = await createBooking(request, booking);
    const { bookingid } = await createRes.json();
    await authedApi.delete(bookingid); // first delete succeeds

    const secondDelete = await authedApi.delete(bookingid);
    expect(secondDelete.status()).toBe(404);
  });
});
