
import { create } from 'zustand';
import { ApiError, configureApi } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { AccountRequest, Gender, SignupProfile, User } from '../api/types';
import { otpProvider } from '../auth/provider';
import { setLanguage } from '../localization';
import { registerForPush, unregisterPush } from '../push';
import { setMonitoringUser } from '../monitoring';
import { connectRealtime, disconnectRealtime } from '../realtime';
import { logger } from '../core/logging';

interface SessionState {
  status: 'loading' | 'out' | 'in';
  user: User | null;
  accountRequest: AccountRequest | null;
  bootError: string | null;
  bootstrap: () => Promise<void>;
  login: (
    token: string,
    opts?: { purpose?: 'login' | 'signup'; profile?: SignupProfile }
  ) => Promise<{ needsProfile: boolean }>;
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

export const useSession = create<SessionState>((set, get) => ({
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

  

async login(token, opts) {
  let user: User;

  // try {
  //   const res = await endpoints.session(token, opts);
  //   user = res.user;
  // } catch (error) {
  //   await otpProvider.signOut();
  //   throw error;
  // }

  try {
  if (otpProvider.mode === 'dev') {
    const res = await endpoints.me({
      timeoutMs: 65000,
      retry: 'never',
    });
    user = res.user;
  } else {
    const res = await endpoints.session(token, opts);
    user = res.user;
  }
} catch (error) {
  await otpProvider.signOut();
  throw error;
}

  const profile = opts?.profile;

  if (opts?.purpose === 'signup' && profile) {
    const extra: {
      name?: string;
      email?: string;
      gender?: Gender | null;
      dateOfBirth?: string | null;
      city?: string;
    } = {};

    if (profile.name?.trim()) extra.name = profile.name.trim();
    if (profile.email?.trim()) extra.email = profile.email.trim();

    if (profile.gender !== undefined) {
      extra.gender = profile.gender;
    }

    if (profile.dateOfBirth !== undefined) {
      extra.dateOfBirth = profile.dateOfBirth;
    }

    if (profile.city) {
      extra.city = profile.city;
    }

    if (Object.keys(extra).length > 0) {
      try {
        const updated = await endpoints.updateMe(extra);
        user = updated.user;
      } catch (error) {
        logger.warn('signup profile update failed', {
          message: (error as Error).message,
        });
      }
    }
  }

  set({
    status: 'in',
    user,
    accountRequest: null,
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
    });
  },

  async deleteAccount() {
    await endpoints.deleteAccount();
    await otpProvider.signOut();
    disconnectRealtime();

    set({
      status: 'out',
      user: null,
      accountRequest: null,
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
