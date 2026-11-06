import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';

import { authed, normalisePhone, requireRole } from '../auth.js';
import { config } from '../config.js';
import SmsSettingsModel from '../models/SmsSettings.js';
import OtpModeAuditModel from '../models/OtpModeAudit.js';
import { HttpError, parse } from '../http.js';
import {
  SmsError,
  forgetSmsSettings,
  renderOtp,
  sendSms,
  smsSettings,
} from '../sms.js';

export const smsAdmin = Router();

const PEARL_SMS_URL = 'https://sms.pearlsms.com/public/sms/send';

smsAdmin.use(authed, requireRole('admin'));

const masked = (key: string | null) =>
  key ? `••••${key.slice(-4)}` : null;

const view = async () => {
  const settings = await smsSettings();

  return {
    apiUrl: PEARL_SMS_URL,
    senderId: settings.senderId,
    smsType: settings.smsType,
    otpTemplate: settings.otpTemplate,
    otpChannel: settings.otpChannel,
    staticOtpPhones: settings.staticOtpPhones,
    staticOtpAllowed: settings.staticOtpPhones.length > 0,
    apiKeySet: Boolean(settings.apiKey),
    apiKeyHint: masked(settings.apiKey),
    updatedAt: settings.updatedAt,
    inUse: config.authMode === 'sms',
  };
};

const trimmed = (max: number) =>
  z.string().trim().max(max);

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

  otpChannel: z.enum(['sms', 'static']).default('sms'),

  staticOtpPhones: z.array(z.string().trim().min(10).max(15)).max(20).default([]),

  // Retained for compatibility. The submitted URL is ignored.
  apiUrl: trimmed(300).optional(),
});

smsAdmin.get('/sms', async (_req, res) => {
  res.json(await view());
});

smsAdmin.put('/sms', async (req, res) => {
  const body = parse(schema, req.body);

  const staticOtpPhones = [
    ...new Set(body.staticOtpPhones.map((phone) => normalisePhone(phone))),
  ];

  if (body.otpChannel === 'static' && staticOtpPhones.length === 0) {
    throw new HttpError(
      422,
      'static_otp_phone_required',
      'Add at least one approved reviewer/test phone number before enabling Static OTP.',
    );
  }

  const previous = await SmsSettingsModel.findOne({ key: 'default' })
    .select('otpChannel staticOtpPhones')
    .lean();

  const previousMode = previous?.otpChannel === 'static' ? 'static' : 'sms';

  const update: Record<string, unknown> = {
    apiUrl: PEARL_SMS_URL,
    senderId: body.senderId,
    smsType: body.smsType,
    otpTemplate: body.otpTemplate,
    otpChannel: body.otpChannel,
    staticOtpPhones,
    updatedBy: req.user!.id,
  };

  if (body.apiKey) {
    update.apiKey = body.apiKey;
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

  const previousPhones = Array.isArray(previous?.staticOtpPhones)
    ? previous.staticOtpPhones
    : [];
  const reviewerPhonesChanged =
    JSON.stringify([...previousPhones].sort()) !==
    JSON.stringify([...staticOtpPhones].sort());

  if (previousMode !== body.otpChannel || reviewerPhonesChanged) {
    await OtpModeAuditModel.create({
      previousMode,
      newMode: body.otpChannel,
      changedBy: new Types.ObjectId(req.user!.id),
    });
  }

  res.json(await view());
});

/** Sends a random sample code to test the configured Pearl SMS gateway. */
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

  // This is a gateway test message, not an authentication OTP.
  const sampleCode = String(randomInt(100000, 1000000));

  try {
    const result = await sendSms(
      phone,
      renderOtp(settings.otpTemplate, sampleCode),
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
          ? 'Enter the Pearl SMS sender ID and API key first.'
          : `Pearl SMS gateway error: ${error.message}`,
      );
    }

    throw error;
  }
});
