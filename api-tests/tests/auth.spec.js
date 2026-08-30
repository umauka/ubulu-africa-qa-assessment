import { test, expect } from '../fixtures/api-fixtures.js';
import { env } from '../config/env.js';
import { createToken } from '../helpers/http.js';
import { AuthTokenSchema, BookingSchema, validate } from '../helpers/schemas.js';
import { randomBooking } from '../helpers/data-builders.js';

test.describe('Authentication', () => {
  test('creates a token with valid credentials', async ({ request }) => {
    const res = await createToken(request, env.auth);
    expect(res.status()).toBe(200);
    validate(AuthTokenSchema, await res.json());
  });

  test('rejects token creation with invalid credentials', async ({ request }) => {
    const res = await createToken(request, {
      username: env.auth.username,
      password: 'wrong-password',
    });
    const body = await res.json();
    // restful-booker always answers 200 here; a bad login is signalled by the
    // body shape (no token, a "reason") rather than an HTTP error status.
    expect(
      AuthTokenSchema.safeParse(body).success,
      `expected no usable token in body, got: ${JSON.stringify(body)}`
    ).toBe(false);
    expect(body.token).toBeUndefined();
  });

  test('a valid token succeeds on a protected endpoint (PUT /booking/{id})', async ({
    seededBooking,
    authedApi,
  }) => {
    const updatedBooking = randomBooking();
    const res = await authedApi.put(seededBooking.id, updatedBooking);
    expect(res.status()).toBe(200);
    const body = await res.json();
    validate(BookingSchema, body);
    expect(body).toEqual(updatedBooking);
  });

  test('rejects a protected endpoint when no token is provided', async ({
    seededBooking,
    request,
  }) => {
    const res = await request.put(`/booking/${seededBooking.id}`, {
      data: randomBooking(),
    });
    expect(res.status()).toBe(403);
  });

  test('rejects a protected endpoint when the token is invalid/garbage', async ({
    seededBooking,
    request,
  }) => {
    const res = await request.put(`/booking/${seededBooking.id}`, {
      data: randomBooking(),
      headers: { Cookie: 'token=not-a-real-token-12345' },
    });
    expect(res.status()).toBe(403);
  });
});
