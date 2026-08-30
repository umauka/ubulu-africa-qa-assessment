import { randomUUID } from 'node:crypto';

/**
 * Short unique tag per call, used to keep test-created records distinguishable
 * from Restful Booker's built-in sample data and from bookings created by
 * other tests/workers running in parallel.
 */
export function uniqueTag() {
  return randomUUID().slice(0, 8);
}

export function randomName(prefix = 'Qa') {
  return `${prefix}${uniqueTag()}`;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns a non-overlapping {checkin, checkout} date range, offset by
 * `offsetDays` from today so different tests/workers don't collide.
 */
export function randomDateRange(offsetDays = 0, lengthDays = 3) {
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + offsetDays);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + lengthDays);
  return { checkin: toISODate(checkin), checkout: toISODate(checkout) };
}

/** Inverted range for boundary testing: checkout before checkin. */
export function invertedDateRange(offsetDays = 0, lengthDays = 3) {
  const { checkin, checkout } = randomDateRange(offsetDays, lengthDays);
  return { checkin: checkout, checkout: checkin };
}

export function randomBooking(overrides = {}) {
  return {
    firstname: randomName('First'),
    lastname: randomName('Last'),
    totalprice: Math.floor(Math.random() * 1000),
    depositpaid: Math.random() < 0.5,
    bookingdates: randomDateRange(),
    additionalneeds: 'Breakfast',
    ...overrides,
  };
}
