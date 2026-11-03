
import { ApiError } from '../api/client';
import { logger } from '../core/logging';
import type { OtpProvider } from './devProvider';

function otpError(e: unknown, step: 'send' | 'confirm'): ApiError {
  const code = String(
    (e as { code?: string })?.code ?? 'unknown'
  ).replace('auth/', '');

  logger.warn(`otp ${step} failed`, { code });

  const message =
    code === 'invalid-phone-number'
      ? 'Please enter a valid 10-digit mobile number.'
      : code === 'too-many-requests' || code === 'quota-exceeded'
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : code === 'network-request-failed'
          ? 'No internet connection. Please check your network and try again.'
          : code === 'invalid-verification-code'
            ? 'Incorrect OTP'
            : code === 'code-expired' || code === 'session-expired'
              ? 'This OTP has expired. Please request a new one.'
              : 'Could not complete OTP verification. Please try again.';

  return new ApiError(
    step === 'confirm' && message === 'Incorrect OTP' ? 401 : 0,
    step === 'confirm' ? 'invalid_otp' : `otp_${code}`,
    message
  );
}

const firebaseProvider = (): OtpProvider => {
  const fb = () =>
    require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');

  const auth = () => fb().getAuth();

  let confirmation: {
    confirm(code: string): Promise<unknown>;
  } | null = null;

  return {
    mode: 'firebase',

    async sendOtp(phone) {
      try {
        confirmation = await fb().signInWithPhoneNumber(
          auth(),
          `+91${phone}`
        );
      } catch (e) {
        throw otpError(e, 'send');
      }
    },

    async confirmOtp(code) {
      if (!confirmation) {
        throw new ApiError(
          0,
          'no_challenge',
          'Please request a new OTP.'
        );
      }

      try {
        await confirmation.confirm(code);
      } catch (e) {
        throw otpError(e, 'confirm');
      }

      const token = await auth().currentUser?.getIdToken();

      if (!token) {
        throw new ApiError(
          401,
          'no_token',
          'Sign in failed. Please try again.'
        );
      }

      return token;
    },

    async getToken() {
      try {
        return (await auth().currentUser?.getIdToken()) ?? null;
      } catch {
        return null;
      }
    },

    async refreshToken() {
      try {
        return (await auth().currentUser?.getIdToken(true)) ?? null;
      } catch {
        return null;
      }
    },

    async signOut() {
      try {
        await fb().signOut(auth());
      } catch {
        // Already signed out.
      }
    },

    async signInWithCustomToken(token) {
      await fb().signInWithCustomToken(auth(), token);

      const id = await auth().currentUser?.getIdToken();

      if (!id) {
        throw new ApiError(
          401,
          'no_token',
          'Sign in failed. Please try again.'
        );
      }

      return id;
    },
  };
};

export const otpProvider: OtpProvider = firebaseProvider();
