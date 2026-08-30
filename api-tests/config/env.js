const baseURL = process.env.BASE_URL || 'http://localhost:3001';

const allowedHosts = new Set(['localhost', '127.0.0.1']);
const host = new URL(baseURL).hostname;
if (!allowedHosts.has(host)) {
  throw new Error(
    `Refusing to run: BASE_URL "${baseURL}" is not localhost/127.0.0.1. ` +
      'This suite must only ever target a local Restful Booker instance.'
  );
}

export const env = {
  baseURL,
  auth: {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'password123',
  },
  timeout: Number(process.env.API_TIMEOUT_MS) || 10_000,
};
