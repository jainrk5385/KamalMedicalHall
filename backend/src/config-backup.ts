
import 'dotenv/config';

const env: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    value?.trim(),
  ])
);

const allowedAuthModes = ['dev', 'firebase', 'twilio', 'sms'] as const;

type AuthMode = (typeof allowedAuthModes)[number];

const authModeValue = env.AUTH_MODE ?? 'firebase';
const configuredCorsOrigins = (env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

// The admin app is hosted on its own production subdomain. Keep it allowed even
// when an older deployment environment variable only lists the public website.
const corsOrigins = [...new Set([
  'https://admin.kamalmedicalhall.com',
  ...configuredCorsOrigins,
])];

if (!allowedAuthModes.includes(authModeValue as AuthMode)) {
  throw new Error(
    `Invalid AUTH_MODE: ${authModeValue}. Allowed values: ${allowedAuthModes.join(', ')}`
  );
}

function getNumber(
  value: string | undefined,
  fallback: number,
  name: string
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

export const config = {
  isProd: env.NODE_ENV === 'production',

  port: getNumber(env.PORT, 4000, 'PORT'),

  // MongoDB is the only supported database.
  mongoUrl: env.MONGODB_URI ?? '',

  authMode: authModeValue as AuthMode,

  jwtSecret: env.JWT_SECRET ?? '',

  firebaseProjectId: env.FIREBASE_PROJECT_ID ?? '',
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',

  bootstrapAdminPhones: (env.BOOTSTRAP_ADMIN_PHONES ?? '')
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean),

  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: env.CLOUDINARY_API_KEY ?? '',
    apiSecret: env.CLOUDINARY_API_SECRET ?? '',
  },

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID ?? '',
    authToken: env.TWILIO_AUTH_TOKEN ?? '',
    verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID ?? '',
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
    : env.NODE_ENV === 'production',

  minLeadMinutes: getNumber(
    env.MIN_LEAD_MINUTES,
    60,
    'MIN_LEAD_MINUTES'
  ),

  quoteValidHours: getNumber(
    env.QUOTE_VALID_HOURS,
    24,
    'QUOTE_VALID_HOURS'
  ),
};

// MongoDB-only application.
export const useMongo = (): boolean => true;

// Required environment validation.
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
    'PUBLIC_URL must look like https://api.example.com (no path)'
  );
}

if (
  config.isProd &&
  config.authMode === 'dev'
) {
  throw new Error(
    'AUTH_MODE=dev is not allowed when NODE_ENV=production'
  );
}

if (
  config.authMode === 'twilio' &&
  !(
    config.twilio.accountSid &&
    config.twilio.authToken &&
    config.twilio.verifyServiceSid
  )
) {
  throw new Error(
    'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID are required when AUTH_MODE=twilio'
  );
}

if (
  config.authMode === 'firebase' &&
  !config.firebaseProjectId
) {
  throw new Error(
    'FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase'
  );
}
