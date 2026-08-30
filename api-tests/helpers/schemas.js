import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const BookingDatesSchema = z.object({
  checkin: dateString,
  checkout: dateString,
});

export const BookingSchema = z.object({
  firstname: z.string(),
  lastname: z.string(),
  totalprice: z.number(),
  depositpaid: z.boolean(),
  bookingdates: BookingDatesSchema,
  additionalneeds: z.string().optional(),
});

export const CreateBookingResponseSchema = z.object({
  bookingid: z.number(),
  booking: BookingSchema,
});

export const AuthTokenSchema = z.object({
  token: z.string().min(1),
});

export const BookingIdsSchema = z.array(
  z.object({
    bookingid: z.number(),
  })
);

/**
 * Validates data against a schema and throws a readable error (including the
 * raw payload) on mismatch, so a schema failure points straight at the bad
 * field instead of a generic assertion failure.
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Schema validation failed: ${result.error.message}\nReceived: ${JSON.stringify(data)}`
    );
  }
  return result.data;
}
