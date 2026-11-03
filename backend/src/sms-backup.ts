import SmsSettingsModel from './models/SmsSettings.js';

export interface SmsSettings {
  apiUrl: string;
  senderId: string;
  smsType: string;
  apiKey: string | null;
  otpTemplate: string;
  otpChannel: 'static' | 'sms';
  updatedAt: string;
}

type Fetch = typeof fetch;

let http: Fetch = (...args) => fetch(...args);

export const setSmsFetch = (f: Fetch): void => {
  http = f;
};

let cached: { value: SmsSettings; at: number } | null = null;

export const forgetSmsSettings = (): void => {
  cached = null;
};

export async function smsSettings(): Promise<SmsSettings> {
  if (cached && Date.now() - cached.at < 30_000) {
    return cached.value;
  }

  const record = await SmsSettingsModel.findOne({ key: 'default' }).lean();

  const value: SmsSettings = {
    apiUrl: record?.apiUrl ?? 'https://sms.pearlsms.com/public/sms/send',
    senderId: record?.senderId ?? '',
    smsType: record?.smsType ?? 'TRANS',
    apiKey: record?.apiKey ?? null,
    otpTemplate: record?.otpTemplate ?? 'Your OTP is {otp}.',
    otpChannel: record?.otpChannel === 'sms' ? 'sms' : 'static',
    updatedAt: record?.updatedAt
      ? new Date(record.updatedAt).toISOString()
      : new Date(0).toISOString(),
  };

  cached = { value, at: Date.now() };
  return value;
}

export const renderOtp = (template: string, code: string): string =>
  template.replaceAll('{otp}', code);

export class SmsError extends Error {
  constructor(
    public reason: 'not_configured' | 'rejected' | 'unreachable',
    message: string,
  ) {
    super(message);
    this.name = 'SmsError';
  }
}

export async function sendSms(
  phone: string,
  message: string,
  settings?: SmsSettings,
): Promise<{ requestId: string | null }> {
  const s = settings ?? await smsSettings();

  if (!s.apiKey || !s.senderId) {
    throw new SmsError(
      'not_configured',
      'SMS sender ID or API key is not set',
    );
  }

  let res: Response;

  try {
    res = await http(s.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        sender: s.senderId,
        smstype: s.smsType,
        numbers: phone,
        apikey: s.apiKey,
        message,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SmsError(
      'unreachable',
      'The SMS gateway could not be reached',
    );
  }

  const responseText = await res.text();

  let body: {
    status?: string;
    errormsg?: string;
    requestid?: string | number | null;
  } = {};

  try {
    body = JSON.parse(responseText);
  } catch {
    // Some gateways return plain text.
  }

  const failed =
    !res.ok ||
    String(body.status ?? '').toUpperCase() === 'ERROR' ||
    (
      !responseText.trim().startsWith('{') &&
      /error|invalid|fail/i.test(responseText)
    );

  if (failed) {
    const reason =
      body.errormsg ??
      (responseText.slice(0, 200) || `HTTP ${res.status}`);

    console.error(JSON.stringify({
      level: 'error',
      msg: 'sms not sent',
      status: res.status,
      reason,
    }));

    throw new SmsError('rejected', reason);
  }

  return {
    requestId:
      body.requestid != null ? String(body.requestid) : null,
  };
}