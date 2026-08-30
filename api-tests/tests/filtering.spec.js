import { test, expect } from '../fixtures/api-fixtures.js';
import { createBooking, getBookingIds } from '../helpers/http.js';
import { BookingIdsSchema, validate } from '../helpers/schemas.js';
import { randomBooking, randomDateRange } from '../helpers/data-builders.js';

async function createTaggedBooking(request, overrides) {
  const booking = randomBooking(overrides);
  const res = await createBooking(request, booking);
  const { bookingid } = await res.json();
  return { id: bookingid, booking };
}

test.describe('Booking filtering', () => {
  test('GET /booking filtered by firstname/lastname returns exactly the matching bookings', async ({
    request,
    authedApi,
  }) => {
    const match = await createTaggedBooking(request);
    const nonMatch = await createTaggedBooking(request); // distinct random names

    try {
      const res = await getBookingIds(request, {
        firstname: match.booking.firstname,
        lastname: match.booking.lastname,
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      validate(BookingIdsSchema, body);
      const ids = body.map((b) => b.bookingid);

      expect(ids).toContain(match.id);
      expect(ids).not.toContain(nonMatch.id);
    } finally {
      await authedApi.delete(match.id);
      await authedApi.delete(nonMatch.id);
    }
  });

  test('GET /booking filtered by checkin/checkout date range returns exactly the matching bookings', async ({
    request,
    authedApi,
  }) => {
    // BUG-6: date-range filtering is broken. Verified manually: `checkin`
    // alone always returns an empty array, `checkout` alone ignores the
    // filter and returns every booking, and combining both drops bookings
    // that should match (a range wide enough to cover every existing
    // booking still excluded several of them).
    test.fail(
      true,
      'BUG-6: GET /booking date-range filtering does not correctly match by checkin/checkout'
    );

    const inRange = await createTaggedBooking(request, { bookingdates: randomDateRange(0, 3) });
    const outOfRange = await createTaggedBooking(request, {
      bookingdates: randomDateRange(365, 3),
    });

    try {
      const res = await getBookingIds(request, {
        checkin: inRange.booking.bookingdates.checkin,
        checkout: inRange.booking.bookingdates.checkout,
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      validate(BookingIdsSchema, body);
      const ids = body.map((b) => b.bookingid);

      expect(ids).toContain(inRange.id);
      expect(ids).not.toContain(outOfRange.id);
    } finally {
      await authedApi.delete(inRange.id);
      await authedApi.delete(outOfRange.id);
    }
  });
});
