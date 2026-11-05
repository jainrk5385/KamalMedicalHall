import 'dotenv/config';

const env: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    value?.trim(),
  ]),
);

const configuredCorsOrigins = (env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const corsOrigins = [...new Set([
  'https://admin.kamalmedicalhall.com',
  ...configuredCorsOrigins,
])];

function getNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a valid positive number`);
  }

  return parsed;
}

const isProd = env.NODE_ENV === 'production';

export const config = {
  isProd,

  // Pearl SMS is the only supported OTP provider.
  authMode: 'sms' as const,

  port: getNumber(env.PORT, 4000, 'PORT'),

  mongoUrl: env.MONGODB_URI ?? '',

  jwtSecret: env.JWT_SECRET ?? '',

  bootstrapAdminPhones: (env.BOOTSTRAP_ADMIN_PHONES ?? '')
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean),

  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: env.CLOUDINARY_API_KEY ?? '',
    apiSecret: env.CLOUDINARY_API_SECRET ?? '',
  },

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID ?? '',
    keySecret: env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },

  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/+$/, ''),

  corsOrigins,

  socketOnly: env.API_TRANSPORT === 'socket',

  logRequests: env.LOG_REQUESTS
    ? env.LOG_REQUESTS === 'on'
    : isProd,

  minLeadMinutes: getNumber(
    env.MIN_LEAD_MINUTES,
    60,
    'MIN_LEAD_MINUTES',
  ),

  quoteValidHours: getNumber(
    env.QUOTE_VALID_HOURS,
    24,
    'QUOTE_VALID_HOURS',
  ),
};

export const useMongo = (): boolean => true;

if (!config.mongoUrl) {
  throw new Error('MONGODB_URI is required');
}

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters');
}

if (
  config.publicUrl &&
  !/^https?:\/\/[\w.-]+(:\d{1,5})?$/.test(config.publicUrl)
) {
  throw new Error(
    'PUBLIC_URL must look like https://api.example.com (no path)',
  );
}
