import { test as base, expect, request as pwRequest } from '@playwright/test';
import { env } from '../config/env.js';
import { createToken, createBooking, deleteBooking } from '../helpers/http.js';
import { randomBooking } from '../helpers/data-builders.js';

export const test = base.extend({
  // Worker-scoped raw request context, independent of the test-scoped `request`
  // fixture (a worker-scoped fixture can't depend on a test-scoped one), used
  // only to mint the auth token once per worker.
  apiRequestContext: [
    // Playwright requires the destructured object literal here (even with no
    // dependencies) to detect this fixture's dependency list at the source level.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const context = await pwRequest.newContext({ baseURL: env.baseURL });
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  // One valid token per worker — token creation is idempotent (no state
  // mutation), so sharing it across a worker's tests is safe and avoids
  // hammering /auth on every test.
  authToken: [
    async ({ apiRequestContext }, use) => {
      const res = await createToken(apiRequestContext, env.auth);
      if (!res.ok()) {
        throw new Error(`Failed to create auth token: ${res.status()} ${await res.text()}`);
      }
      const { token } = await res.json();
      await use(token);
    },
    { scope: 'worker' },
  ],

  // Convenience wrapper exposing authenticated put/patch/delete against
  // /booking/{id}, built on the test-scoped `request` fixture + worker authToken.
  authedApi: async ({ request, authToken }, use) => {
    await use({
      token: authToken,
      put: (id, booking) =>
        request.put(`/booking/${id}`, {
          data: booking,
          headers: { Cookie: `token=${authToken}` },
        }),
      patch: (id, partialBooking) =>
        request.patch(`/booking/${id}`, {
          data: partialBooking,
          headers: { Cookie: `token=${authToken}` },
        }),
      delete: (id) =>
        request.delete(`/booking/${id}`, {
          headers: { Cookie: `token=${authToken}` },
        }),
    });
  },

  // Creates a fresh, uniquely-tagged booking before the test and guarantees
  // its deletion afterward, so a test that deletes it mid-test (e.g. the CRUD
  // lifecycle test) doesn't cause teardown to fail on a second delete.
  seededBooking: async ({ request, authedApi }, use) => {
    const booking = randomBooking();
    const createRes = await createBooking(request, booking);
    expect(createRes.ok(), `Failed to seed booking: ${createRes.status()}`).toBeTruthy();
    const { bookingid } = await createRes.json();

    await use({ id: bookingid, booking });

    const res = await deleteBooking(request, bookingid, authedApi.token);
    // 404 is the sane "already gone" response; 405 is what the API actually
    // returns for a missing/already-deleted booking (BUG-2, tracked in
    // crud.spec.js) — tolerated here so a test that deletes its own seeded
    // booking mid-test doesn't fail teardown on the redundant delete.
    if (!res.ok() && res.status() !== 404 && res.status() !== 405) {
      throw new Error(`Teardown failed to delete booking ${bookingid}: ${res.status()}`);
    }
  },
});

export { expect };
