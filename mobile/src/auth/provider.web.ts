import { getAuth, RecaptchaVerifier, signInWithCustomToken, signInWithPhoneNumber, signOut, type ConfirmationResult } from 'firebase/auth';
import { ApiError } from '../api/client';
import { logger } from '../core/logging';
import { firebaseWebApp, firebaseWebConfig } from '../firebaseWeb';
import { devProvider, type OtpProvider } from './devProvider';
import { firebaseWebSendError } from './firebaseWebErrors';
import { autoProvider } from './serverProvider';

/**
 * Website sign-in. When the server sends OTPs itself (SMS gateway), that is used; otherwise Firebase phone auth through the browser SDK with an invisible reCAPTCHA.
 * (the site's domain must then be listed under Firebase > Authentication > Settings > Authorized domains).
 */
const firebaseWebProvider = (): OtpProvider => {
  const config = firebaseWebConfig;
  const auth = () => getAuth(firebaseWebApp());
  let confirmation: ConfirmationResult | null = null;
  let verifier: RecaptchaVerifier | null = null;
  const holder = () => {
    let el = document.getElementById('recaptcha-holder');
    if (!el) { el = document.createElement('div'); el.id = 'recaptcha-holder'; document.body.appendChild(el); }
    return el;
  };
  return {
    mode: 'firebase',
    async sendOtp(phone) {
      try {
        const a = auth();
        verifier?.clear();
        verifier = new RecaptchaVerifier(a, holder(), { size: 'invisible' });
        confirmation = await signInWithPhoneNumber(a, `+91${phone}`, verifier);
      } catch (e) {
        try { verifier?.clear(); } catch { /* the verifier may not have rendered */ }
        verifier = null;
        confirmation = null;
        const mapped = firebaseWebSendError(e);
        logger.warn('web otp send failed', { code: mapped.code });
        throw mapped;
      }
    },
    async confirmOtp(code) {
      if (!confirmation) throw new ApiError(0, 'no_challenge', 'Please request a new OTP.');
      try { await confirmation.confirm(code); } catch { throw new ApiError(401, 'invalid_otp', 'Incorrect OTP'); }
      const token = await auth().currentUser?.getIdToken();
      if (!token) throw new ApiError(401, 'no_token', 'Sign in failed. Please try again.');
      return token;
    },
    async getToken() {
      if (!config) return null;
      const a = auth();
      await a.authStateReady();
      try { return (await a.currentUser?.getIdToken()) ?? null; } catch { return null; }
    },
    async refreshToken() {
      if (!config) return null;
      try { return (await auth().currentUser?.getIdToken(true)) ?? null; } catch { return null; }
    },
    signOut: async () => { try { await signOut(auth()); } catch { /* already signed out */ } },
    async signInWithCustomToken(token) {
      const cred = await signInWithCustomToken(auth(), token);
      return cred.user.getIdToken();
    },
  };
};

const mode = (process.env.EXPO_PUBLIC_AUTH_MODE ?? 'firebase') as 'dev' | 'firebase';
export const otpProvider: OtpProvider = mode === 'dev' ? devProvider() : autoProvider(firebaseWebProvider());
