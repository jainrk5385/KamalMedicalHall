
import { api } from '../api/client';
import { ApiError, GENERIC_MESSAGES } from '../core/errors/ApiError';
import { logger } from '../core/logging';
import { secure, type OtpProvider } from './devProvider';

const SESSION_KEY = 'kmh.sessionToken';
const AUTH_REQUEST_TIMEOUT_MS = 65_000;

export const serverOtpModes = ['sms', 'twilio'];

export const serverProvider = (firebase?: OtpProvider): OtpProvider => {
  let phone = '';
  let purpose: 'login' | 'signup' = 'login';

  return {
    mode: 'sms',

    async sendOtp(p, pPurpose) {
      phone = p;
      purpose = pPurpose ?? 'login';

      await api<void>(
        'POST',
        '/auth/otp/send',
        { phone, purpose },
        { auth: false, retry: 'never', timeoutMs: AUTH_REQUEST_TIMEOUT_MS }
      );
    },

    async confirmOtp(code) {
      const { token, firebaseToken } = await api<{
        token: string;
        firebaseToken?: string;
      }>(
        'POST',
        '/auth/otp/verify',
        { phone, code, purpose },
        { auth: false, retry: 'never', timeoutMs: AUTH_REQUEST_TIMEOUT_MS }
      );

      if (firebaseToken && firebase?.signInWithCustomToken) {
        try {
          const idToken = await firebase.signInWithCustomToken(firebaseToken);
          await secure.del(SESSION_KEY);
          return idToken;
        } catch (e) {
          logger.warn('firebase custom sign-in failed; using server session', {
            code: String((e as { code?: string })?.code ?? 'unknown'),
          });
        }
      }

      await secure.set(SESSION_KEY, token);
      return token;
    },

    getToken: () => secure.get(SESSION_KEY),

    refreshToken: async () => null,

    signOut: () => secure.del(SESSION_KEY),
  };
};


export const autoProvider = (firebase: OtpProvider): OtpProvider => {
  const dev = devProvider();

  return {
    mode: 'dev',

    sendOtp(phone, purpose) {
      return dev.sendOtp(phone, purpose);
    },

    confirmOtp(code) {
      return dev.confirmOtp(code);
    },

    getToken() {
      return dev.getToken();
    },

    refreshToken() {
      return dev.refreshToken();
    },

    signOut() {
      return dev.signOut();
    },
  };
};

