
import {
  getAuth,
  RecaptchaVerifier,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth';

import { ApiError } from '../api/client';
import { logger } from '../core/logging';
import { firebaseWebApp, firebaseWebConfig } from '../firebaseWeb';
import type { OtpProvider } from './devProvider';
import { firebaseWebSendError } from './firebaseWebErrors';

const firebaseWebProvider = (): OtpProvider => {
  const config = firebaseWebConfig;
  const auth = () => getAuth(firebaseWebApp());

  let confirmation: ConfirmationResult | null = null;
  let verifier: RecaptchaVerifier | null = null;

  const holder = () => {
    let el = document.getElementById('recaptcha-holder');

    if (!el) {
      el = document.createElement('div');
      el.id = 'recaptcha-holder';
      document.body.appendChild(el);
    }

    return el;
  };

  return {
    mode: 'firebase',

    async sendOtp(phone) {
      try {
        const a = auth();

        verifier?.clear();

        verifier = new RecaptchaVerifier(
          a,
          holder(),
          { size: 'invisible' }
        );

        confirmation = await signInWithPhoneNumber(
          a,
          `+91${phone}`,
          verifier
        );
      } catch (e) {
        try {
          verifier?.clear();
        } catch {
          // Verifier may not have rendered.
        }

        verifier = null;
        confirmation = null;

        const mapped = firebaseWebSendError(e);

        logger.warn('web otp send failed', {
          code: mapped.code,
        });

        throw mapped;
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
      } catch {
        throw new ApiError(
          401,
          'invalid_otp',
          'Incorrect OTP'
        );
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
      if (!config) return null;

      const a = auth();
      await a.authStateReady();

      try {
        return (await a.currentUser?.getIdToken()) ?? null;
      } catch {
        return null;
      }
    },

    async refreshToken() {
      if (!config) return null;

      try {
        return (await auth().currentUser?.getIdToken(true)) ?? null;
      } catch {
        return null;
      }
    },

    async signOut() {
      try {
        await signOut(auth());
      } catch {
        // Already signed out.
      }
    },

    async signInWithCustomToken(token) {
      const cred = await signInWithCustomToken(auth(), token);
      return cred.user.getIdToken();
    },
  };
};

export const otpProvider: OtpProvider = firebaseWebProvider();
