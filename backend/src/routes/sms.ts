
import { Router } from 'express';
import { z } from 'zod';

import { authed, normalisePhone, requireRole } from '../auth.js';
import { config } from '../config.js';
import SmsSettingsModel from '../models/SmsSettings.js';
import { HttpError, parse } from '../http.js';
import {
  SmsError,
  forgetSmsSettings,
  renderOtp,
  sendSms,
  smsSettings,
} from '../sms.js';

export const smsAdmin = Router();

smsAdmin.use(authed, requireRole('admin'));

const masked = (key: string | null) =>
  key ? `••••${key.slice(-4)}` : null;

const view = async () => {
  const settings = await smsSettings();

  return {
    apiUrl: settings.apiUrl,
    senderId: settings.senderId,
    smsType: settings.smsType,
    otpTemplate: settings.otpTemplate,
    otpChannel: settings.otpChannel,
    apiKeySet: Boolean(settings.apiKey),
    apiKeyHint: masked(settings.apiKey),
    updatedAt: settings.updatedAt,
    inUse:
      config.authMode === 'sms' &&
      settings.otpChannel === 'sms',
  };
};

const trimmed = (max: number) => z.string().trim().max(max);

const schema = z.object({
  senderId: trimmed(11)
    .regex(
      /^[A-Za-z0-9]{3,11}$/,
      'Sender ID is 3 to 11 letters or digits, like SPPLFW',
    )
    .transform((value) => value.toUpperCase()),

  smsType: trimmed(20)
    .regex(
      /^[A-Za-z_]{2,20}$/,
      'SMS type is a word like TRANS',
    )
    .transform((value) => value.toUpperCase()),

  apiKey: trimmed(200).optional(),

  otpTemplate: trimmed(480)
    .min(8)
    .refine(
      (value) => value.includes('{otp}'),
      'The message must contain {otp} where the code goes',
    ),

  apiUrl: trimmed(300)
    .regex(
      /^https:\/\/\S+$/i,
      'The gateway address must start with https://',
    )
    .optional(),

  otpChannel: z.enum(['static', 'sms']).optional(),
});

smsAdmin.get('/sms', async (_req, res) => {
  res.json(await view());
});

smsAdmin.put('/sms', async (req, res) => {
  const body = parse(schema, req.body);

  if (config.isProd && body.otpChannel === 'static') {
    throw new HttpError(
      400,
      'test_otp_disabled',
      'Static test OTPs are disabled in production. Configure the SMS gateway instead.',
    );
  }

  const update: Record<string, unknown> = {
    senderId: body.senderId,
    smsType: body.smsType,
    otpTemplate: body.otpTemplate,
    updatedBy: req.user!.id,
  };

  if (body.apiKey) {
    update.apiKey = body.apiKey;
  }

  if (body.apiUrl !== undefined) {
    update.apiUrl = body.apiUrl;
  }

  if (body.otpChannel !== undefined) {
    update.otpChannel = body.otpChannel;
  }

  await SmsSettingsModel.findOneAndUpdate(
    { key: 'default' },
    {
      $set: update,
      $setOnInsert: { key: 'default' },
    },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  forgetSmsSettings();

  res.json(await view());
});

/** Sends a sample OTP to test the configured SMS gateway. */
smsAdmin.post('/sms/test', async (req, res) => {
  const body = parse(
    z.object({
      phone: z.string().min(10).max(15),
    }),
    req.body,
  );

  const phone = normalisePhone(body.phone);

  forgetSmsSettings();

  const settings = await smsSettings();

  try {
    const result = await sendSms(
      phone,
      renderOtp(settings.otpTemplate, '123456'),
      settings,
    );

    res.json({
      sent: true,
      requestId: result.requestId,
    });
  } catch (error) {
    if (error instanceof SmsError) {
      throw new HttpError(
        error.reason === 'not_configured' ? 422 : 502,
        `sms_${error.reason}`,
        error.reason === 'not_configured'
          ? 'Enter the sender ID and API key first.'
          : `The SMS gateway said: ${error.message}`,
      );
    }

    throw error;
  }
});
