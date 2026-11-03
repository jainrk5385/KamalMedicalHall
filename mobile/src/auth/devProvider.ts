
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';

export interface OtpProvider {
  mode: 'dev' | 'firebase' | 'sms';

  sendOtp(
    phone: string,
    purpose?: 'login' | 'signup'
  ): Promise<void>;

  confirmOtp(code: string): Promise<string>;

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

    async sendOtp(p, pPurpose) {
      phone = p;
      purpose = pPurpose ?? 'login';
    },

    async confirmOtp(code) {
      try {
        const { token } = await endpoints.devLogin(
          phone,
          code,
          purpose
        );

        await secure.set(TOKEN_KEY, token);

        return token;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          throw new ApiError(
            401,
            'invalid_otp',
            'Incorrect OTP'
          );
        }

        throw e;
      }
    },

    getToken: () => secure.get(TOKEN_KEY),

    refreshToken: async () => null,

    signOut: () => secure.del(TOKEN_KEY),
  };
};
