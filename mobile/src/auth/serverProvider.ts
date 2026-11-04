import { api } from '../api/client';
import type { SignupProfile } from '../api/types';
import { secure, type OtpProvider } from './shared';

const SESSION_KEY = 'kmh.sessionToken';
const AUTH_REQUEST_TIMEOUT_MS = 65_000;

export const serverOtpModes = ['sms'] as const;

export const serverProvider = (): OtpProvider => {
  let phone = '';
  let purpose: 'login' | 'signup' = 'login';

  return {
    mode: 'sms',

    async sendOtp(value, requestedPurpose) {
      phone = value;
      purpose = requestedPurpose ?? 'login';

      const response = await api<{
        sent: boolean;
        testMode?: boolean;
      }>(
        'POST',
        '/auth/otp/send',
        { phone, purpose },
        {
          auth: false,
          retry: 'never',
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        }
      );

      return {
        testMode: response.testMode === true,
      };
    },

    async confirmOtp(code, profile?: SignupProfile) {
      if (!phone) {
        throw new Error('Please enter your phone number first.');
      }

      const response = await api<{ token: string }>(
        'POST',
        '/auth/otp/verify',
        {
          phone,
          code,
          purpose,
          ...(purpose === 'signup' && profile ? { profile } : {}),
        },
        {
          auth: false,
          retry: 'never',
          timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
        }
      );

      if (!response.token) {
        throw new Error('OTP verification did not return a session token.');
      }

      await secure.set(SESSION_KEY, response.token);

      return response.token;
    },

    getToken: () => secure.get(SESSION_KEY),

    refreshToken: async () => null,

    signOut: () => secure.del(SESSION_KEY),
  };
};

export const autoProvider = (): OtpProvider => serverProvider();