import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

import {
  invalidateUser,
  normalisePhone,
  signSessionToken,
} from './auth.js';
import { config } from './config.js';
import { HttpError, parse } from './http.js';
import { SmsError, renderOtp, sendSms, smsSettings } from './sms.js';
import { OtpCode } from './models/OtpCode.js';
import { User } from './models/User.js';

export const otpRouter = Router();

export const STATIC_OTP = '123456';

const purposeSchema = z.enum(['login', 'signup']);

const phoneSchema = z.object({
  phone: z.string().min(10).max(15),
  purpose: purposeSchema.optional(),
});

const signupProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).or(z.literal('')).optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  city: z.string().trim().max(60).optional(),
});

type SignupProfile = z.infer<typeof signupProfileSchema>;

const OTP_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 30_000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_WRONG = 5;

const sends = new Map<string, number[]>();
const fails = new Map<string, { n: number; until: number }>();

const hashCode = (phone: string, code: string) =>
  createHmac('sha256', config.jwtSecret)
    .update(`otp:${phone}:${code}`)
    .digest('hex');

function allowSend(phone: string): boolean {
  const now = Date.now();
  const recent = (sends.get(phone) ?? []).filter(
    (timestamp) => now - timestamp < 10 * 60_000,
  );

  if (recent.length >= MAX_SENDS_PER_WINDOW) return false;

  sends.set(phone, [...recent, now]);
  return true;
}

function checkFailedAttempts(phone: string): void {
  const failed = fails.get(phone);
  if (failed && failed.n >= MAX_WRONG && failed.until > Date.now()) {
    throw new HttpError(
      429,
      'otp_rate_limited',
      'Too many wrong attempts. Please request a new OTP in a few minutes.',
    );
  }
}

/** Login requires an existing account; signup requires a new number. */
async function checkPurpose(
  phone: string,
  purpose: 'login' | 'signup' | undefined,
): Promise<void> {
  if (!purpose) return;

  const exists = await User.exists({ phone });

  if (purpose === 'signup' && exists) {
    throw new HttpError(
      409,
      'already_registered',
      'This mobile number is already registered. Please log in instead.',
    );
  }

  if (purpose === 'login' && !exists) {
    throw new HttpError(
      404,
      'not_registered',
      'This mobile number is not registered yet. Please create an account first.',
    );
  }
}

async function createOrGetUser(
  phone: string,
  purpose: 'login' | 'signup',
  profile?: SignupProfile,
) {
  await checkPurpose(phone, purpose);

  let user = await User.findOne({ phone });

  if (!user && purpose === 'signup') {
    try {
      user = await User.create({
        phone,
        role: 'customer',
        name: profile?.name?.trim() || null,
        email: profile?.email?.trim() || null,
        gender: profile?.gender ?? null,
        dateOfBirth: profile?.dateOfBirth
          ? new Date(profile.dateOfBirth)
          : null,
        city: profile?.city?.trim() || null,
        signedUpAt: new Date(),
        isActive: true,
      });
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError.code === 11000) {
        user = await User.findOne({ phone });
      } else {
        throw error;
      }
    }
  }

  if (!user) {
    throw new HttpError(404, 'not_registered', 'Please sign up first.');
  }

  if (!user.isActive) {
    throw new HttpError(
      403,
      'account_disabled',
      'Your account is currently inactive. Please contact the store.',
    );
  }

  if (purpose === 'signup' && profile) {
    user.name = profile.name?.trim() || null;
    user.email = profile.email?.trim() || null;
    user.gender = profile.gender ?? null;
    user.dateOfBirth = profile.dateOfBirth
      ? new Date(profile.dateOfBirth)
      : null;
    user.city = profile.city?.trim() || null;
    await user.save();
  }

  return user;
}

function userPayload(user: Awaited<ReturnType<typeof createOrGetUser>>) {
  return {
    id: user._id.toString(),
    phone: user.phone,
    role: user.role,
    name: user.name ?? null,
    email: user.email ?? null,
    gender: user.gender ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    city: user.city ?? null,
  };
}

function smsSession(phone: string) {
  return { token: signSessionToken(phone) };
}

/** Generate, store and send a one-time code through the configured Pearl SMS gateway. */
async function sendOwnCode(phone: string): Promise<void> {
  const settings = await smsSettings();

  if (settings.otpChannel !== 'sms') {
    throw new HttpError(
      503,
      'otp_unavailable',
      'SMS OTP is not enabled. Please contact the store.',
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  const nowDate = new Date(now);
  const windowExpiredBefore = new Date(now - 10 * 60_000);
  const resendAllowedBefore = new Date(now - RESEND_AFTER_MS);

  try {
    await OtpCode.findOneAndUpdate(
      {
        phone,
        $and: [
          {
            $or: [
              { lastSentAt: { $exists: false } },
              { lastSentAt: { $lte: resendAllowedBefore } },
            ],
          },
          {
            $or: [
              { windowStartedAt: { $exists: false } },
              { windowStartedAt: { $lte: windowExpiredBefore } },
              { sends: { $lt: MAX_SENDS_PER_WINDOW } },
            ],
          },
        ],
      },
      [
        {
          $set: {
            phone,
            codeHash: hashCode(phone, code),
            expiresAt: new Date(now + OTP_TTL_MS),
            attempts: 0,
            lastSentAt: nowDate,
            sends: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ['$windowStartedAt', null] }, null] },
                    { $lte: ['$windowStartedAt', windowExpiredBefore] },
                  ],
                },
                1,
                { $add: [{ $ifNull: ['$sends', 0] }, 1] },
              ],
            },
            windowStartedAt: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ['$windowStartedAt', null] }, null] },
                    { $lte: ['$windowStartedAt', windowExpiredBefore] },
                  ],
                },
                nowDate,
                '$windowStartedAt',
              ],
            },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
  } catch (error) {
    const mongoError = error as { code?: number };
    if (mongoError.code === 11000) {
      throw new HttpError(
        429,
        'otp_rate_limited',
        'Please wait a moment before asking for another OTP.',
      );
    }
    throw error;
  }

  try {
    await sendSms(phone, renderOtp(settings.otpTemplate, code), settings);
  } catch (error) {
    await OtpCode.updateOne(
      { phone, codeHash: hashCode(phone, code) },
      {
        $set: {
          expiresAt: new Date(0),
          lastSentAt: new Date(Date.now() - 60 * 60_000),
        },
      },
    );

    if (error instanceof SmsError && error.reason === 'not_configured') {
      throw new HttpError(
        503,
        'otp_unavailable',
        'Pearl SMS is not configured yet. Please contact the store.',
      );
    }

    throw new HttpError(
      502,
      'otp_unavailable',
      'Could not send the OTP right now. Please try again in a moment.',
    );
  }
}

