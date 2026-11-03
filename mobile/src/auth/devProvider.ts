
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';

export type SignupProfile = {
  name?: string;
  email?: string;
  gender?: 'male' | 'female' | 'other' | null;
  dateOfBirth?: string | null;
  city?: string;
};

export interface OtpProvider {
  mode: 'dev' | 'firebase' | 'sms';

  sendOtp(
    phone: string,
    purpose?: 'login' | 'signup'
  ): Promise<void>;

  confirmOtp(
    code: string,
    profile?: SignupProfile
  ): Promise<string>;

  getToken(): Promise<string | null>;

  refreshToken(): Promise<string | null>;

  signOut(): Promise<void>;

  signInWithCustomToken?(token: string): Promise<string>;
}

const TOKEN_KEY = 'kmh.devToken';

export const secure = {
  get: (k: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null)
      : SecureStore.getItemAsync(k),

  set: (k: string, v: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(void globalThis.localStorage?.setItem(k, v))
      : SecureStore.setItemAsync(k, v),

  del: (k: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(void globalThis.localStorage?.removeItem(k))
      : SecureStore.deleteItemAsync(k),
};

export const devProvider = (): OtpProvider => {
  let phone = '';
  let purpose: 'login' | 'signup' = 'login';

  return {
    mode: 'dev',

    // Local only: no SMS and no send API call
    async sendOtp(p, pPurpose) {
      phone = p;
      purpose = pPurpose ?? 'login';
    },

    // async confirmOtp(code, profile) {
    //   if (!phone) {
    //     throw new Error('Please enter your phone number first.');
    //   }

    //   try {
    //     const { token } = await endpoints.devLogin(
    //       phone,
    //       code,
    //       purpose,
    //       purpose === 'signup' ? profile : undefined
    //     );

    //     await secure.set(TOKEN_KEY, token);

    //     return token;
    //   } catch (e) {
    //     if (e instanceof ApiError && e.status === 401) {
    //       throw new ApiError(
    //         401,
    //         'invalid_otp',
    //         'Incorrect OTP'
    //       );
    //     }

    //     throw e;
    //   }
    // },
    async confirmOtp(code, profile) {
  console.log('1. DEV OTP CONFIRM CALLED');
  console.log('2. Phone:', phone);
  console.log('3. OTP:', code);
  console.log('4. Purpose:', purpose);

  if (!phone) {
    throw new Error('Please enter your phone number first.');
  }

  try {
    console.log('5. Calling /auth/otp/dev-login');

    const { token } = await endpoints.devLogin(
      phone,
      code,
      purpose,
      purpose === 'signup' ? profile : undefined
    );

    console.log('6. DEV LOGIN API SUCCESS');

    await secure.set(TOKEN_KEY, token);

    console.log('7. TOKEN SAVED');

    return token;
  } catch (e) {
    console.error('DEV LOGIN ERROR:', e);

    if (e instanceof ApiError && e.status === 401) {
      throw new ApiError(401, 'invalid_otp', 'Incorrect OTP');
    }

    throw e;
  }
},

    getToken: () => secure.get(TOKEN_KEY),

    refreshToken: async () => null,

    signOut: () => secure.del(TOKEN_KEY),
  };
};
