import { ApiError } from '../core/errors/ApiError';

const SEND_ERROR_MESSAGES: Record<string, string> = {
  'unauthorized-domain': 'Phone verification is not enabled for this website. Please contact the store.',
  'operation-not-allowed': 'Phone verification is not enabled. Please contact the store.',
  'billing-not-enabled': 'Phone verification is temporarily unavailable. Please contact the store.',
  'quota-exceeded': 'Too many verification messages have been requested. Please try again later.',
  'too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'invalid-phone-number': 'Enter a valid mobile number.',
  'network-request-failed': 'No internet connection. Please check your network and try again.',
  'captcha-check-failed': 'We could not verify this browser. Refresh the page and try again.',
  'invalid-app-credential': 'We could not verify this browser. Refresh the page and try again.',
  'missing-client-identifier': 'We could not verify this browser. Refresh the page and try again.',
  'app-not-authorized': 'This website is not configured for phone verification. Please contact the store.',
  'invalid-api-key': 'This website is not configured for phone verification. Please contact the store.',
};

/** Convert Firebase web phone-auth failures to safe, actionable messages. */
export function firebaseWebSendError(error: unknown): ApiError {
  const rawCode = (error as { code?: unknown } | null)?.code;
  const code = typeof rawCode === 'string' ? rawCode.replace(/^auth\//, '') : '';
  const message = SEND_ERROR_MESSAGES[code] ?? 'Could not send the OTP. Please try again.';
  return new ApiError(0, `otp_${code || 'unknown'}`, message);
}
