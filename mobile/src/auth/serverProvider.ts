import { api } from '../api/client';
import { ApiError, GENERIC_MESSAGES } from '../core/errors/ApiError';
import { logger } from '../core/logging';
import { secure, type OtpProvider } from './devProvider';

/**
 * OTP checked by our own server (its AUTH_MODE is "sms": the PearlSMS gateway, or the test code 123456 while the admin
 * has OTP delivery set to "test code"; or "twilio" for Twilio Verify).
 * Once the code is right the server returns a Firebase custom token: the app signs in to Firebase Authentication with
 * it and from then on uses Firebase ID tokens. If that sign-in fails (or an older server sends none), the server's
 * own 30-day session token is used instead.
 */
const SESSION_KEY = 'kmh.sessionToken';
const AUTH_REQUEST_TIMEOUT_MS = 65_000;
export const serverOtpModes = ['sms', 'twilio'];

export const serverProvider = (firebase?: OtpProvider): OtpProvider => {
  let phone = '';
  return {
    mode: 'sms',
    async sendOtp(p, purpose) {
      phone = p;
      await api<void>('POST', '/auth/otp/send', { phone: p, purpose }, { auth: false, retry: 'never', timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
    },
    async confirmOtp(code) {
      const { token, firebaseToken } = await api<{ token: string; firebaseToken?: string }>('POST', '/auth/otp/verify', { phone, code }, { auth: false, retry: 'never', timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
      if (firebaseToken && firebase?.signInWithCustomToken) {
        try {
          const idToken = await firebase.signInWithCustomToken(firebaseToken);
          await secure.del(SESSION_KEY); // the Firebase session is used from now on
          return idToken;
        } catch (e) {
          logger.warn('firebase custom sign-in failed, using the server session', { code: String((e as { code?: string })?.code ?? 'unknown') });
        }
      }
      await secure.set(SESSION_KEY, token);
      return token;
    },
    getToken: () => secure.get(SESSION_KEY),
    refreshToken: async () => null, // after 30 days the person signs in again
    signOut: () => secure.del(SESSION_KEY),
  };
};

/**
 * Lets the server decide how OTPs are sent, so switching needs no new app version: before each send it asks
 * /config, and uses the server OTP or the given Firebase provider. A stored server session wins at start-up.
 */
export const autoProvider = (firebase: OtpProvider): OtpProvider => {
  const server = serverProvider(firebase);
  let active: OtpProvider = firebase;
  return {
    get mode() { return active.mode; },
    async sendOtp(phone, purpose) {
      // The server is the source of truth for production OTP mode. Falling back to
      // Firebase when this request fails hides backend outages and can misroute a
      // phone that the server is configured to verify through SMS.
      const { authMode } = await api<{ authMode?: string }>('GET', '/config', undefined, { auth: false, retry: 'never', timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
      if (serverOtpModes.includes(authMode ?? '')) active = server;
      else if (authMode === 'firebase') active = firebase;
      else throw new ApiError(503, 'auth_mode_unavailable', GENERIC_MESSAGES.otpUnavailable);
      return active.sendOtp(phone, purpose);
    },
    confirmOtp: (code) => active.confirmOtp(code),
    async getToken() { return (await server.getToken()) ?? firebase.getToken(); },
    async refreshToken() { return (await server.getToken()) ? null : firebase.refreshToken(); },
    async signOut() { await Promise.all([server.signOut(), firebase.signOut()]); },
  };
};
