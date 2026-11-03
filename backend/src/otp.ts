
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  createFirebaseSession,
  firebaseSessions,
  normalisePhone,
  signSessionToken,
  verifyToken,
  invalidateUser,
} from './auth.js';
import { config } from './config.js';
import { HttpError, parse } from './http.js';
import { SmsError, renderOtp, sendSms, smsSettings } from './sms.js';
import { OtpCode } from './models/OtpCode.js';
import { User } from './models/User.js';

/**
 * Login OTP by SMS.
 *
 * sms mode:
 * - Generates a 6-digit OTP.
 * - Stores only its HMAC hash in MongoDB.
 * - Expires after 5 minutes.
 * - Allows a maximum of 5 sends per 10 minutes.
 * - Allows a maximum of 5 incorrect attempts.
 *
 * twilio mode:
 * - Twilio Verify manages OTP generation, delivery and verification.
 *
 * static mode:
 * - Uses 123456 for testing.
 */

export const otpRouter = Router();

type Fetch = typeof fetch;
let http: Fetch = (...a) => fetch(...a);

/** Tests replace the network call. */
export const setTwilioFetch = (f: Fetch) => {
  http = f;
};

const base = () =>
  `https://verify.twilio.com/v2/Services/${config.twilio.verifyServiceSid}`;

const authHeader = () =>
  `Basic ${Buffer.from(
    `${config.twilio.accountSid}:${config.twilio.authToken}`,
  ).toString('base64')}`;

