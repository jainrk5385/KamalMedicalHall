/** An error from the API or the network, safe to show to a person: `message` never contains server internals. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) { super(message); this.name = 'ApiError'; }
  /** The request never got an answer (offline, timeout, DNS, TLS). */
  get isNetwork() { return this.status === 0; }
  get isAuth() { return this.status === 401; }
  get isServer() { return this.status >= 500; }
  get isRateLimited() { return this.status === 429; }
}

export const GENERIC_MESSAGES = {
  network: 'Cannot reach the server. Check your internet connection and try again.',
  timeout: 'The server is taking too long to answer. Please try again in a moment.',
  server: 'Something went wrong on our side. Please try again in a moment.',
  otpUnavailable: 'Phone verification is temporarily unavailable. Please try again in a moment or contact the store.',
  rateLimited: 'Too many requests. Please wait a moment and try again.',
  badResponse: 'The server sent an unexpected answer. Please try again.',
  generic: 'Something went wrong. Please try again.',
} as const;
