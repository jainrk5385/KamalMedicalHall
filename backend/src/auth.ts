
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

import { config } from './config.js';
import { User } from './models/User.js';
import { HttpError, forbidden } from './http.js';

export type Role = 'customer' | 'admin' | 'delivery_partner';

export interface AuthUser {
  id: string;
  phone: string;
  role: Role;
  name: string | null;
  email: string | null;
  avatar_public_id?: string | null;
  avatar_resource_type?: string | null;
  is_active?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    verified?: {
      uid: string;
      phone: string;
    };
  }
}

/**
 * Firebase Cloud Messaging initialization.
 *
 * FCM is retained only for push notifications.
 * Firebase Phone Authentication is not used here.
 */
let messagingInstance: Messaging | null = null;
let firebaseAppInstance: App | null = null;

function firebaseApp(): App | null {
  if (firebaseAppInstance) {
    return firebaseAppInstance;
  }

  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '';

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? '';

  if (
    !serviceAccountJson ||
    process.env.PUSH === 'off' ||
    process.env.NODE_ENV === 'test'
  ) {
    return null;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);

    const existingApp = getApps().find(
      (app) => app.name === 'kamal-medical-hall-push',
    );

    firebaseAppInstance =
      existingApp ??
      initializeApp(
        {
          credential: cert(serviceAccount),
          ...(projectId ? { projectId } : {}),
        },
        'kamal-medical-hall-push',
      );

    return firebaseAppInstance;
  } catch (error) {
    console.error(
      'Firebase push initialization failed:',
      error,
    );

    return null;
  }
}

/**
 * Returns Firebase Messaging for push notifications.
 */
export function firebaseMessaging(): Messaging | null {
  if (messagingInstance) {
    return messagingInstance;
  }

  const app = firebaseApp();

  if (!app) {
    return null;
  }

  try {
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (error) {
    console.error(
      'Firebase Messaging initialization failed:',
      error,
    );

    return null;
  }
}

/**
 * Normalize Indian phone numbers.
 *
 * Supported formats:
 * +91XXXXXXXXXX
 * 91XXXXXXXXXX
 * XXXXXXXXXX
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  const ten =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits;

  if (!/^[6-9]\d{9}$/.test(ten)) {
    throw new HttpError(
      422,
      'invalid_phone',
      'Enter a valid 10-digit Indian mobile number',
    );
  }

  return ten;
}

/**
 * Sign a session token after Pearl SMS OTP verification.
 */
export function signSessionToken(phone: string): string {
  const normalizedPhone = normalisePhone(phone);

  return jwt.sign(
    {
      sub: `sms-${normalizedPhone}`,
      phone: normalizedPhone,
    },
    config.jwtSecret,
    {
      expiresIn: '30d',
    },
  );
}

/**
 * Verify application JWT session tokens only.
 * Firebase Phone Authentication tokens are not accepted.
 */
export async function verifyToken(
  token: string,
): Promise<{ uid: string; phone: string }> {
  const payload = jwt.verify(
    token,
    config.jwtSecret,
  ) as {
    sub?: string;
    phone?: string;
  };

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.phone !== 'string' ||
    !payload.sub.startsWith('sms-')
  ) {
    throw new Error('Invalid SMS session token');
  }

  const phone = normalisePhone(payload.phone);

  if (payload.sub !== `sms-${phone}`) {
    throw new Error('Session phone mismatch');
  }

  return {
    uid: payload.sub,
    phone,
  };
}

/**
 * Verify bearer token only.
 * User record is not required at this stage.
 */
export async function verified(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(
      401,
      'unauthenticated',
      'Please sign in',
    );
  }

  try {
    req.verified = await verifyToken(header.slice(7));
  } catch {
    throw new HttpError(
      401,
      'invalid_token',
      'Your session has expired. Please sign in again.',
    );
  }

  next();
}

/**
 * Short-lived user cache.
 */
const USER_TTL_MS = 15_000;

const userCache = new Map<
  string,
  {
    user: AuthUser;
    exp: number;
  }
>();

export const invalidateUser = (phone?: string): void => {
  if (phone) {
    userCache.delete(phone);
  } else {
    userCache.clear();
  }
};

/**
 * Convert MongoDB User document fields into AuthUser.
 */
function mapAuthUser(user: {
  _id: { toString(): string };
  phone: string;
  role: Role;
  name?: string | null;
  email?: string | null;
  avatarPublicId?: string | null;
  avatarResourceType?: string | null;
  isActive?: boolean;
}): AuthUser {
  return {
    id: user._id.toString(),
    phone: user.phone,
    role: user.role,
    name: user.name ?? null,
    email: user.email ?? null,
    avatar_public_id: user.avatarPublicId ?? null,
    avatar_resource_type: user.avatarResourceType ?? null,
    is_active: user.isActive ?? true,
  };
}

/**
 * Routes allowed for deactivated customers.
 */
function allowedWhileDeactivated(req: Request): boolean {
  const path = (req.originalUrl.split('?')[0] ?? '')
    .replace(/\/$/, '');

  return (
    (
      req.method === 'GET' &&
      (
        path === '/me' ||
        path === '/notifications' ||
        path === '/config'
      )
    ) ||
    path === '/account/requests' ||
    path.startsWith('/account/requests/') ||
    path === '/devices'
  );
}

/**
 * Verify SMS session token and load MongoDB user.
 */
export async function authed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await verified(req, res, () => undefined);

  const phone = req.verified!.phone;

  const hit = userCache.get(phone);

  if (hit && hit.exp > Date.now()) {
    req.user = hit.user;

    if (
      hit.user.is_active === false &&
      !allowedWhileDeactivated(req)
    ) {
      throw new HttpError(
        403,
        'account_deactivated',
        'Your account is deactivated. You can ask the store to activate it again.',
      );
    }

    return next();
  }

  const dbUser = await User.findOne({
    phone,
  })
    .select({
      phone: 1,
      role: 1,
      name: 1,
      email: 1,
      avatarPublicId: 1,
      avatarResourceType: 1,
      isActive: 1,
    })
    .lean()
    .exec();

  if (!dbUser) {
    userCache.delete(phone);

    throw new HttpError(
      401,
      'no_account',
      'Account not found. Please sign in again.',
    );
  }

  const authUser = mapAuthUser(dbUser);

  if (userCache.size > 5000) {
    userCache.clear();
  }

  userCache.set(phone, {
    user: authUser,
    exp: Date.now() + USER_TTL_MS,
  });

  req.user = authUser;

  if (
    authUser.is_active === false &&
    !allowedWhileDeactivated(req)
  ) {
    throw new HttpError(
      403,
      'account_deactivated',
      'Your account is deactivated. You can ask the store to activate it again.',
    );
  }

  next();
}

/**
 * Role-based authorization middleware.
 */
export const requireRole =
  (...roles: Role[]) =>
  (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw forbidden();
    }

    next();
  };
