
import { create } from 'zustand';
import { ApiError, configureApi } from '../api/client';
import { endpoints } from '../api/endpoints';
import type {
  AccountRequest,
  Gender,
  User,
} from '../api/types';
import { otpProvider } from '../auth/provider';
import { setLanguage } from '../localization';
import { registerForPush, unregisterPush } from '../push';
import { setMonitoringUser } from '../monitoring';
import {
  connectRealtime,
  disconnectRealtime,
} from '../realtime';

interface SessionState {
  status: 'loading' | 'out' | 'in';
  user: User | null;
  accountRequest: AccountRequest | null;
  bootError: string | null;
  bootstrap: () => Promise<void>;
  login: (token: string) => Promise<{ needsProfile: boolean }>;
  refresh: () => Promise<void>;
  updateProfile: (b: {
    name?: string;
    email?: string;
    language?: 'en' | 'hi';
    gender?: Gender | null;
    dateOfBirth?: string | null;
    city?: string;
  }) => Promise<void>;
  setAvatar: (publicId: string | null) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accountRequest: null,
  bootError: null,

  async bootstrap() {
    set({ status: 'loading', bootError: null });

    const token = await otpProvider.getToken();

    if (!token) {
      set({ status: 'out', user: null });
      return;
    }

    try {
      const { user, accountRequest } = await endpoints.me({
        timeoutMs: 65_000,
        retry: 'never',
      });

      set({
        status: 'in',
        user,
        accountRequest: accountRequest ?? null,
      });

      setMonitoringUser(user);
      connectRealtime();
      void registerForPush();
    } catch (error) {
      if (error instanceof ApiError && !error.isNetwork) {
        await otpProvider.signOut();
        set({ status: 'out', user: null });
        return;
      }

      set({
        status: 'out',
        bootError: (error as Error).message,
      });
    }
  },

  async login(_token) {
    let user: User;
    let accountRequest: AccountRequest | null = null;

    try {
      const res = await endpoints.me({
        timeoutMs: 65_000,
        retry: 'never',
      });

      user = res.user;
      accountRequest = res.accountRequest ?? null;
    } catch (error) {
      await otpProvider.signOut();
      throw error;
    }

    set({
      status: 'in',
      user,
      accountRequest,
      bootError: null,
    });

    setMonitoringUser(user);
    connectRealtime();
    void registerForPush();

    return {
      needsProfile: !user.name,
    };
  },

  async refresh() {
    try {
      const { user, accountRequest } = await endpoints.me();

      set({
        user,
        accountRequest: accountRequest ?? null,
      });
    } catch {
      // Keep existing session state.
    }
  },

  async updateProfile(b) {
    const { user } = await endpoints.updateMe(b);

    set({ user });

    if (b.language) {
      await setLanguage(b.language);
    }
  },

  async setAvatar(publicId) {
    const { user } = publicId
      ? await endpoints.setAvatar(publicId)
      : await endpoints.removeAvatar();

    set({ user });
  },

  async logout() {
    await unregisterPush();
    setMonitoringUser(null);
    await otpProvider.signOut();
    disconnectRealtime();

    set({
      status: 'out',
      user: null,
      accountRequest: null,
      bootError: null,
    });
  },

  async deleteAccount() {
    await endpoints.deleteAccount();
    await unregisterPush();
    setMonitoringUser(null);
    await otpProvider.signOut();
    disconnectRealtime();

    set({
      status: 'out',
      user: null,
      accountRequest: null,
      bootError: null,
    });
  },
}));

configureApi({
  getToken: () => otpProvider.getToken(),

  refreshToken: () => otpProvider.refreshToken(),

  onUnauthorized: () => {
    if (useSession.getState().status === 'in') {
      void useSession.getState().logout();
    }
  },

  onDeactivated: () => {
    if (useSession.getState().user?.isActive !== false) {
      void useSession.getState().refresh();
    }
  },
});
