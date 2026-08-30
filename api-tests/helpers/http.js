/**
 * Thin wrappers around Playwright's APIRequestContext for the Restful Booker
 * endpoints. Return the raw APIResponse so callers/tests decide how strictly
 * to assert on status/body (important for negative-boundary tests).
 */

export function authHeader(token) {
  return { Cookie: `token=${token}` };
}

export async function createToken(request, { username, password }) {
  return request.post('/auth', { data: { username, password } });
}

export async function createBooking(request, booking) {
  return request.post('/booking', { data: booking });
}

export async function getBooking(request, id) {
  return request.get(`/booking/${id}`);
}

export async function getBookingIds(request, params = {}) {
  return request.get('/booking', { params });
}

export async function updateBooking(request, id, booking, token) {
  return request.put(`/booking/${id}`, {
    data: booking,
    headers: token ? authHeader(token) : undefined,
  });
}

export async function patchBooking(request, id, partialBooking, token) {
  return request.patch(`/booking/${id}`, {
    data: partialBooking,
    headers: token ? authHeader(token) : undefined,
  });
}

export async function deleteBooking(request, id, token) {
  return request.delete(`/booking/${id}`, {
    headers: token ? authHeader(token) : undefined,
  });
}