/** Verify and consume the latest unexpired OTP exactly once. */
async function checkOwnCode(phone: string, code: string): Promise<void> {
  const row = await OtpCode.findOne({ phone })
    .select('codeHash attempts expiresAt')
    .lean();

  if (
    !row ||
    row.expiresAt.getTime() <= Date.now() ||
    row.attempts >= MAX_WRONG
  ) {
    throw new HttpError(
      401,
      'invalid_otp',
      'This OTP has expired or was already used. Please request a new one.',
    );
  }

  const expected = Buffer.from(row.codeHash, 'hex');
  const received = Buffer.from(hashCode(phone, code), 'hex');

  if (!timingSafeEqual(expected, received)) {
    const result = await OtpCode.updateOne(
      {
        phone,
        codeHash: row.codeHash,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: MAX_WRONG },
      },
      { $inc: { attempts: 1 } },
    );

    if (result.modifiedCount === 0) {
      throw new HttpError(
        401,
        'invalid_otp',
        'This OTP has expired or was already used. Please request a new one.',
      );
    }

    const updated = await OtpCode.findOne({ phone })
      .select('attempts codeHash')
      .lean();

    if (
      updated?.codeHash === row.codeHash &&
      updated.attempts >= MAX_WRONG
    ) {
      throw new HttpError(
        401,
        'invalid_otp',
        'Too many wrong attempts. Please request a new OTP.',
      );
    }

    throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
  }

  const consumed = await OtpCode.updateOne(
    {
      phone,
      codeHash: row.codeHash,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: MAX_WRONG },
    },
    {
      $set: {
        expiresAt: new Date(),
        attempts: MAX_WRONG,
      },
    },
  );

  if (consumed.modifiedCount !== 1) {
    throw new HttpError(
      401,
      'invalid_otp',
      'This OTP has expired or was already used. Please request a new one.',
    );
  }
}

/** Send OTP: Pearl SMS in production; static OTP only in non-production test mode. */
otpRouter.post('/send', async (req, res) => {
  if (config.authMode !== 'sms') {
    throw new HttpError(404, 'not_found', 'Not found');
  }

  const body = parse(phoneSchema, req.body);
  const phone = normalisePhone(body.phone);

  await checkPurpose(phone, body.purpose);

  if (!allowSend(phone)) {
    throw new HttpError(
      429,
      'otp_rate_limited',
      'Too many OTP requests. Please wait a few minutes and try again.',
    );
  }

  const settings = await smsSettings();

  if (config.isProd && settings.otpChannel !== 'sms') {
    throw new HttpError(
      503,
      'otp_unavailable',
      'Production SMS OTP is not enabled. Please contact the store.',
    );
  }

  if (settings.otpChannel === 'static') {
    if (config.isProd || !config.testOtpEnabled) {
      throw new HttpError(
        503,
        'otp_unavailable',
        'Test OTP is disabled. Please configure Pearl SMS delivery.',
      );
    }

    res.json({ sent: true, testMode: true });
    return;
  }

  await sendOwnCode(phone);
  res.json({ sent: true, testMode: false });
});

/** Verify OTP and establish the application session. */
otpRouter.post('/verify', async (req, res) => {
  if (config.authMode !== 'sms') {
    throw new HttpError(404, 'not_found', 'Not found');
  }

  const body = parse(
    z.object({
      phone: z.string().min(10).max(15),
      code: z.string().regex(/^\d{4,8}$/),
      purpose: purposeSchema.default('login'),
      profile: signupProfileSchema.optional(),
    }),
    req.body,
  );

  const phone = normalisePhone(body.phone);
  const settings = await smsSettings();

  if (config.isProd && settings.otpChannel !== 'sms') {
    throw new HttpError(
      503,
      'otp_unavailable',
      'Production SMS OTP is not enabled. Please contact the store.',
    );
  }

  if (settings.otpChannel === 'static') {
    if (config.isProd || !config.testOtpEnabled) {
      throw new HttpError(
        503,
        'otp_unavailable',
        'Test OTP is disabled. Please configure Pearl SMS delivery.',
      );
    }

    checkFailedAttempts(phone);

    if (body.code !== STATIC_OTP) {
      const failed = fails.get(phone);
      fails.set(phone, {
        n: (failed && failed.until > Date.now() ? failed.n : 0) + 1,
        until: Date.now() + 10 * 60_000,
      });
      throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
    }

    fails.delete(phone);
  } else {
    await checkOwnCode(phone, body.code);
  }

  const user = await createOrGetUser(
    phone,
    body.purpose,
    body.purpose === 'signup' ? body.profile : undefined,
  );

  invalidateUser(phone);
  res.json({ ...smsSession(phone), user: userPayload(user) });
});
