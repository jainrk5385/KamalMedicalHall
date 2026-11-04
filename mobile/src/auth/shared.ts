import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { SignupProfile } from '../api/types';

export interface OtpProvider {
  mode: 'sms';

  sendOtp(
    phone: string,
    purpose?: 'login' | 'signup'
  ): Promise<{ testMode: boolean }>;

  confirmOtp(
    code: string,
    profile?: SignupProfile
  ): Promise<string>;

  getToken(): Promise<string | null>;

  refreshToken(): Promise<string | null>;

  signOut(): Promise<void>;
}

export const secure = {
  get: (key: string): Promise<string | null> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
      : SecureStore.getItemAsync(key),

  set: (key: string, value: string): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(void globalThis.localStorage?.setItem(key, value))
      : SecureStore.setItemAsync(key, value),

  del: (key: string): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(void globalThis.localStorage?.removeItem(key))
      : SecureStore.deleteItemAsync(key),
};