async function twilio(path: string, form: Record<string, string>) {
  const res = await http(`${base()}${path}`, {
    method: 'POST',
    headers: {
      authorization: authHeader(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    code?: number;
    message?: string;
  };

  return { status: res.status, body };
}

/** Simple in-memory limits per phone number. */
const sends = new Map<string, number[]>();

const fails = new Map<string, { n: number; until: number }>();

function allowSend(phone: string): boolean {
  const now = Date.now();

  const recent = (sends.get(phone) ?? []).filter(
    (timestamp) => now - timestamp < 10 * 60_000,
  );

  if (recent.length >= 5) return false;

  sends.set(phone, [...recent, now]);

  return true;
}

/** Fixed test code while OTP delivery is configured as test code. */
export const STATIC_OTP = '123456';
const testOtpEnabled =
  !config.isProd &&
  process.env.TEST_OTP_ENABLED?.trim().toLowerCase() === 'true';

const purpose = z.enum(['login', 'signup']).optional();

const phoneSchema = z.object({
  phone: z.string().min(10).max(15),
  purpose,
});

const OTP_TTL_MS = 5 * 60_000;
// export const OTP_TTL_MS_EXPORT = OTP_TTL_MS;

const RESEND_AFTER_MS = 30_000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_WRONG = 5;

const hashCode = (phone: string, code: string) =>
  createHmac('sha256', config.jwtSecret)
    .update(`otp:${phone}:${code}`)
    .digest('hex');

/** Sign-up requires a new number; login requires an existing account. */
async function checkPurpose(
  phone: string,
  p: 'login' | 'signup' | undefined,
): Promise<void> {
  if (!p) return;

const exists = await User.exists({ phone });

  if (p === 'signup' && exists) {
    throw new HttpError(
      409,
      'already_registered',
      'This mobile number is already registered. Please log in instead.',
    );
  }

  if (p === 'login' && !exists) {
    throw new HttpError(
      404,
      'not_registered',
      'This mobile number is not registered yet. Please create an account first.',
    );
  }
}

async function session(phone: string, prefix: 'tw' | 'sms') {
  return {
    token: signSessionToken(phone, prefix),
    firebaseToken: firebaseSessions()
      ? await createFirebaseSession(phone)
      : undefined,
  };
}

const serverOtp = () =>
  config.authMode === 'twilio' || config.authMode === 'sms';

/**
 * Reserve and persist a new OTP.
 *
 * The conditional upsert enforces the resend cooldown and send window
 * atomically in MongoDB. A duplicate-key error means an existing OTP
 * record did not satisfy the rate-limit conditions.
 */
async function sendOwnCode(phone: string): Promise<void> {
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
      {
        upsert: true,
        returnDocument: 'after',
      },
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
    const settings = await smsSettings();

    await sendSms(
      phone,
      renderOtp(settings.otpTemplate, code),
      settings,
    );
  } catch (error) {
    // Invalidate only the OTP that this request created.
    await OtpCode.updateOne(
      {
        phone,
        codeHash: hashCode(phone, code),
      },
      {
        $set: {
          expiresAt: new Date(0),
          lastSentAt: new Date(Date.now() - 60 * 60_000),
        },
      },
    );

    if (
      error instanceof SmsError &&
      error.reason === 'not_configured'
    ) {
      throw new HttpError(
        503,
        'otp_unavailable',
        'OTP login is not set up yet. Please contact the store.',
      );
    }

    throw new HttpError(
      502,
      'otp_unavailable',
      'Could not send the OTP right now. Please try again in a moment.',
    );
  }
}

/** Verify the latest unexpired OTP and consume it on success. */
async function checkOwnCode(
  phone: string,
  code: string,
): Promise<void> {
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
      {
        $inc: { attempts: 1 },
      },
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

  // Consume the OTP atomically. A concurrent resend or verification
  // cannot cause an old OTP to be accepted.
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

otpRouter.post('/send', async (req, res) => {
  if (config.authMode === 'firebase') {
    res.status(409).json({
      code: 'firebase_client_auth_required',
      provider: 'firebase',
      message:
        'Use Firebase Phone Authentication in the mobile app to send OTP.',
    });
    return;
  }

  if (!serverOtp()) {
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

  if (config.authMode === 'sms') {
    const settings = await smsSettings();

    // if (settings.otpChannel === 'static') {
    //   if (config.isProd) {
    //     throw new HttpError(
    //       503,
    //       'otp_unavailable',
    //       'SMS verification is not configured for production. Please contact the store.',
    //     );
    //   }

    //   res.json({ sent: true, testMode: true });
    //   return;
    // }

    if (settings.otpChannel === 'static') {
  if (!config.testOtpEnabled) {
  throw new HttpError(
    503,
    'otp_unavailable',
    'Test OTP is disabled.',
  );
}

  res.json({ sent: true, testMode: true });
  return;
}

    await sendOwnCode(phone);

    res.json({ sent: true, testMode: false });
    return;
  }

  const result = await twilio('/Verifications', {
    To: `+91${phone}`,
    Channel: 'sms',
  });

  if (result.status >= 400) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'twilio send failed',
        status: result.status,
        twilioCode: result.body.code,
      }),
    );

    if (result.body.code === 60203) {
      throw new HttpError(
        429,
        'otp_rate_limited',
        'Too many OTP requests. Please wait a few minutes and try again.',
      );
    }

    if (
      result.body.code === 60200 ||
      result.body.code === 21211
    ) {
      throw new HttpError(
        422,
        'invalid_phone',
        'Enter a valid 10-digit Indian mobile number',
      );
    }

    throw new HttpError(
      502,
      'otp_unavailable',
      'Could not send the OTP right now. Please try again in a moment.',
    );
  }

  res.status(204).end();
});

otpRouter.post('/verify', async (req, res) => {
  if (config.authMode === 'firebase') {
    // const body = parse(
    //   z.object({
    //     idToken: z.string().min(1),
    //     purpose: z.enum(['login', 'signup']),
    //     name: z.string().trim().max(100).optional(),
    //     email: z.string().email().optional(),
    //   }),
    //   req.body,
    // );

    const body = parse(
  z.object({
    phone: z.string().min(10).max(15),
    code: z.string().regex(/^\d{4,8}$/),
    purpose: z.enum(['login', 'signup']).default('login'),
  }),
  req.body,
);

    const verifiedUser = await verifyToken(body.idToken);
    const phone = normalisePhone(verifiedUser.phone);

    await checkPurpose(phone, body.purpose);

    let user = await User.findOne({ phone });

    if (!user && body.purpose === 'signup') {
      try {
        user = await User.create({
          phone,
          firebaseUid: verifiedUser.uid,
          role: 'customer',
          name: body.name ?? null,
          email: body.email ?? null,
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
      throw new HttpError(
        404,
        'not_registered',
        'Please sign up first.',
      );
    }

    if (!user.isActive) {
      throw new HttpError(
        403,
        'account_disabled',
        'Your account is currently inactive. Please contact the store.',
      );
    }

    invalidateUser(phone);

    res.json({
      token: body.idToken,
      user: {
        id: user._id.toString(),
        phone: user.phone,
        role: user.role,
        name: user.name ?? null,
        email: user.email ?? null,
      },
    });

    return;
  }

  if (!serverOtp()) {
    throw new HttpError(404, 'not_found', 'Not found');
  }

  const body = parse(
    z.object({
      phone: z.string().min(10).max(15),
      code: z.string().regex(/^\d{4,8}$/),
    }),
    req.body,
  );

  const phone = normalisePhone(body.phone);
  const failedAttempts = fails.get(phone);

  // if (config.authMode === 'sms') {
  //   const settings = await smsSettings();

  //   if (settings.otpChannel === 'static') {
  //     if (config.isProd) {
  //       throw new HttpError(
  //         503,
  //         'otp_unavailable',
  //         'SMS verification is not configured for production. Please contact the store.',
  //       );
  //     }

  //     if (
  //       failedAttempts &&
  //       failedAttempts.n >= MAX_WRONG &&
  //       failedAttempts.until > Date.now()
  //     ) {
  //       throw new HttpError(
  //         429,
  //         'otp_rate_limited',
  //         'Too many wrong attempts. Please request a new OTP in a few minutes.',
  //       );
  //     }

  //     if (body.code !== STATIC_OTP) {
  //       fails.set(phone, {
  //         n:
  //           (failedAttempts && failedAttempts.until > Date.now()
  //             ? failedAttempts.n
  //             : 0) + 1,
  //         until: Date.now() + 10 * 60_000,
  //       });

  //       throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
  //     }

  //     fails.delete(phone);
  //   } else {
  //     await checkOwnCode(phone, body.code);
  //   }

  //   res.json(await session(phone, 'sms'));
  //   return;
  // }

  if (config.authMode === 'sms') {
  const settings = await smsSettings();

  if (settings.otpChannel === 'static') {
    if (!testOtpEnabled) {
      throw new HttpError(
        503,
        'otp_unavailable',
        'Test OTP is disabled. Please configure SMS delivery.',
      );
    }

    if (
      failedAttempts &&
      failedAttempts.n >= MAX_WRONG &&
      failedAttempts.until > Date.now()
    ) {
      throw new HttpError(
        429,
        'otp_rate_limited',
        'Too many wrong attempts. Please request a new OTP in a few minutes.',
      );
    }

    if (body.code !== STATIC_OTP) {
      fails.set(phone, {
        n:
          (failedAttempts && failedAttempts.until > Date.now()
            ? failedAttempts.n
            : 0) + 1,
        until: Date.now() + 10 * 60_000,
      });

      throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
    }

    fails.delete(phone);
  } else {
    await checkOwnCode(phone, body.code);
  }

  await checkPurpose(phone, body.purpose);

  let user = await User.findOne({ phone });

  if (!user && body.purpose === 'signup') {
    try {
      user = await User.create({
        phone,
        role: 'customer',
        name: null,
        email: null,
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

  invalidateUser(phone);

  res.json(await session(phone, 'sms'));
  return;
}

  if (
    failedAttempts &&
    failedAttempts.n >= MAX_WRONG &&
    failedAttempts.until > Date.now()
  ) {
    throw new HttpError(
      429,
      'otp_rate_limited',
      'Too many wrong attempts. Please request a new OTP in a few minutes.',
    );
  }

  const result = await twilio('/VerificationCheck', {
    To: `+91${phone}`,
    Code: body.code,
  });

  if (result.status >= 500) {
    throw new HttpError(
      502,
      'otp_unavailable',
      'Could not verify the OTP right now. Please try again in a moment.',
    );
  }

  if (result.status === 404) {
    throw new HttpError(
      401,
      'invalid_otp',
      'This OTP has expired or was already used. Please request a new one.',
    );
  }

  if (result.body.status !== 'approved') {
    fails.set(phone, {
      n:
        (failedAttempts && failedAttempts.until > Date.now()
          ? failedAttempts.n
          : 0) + 1,
      until: Date.now() + 10 * 60_000,
    });

    throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
  }

  fails.delete(phone);

  res.json(await session(phone, 'tw'));
});
