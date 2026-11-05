
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import {
  authed,
  invalidateUser,
  normalisePhone,
  verified,
} from '../auth.js';
import { config } from '../config.js';
import { tx } from '../db.js';
import { HttpError, notFound, parse } from '../http.js';
import { isServiceable, servicePincodes } from '../pincodes.js';
import { listDeliveryDates, listDeliveryDays } from '../slots.js';
import { smsSettings } from '../sms.js';
import { notifyAdmins } from '../notify.js';
import {
  deletePrescriptionFiles,
  isBlockedFile,
  signUpload,
  signedPrescriptionUrl,
  type ResourceType,
} from '../services.js';

import { User } from '../models/User.js';
import { Address } from '../models/Address.js';
import { Order } from '../models/Order.js';
import { Notification } from '../models/Notification.js';
import DeviceToken from '../models/DeviceToken.js';
import { StoreSettings } from '../models/StoreSettings.js';
import { AccountRequest } from '../models/AccountRequest.js';

export const general = Router();

const validId = (id: string) => Types.ObjectId.isValid(id);

const idOf = (value: unknown) =>
  value && typeof value === 'object' && '_id' in value
    ? String((value as { _id: unknown })._id)
    : String(value ?? '');

const userView = (u: any) => ({
  id: idOf(u._id),
  phone: u.phone,
  role: u.role,
  name: u.name ?? null,
  email: u.email ?? null,
  language: u.language ?? 'en',
  gender: u.gender ?? null,
  dateOfBirth: u.dateOfBirth
    ? new Date(u.dateOfBirth).toISOString().slice(0, 10)
    : null,
  city: u.city ?? null,
  isActive: u.isActive !== false,
  avatarUrl: u.avatarPublicId
    ? signedPrescriptionUrl(
        u.avatarPublicId,
        'image/jpeg',
        (u.avatarResourceType ?? 'image') as ResourceType,
      )
    : null,
});

general.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** Public store/delivery configuration. */
general.get('/config', async (_req, res) => {
  const [store, sms] = await Promise.all([
    StoreSettings.findOne().lean(),
    config.authMode === 'sms' ? smsSettings() : Promise.resolve(null),
  ]);

  if (!store) {
    throw new HttpError(
      503,
      'store_unavailable',
      'Store settings are unavailable.',
    );
  }

  res.json({
    store: {
      isOpen: store.isOpen,
      openingTime: store.openingTime,
      closingTime: store.closingTime,
      address: store.address,
      phone: store.phone,
      email: store.email,
      latitude: store.latitude,
      longitude: store.longitude,
    },
    deliveryDays: listDeliveryDays(new Date(), store.orderCutoffTime),
    deliveryDates: listDeliveryDates(new Date(), store.orderCutoffTime),
    orderCutoffTime: store.orderCutoffTime,
    authMode: config.authMode,
    otpTestMode: false,
  });
});

/** Public terms and conditions. */
general.get('/terms', async (_req, res) => {
  const store = await StoreSettings.findOne()
    .select('termsText termsUpdatedAt')
    .lean();

  res.json({
    text: store?.termsText ?? '',
    updatedAt: store?.termsUpdatedAt ?? null,
  });
});

/** Customer sign-up form. */
export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(80),
  email: z.union([
    z.string().trim().toLowerCase().email('Enter a valid email').max(120),
    z.literal(''),
  ]).optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth should be like 1990-05-31')
    .nullable()
    .optional()
    .refine(
      (v) =>
        !v ||
        (!Number.isNaN(Date.parse(v)) &&
          new Date(v) <= new Date() &&
          new Date(v) >= new Date('1900-01-01')),
      'Enter a real date of birth',
    ),
  city: z.string().trim().max(60).optional(),
});

/** First call after OTP verification. */
general.post('/auth/session', verified, async (req, res) => {
  const { phone } = req.verified!;

  const b = parse(
    z.object({
      purpose: z.enum(['login', 'signup']).optional(),
      profile: profileSchema.optional(),
    }),
    req.body ?? {},
  );

  const existing = await User.findOne({ phone })
    .select('_id role')
    .lean();

  if (b.purpose === 'login' && !existing) {
    throw new HttpError(
      404,
      'not_registered',
      'This mobile number is not registered yet. Please create an account first.',
    );
  }

  if (b.purpose === 'signup' && existing) {
    throw new HttpError(
      409,
      'already_registered',
      'This mobile number is already registered. Please log in instead.',
    );
  }

  if (b.purpose === 'signup' && !b.profile) {
    throw new HttpError(
      422,
      'validation_error',
      'Please fill in the sign-up form.',
    );
  }

  const p = b.purpose === 'signup' ? b.profile : undefined;

  const user = await User.findOneAndUpdate(
    { phone },
    p
      ? {
          $setOnInsert: {
            role: 'customer',
            name: p.name,
            email: p.email || null,
            gender: p.gender ?? null,
            dateOfBirth: p.dateOfBirth
              ? new Date(`${p.dateOfBirth}T00:00:00.000Z`)
              : null,
            city: p.city || null,
            signedUpAt: new Date(),
          },
        }
      : {
          $set: {},
        },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    },
  );

  if (!user) {
    throw new HttpError(
      500,
      'user_creation_failed',
      'Could not create user.',
    );
  }

  if (p) {
    void notifyAdmins(
      null,
      'customer_signup',
      'New customer registered',
      `${p.name} (+91 ${phone}) created an account.`,
    ).catch(() => undefined);
  }

  res.json({
    user: userView(user),
    needsProfile: user.role === 'customer' && !user.name,
  });
});

/** Public list of serviceable pincodes. */
general.get('/pincodes', async (_req, res) => {
  res.json({
    pincodes: [...(await servicePincodes())].sort(),
  });
});

export const accountRequestView = (r: any) => ({
  id: idOf(r._id ?? r.id),
  kind: r.kind,
  reason: r.reason,
  details: r.details ?? null,
  status: r.status,
  adminNote: r.adminNote ?? null,
  createdAt: r.createdAt,
  decidedAt: r.decidedAt ?? null,
});

/** Signed-in user's profile and latest account request. */
general.get('/me', authed, async (req, res) => {
  const [user, request] = await Promise.all([
    User.findById(req.user!.id),
    AccountRequest.findOne({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  if (!user) throw notFound('User not found');

  res.json({
    user: userView(user),
    accountRequest: request ? accountRequestView(request) : null,
  });
});

general.patch('/me', authed, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      email: z.union([
        z.string().trim().email().max(120),
        z.literal(''),
      ]).optional(),
      language: z.enum(['en', 'hi']).optional(),
      gender: profileSchema.shape.gender,
      dateOfBirth: profileSchema.shape.dateOfBirth,
      city: profileSchema.shape.city,
    }),
    req.body,
  );

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) update.name = body.name;
  if (body.email !== undefined) update.email = body.email || null;
  if (body.language !== undefined) update.language = body.language;
  if (body.gender !== undefined) update.gender = body.gender;

  if (body.dateOfBirth !== undefined) {
    update.dateOfBirth = body.dateOfBirth
      ? new Date(`${body.dateOfBirth}T00:00:00.000Z`)
      : null;
  }

  if (body.city !== undefined) update.city = body.city || null;

  const user = await User.findByIdAndUpdate(
    req.user!.id,
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) throw notFound('User not found');

  invalidateUser(req.user!.phone);
  res.json({ user: userView(user) });
});

// ---- Addresses -------------------------------------------------------------

const addressSchema = z.object({
  label: z.enum(['home', 'office', 'other']).default('home'),
  recipientName: z.string().trim().min(2).max(80),
  phone: z.string().transform(normalisePhone),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(120).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const addressView = (a: any) => ({
  id: idOf(a._id ?? a.id),
  label: a.label ?? 'home',
  recipientName: a.recipientName,
  phone: a.phone,
  line1: a.line1,
  line2: a.line2 ?? null,
  landmark: a.landmark ?? null,
  pincode: a.pincode,
  city: a.city ?? null,
  latitude: a.latitude ?? null,
  longitude: a.longitude ?? null,
});

async function assertServiceable(pincode: string) {
  if (!(await isServiceable(pincode))) {
    throw new HttpError(
      422,
      'unsupported_pincode',
      'Sorry, we do not deliver to this pincode yet.',
    );
  }
}

general.get('/addresses', authed, async (req, res) => {
  const rows = await Address.find({ userId: req.user!.id })
    .sort({ createdAt: 1 })
    .lean();

  res.json({ addresses: rows.map(addressView) });
});

// Create address
general.post('/addresses', authed, async (req, res) => {
  const a = parse(addressSchema, req.body);

  await assertServiceable(a.pincode);

  const address = await Address.create({
    userId: req.user!.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? null,
    landmark: a.landmark ?? null,
    pincode: a.pincode,
    city: null,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
  });

  res.status(201).json({
    address: addressView(address),
  });
});

// Update address
general.put('/addresses/:id', authed, async (req, res) => {
  const a = parse(addressSchema, req.body);

  if (!validId(String(req.params.id))) {
    throw notFound('Address not found');
  }

  await assertServiceable(a.pincode);

  const address = await Address.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.user!.id,
    },
    {
      $set: {
        label: a.label,
        recipientName: a.recipientName,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2 ?? null,
        landmark: a.landmark ?? null,
        pincode: a.pincode,
        city: null,
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  );

  if (!address) {
    throw notFound('Address not found');
  }

  res.json({
    address: addressView(address),
  });
});

// Delete address
general.delete('/addresses/:id', authed, async (req, res) => {
  if (!validId(String(req.params.id))) {
    throw notFound('Address not found');
  }

  const result = await Address.deleteOne({
    _id: req.params.id,
    userId: req.user!.id,
  });

  if (!result.deletedCount) {
    throw notFound('Address not found');
  }

  res.status(204).end();
});

// ---- Uploads ---------------------------------------------------------------

general.post('/uploads/sign', authed, (req, res) => {
  const { purpose } = parse(
    z.object({
      purpose: z.enum([
        'prescription',
        'bill',
        'avatar',
        'review',
        'proof',
        'announcement',
      ]).default('prescription'),
    }),
    req.body ?? {},
  );

  const role = req.user!.role;

  const allowed =
    purpose === 'bill'
      ? role === 'admin'
      : purpose === 'proof'
        ? role === 'delivery_partner'
        : purpose === 'announcement'
          ? role === 'admin'
          : purpose === 'avatar'
            ? true
            : role === 'customer';

  if (!allowed) {
    throw new HttpError(403, 'forbidden', 'Not allowed');
  }

  res.json(signUpload(req.user!.id, purpose));
});

/** Profile picture metadata after Cloudinary upload. */
general.put('/me/avatar', authed, async (req, res) => {
  const b = parse(
    z.object({
      publicId: z.string().min(3).max(300),
      resourceType: z.enum(['image']).default('image'),
    }),
    req.body,
  );

  if (
    !b.publicId.startsWith(`avatars/${req.user!.id}/`) ||
    isBlockedFile(b.publicId)
  ) {
    throw new HttpError(400, 'invalid_file', 'Invalid picture.');
  }

  const user = await User.findByIdAndUpdate(
    req.user!.id,
    {
      $set: {
        avatarPublicId: b.publicId,
        avatarResourceType: b.resourceType,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) throw notFound('User not found');

  invalidateUser(req.user!.phone);
  res.json({ user: userView(user) });
});

general.delete('/me/avatar', authed, async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user!.id,
    {
      $set: {
        avatarPublicId: null,
        avatarResourceType: null,
      },
    },
    { returnDocument: 'after' },
  );

  if (!user) throw notFound('User not found');

  invalidateUser(req.user!.phone);
  res.json({ user: userView(user) });
});

// ---- Notifications ---------------------------------------------------------

general.get('/notifications', authed, async (req, res) => {
  const rows = await Notification.find({ userId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const orderIds = [
    ...new Set(
      rows
        .map((n: any) => n.orderId?.toString())
        .filter(Boolean),
    ),
  ];

  const orders = orderIds.length
    ? await Order.find({ _id: { $in: orderIds } })
        .select('orderNumber')
        .lean()
    : [];

  const orderNumbers = new Map(
    orders.map((o: any) => [
      o._id.toString(),
      o.orderNumber,
    ]),
  );

  res.json({
    notifications: rows.map((n: any) => ({
      id: idOf(n._id),
      type: n.type,
      title: n.title,
      body: n.body,
      read: Boolean(n.readAt),
      createdAt: n.createdAt,
      orderId: n.orderId?.toString() ?? null,
      orderNumber: n.orderId
        ? orderNumbers.get(n.orderId.toString()) ?? null
        : null,
      announcementId: n.announcementId?.toString() ?? null,
    })),
  });
});

general.post('/notifications/read-all', authed, async (req, res) => {
  await Notification.updateMany(
    { userId: req.user!.id, readAt: null },
    { $set: { readAt: new Date() } },
  );

  res.status(204).end();
});

general.post('/notifications/:id/read', authed, async (req, res) => {
  if (!validId(String(req.params.id))) {
    throw new HttpError(404, 'not_found', 'Not found');
  }

  await Notification.updateOne(
    { _id: req.params.id, userId: req.user!.id },
    { $set: { readAt: new Date() } },
  );

  res.status(204).end();
});

general.delete('/notifications', authed, async (req, res) => {
  await Notification.deleteMany({ userId: req.user!.id });
  res.status(204).end();
});

general.delete('/notifications/:id', authed, async (req, res) => {
  if (!validId(String(req.params.id))) {
    throw new HttpError(404, 'not_found', 'Not found');
  }

  await Notification.deleteOne({
    _id: req.params.id,
    userId: req.user!.id,
  });

  res.status(204).end();
});

// ---- Devices ---------------------------------------------------------------

/**
 * Register or update this device's push notification token.
 * Firebase Cloud Messaging is retained for push delivery.
 */
general.post('/devices', authed, async (req, res) => {
  const { token, platform } = parse(
    z.object({
      token: z.string().min(10).max(4096),
      platform: z.enum(['android', 'ios', 'web']).optional(),
    }),
    req.body,
  );

  await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId: req.user!.id,
        platform: platform ?? null,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    },
  );

  res.status(204).end();
});

/** Sign-out: stop this device receiving notifications for this user. */
general.delete('/devices', authed, async (req, res) => {
  const { token } = parse(
    z.object({
      token: z.string().min(10).max(4096),
    }),
    req.body,
  );

  await DeviceToken.deleteOne({
    token,
    userId: req.user!.id,
  });

  res.status(204).end();
});

// ---- Account deletion ------------------------------------------------------

const OPEN_STATUSES = [
  'requested',
  'quoted',
  'accepted',
  'awaiting_payment',
  'ready_to_dispatch',
  'out_for_delivery',
];

/**
 * Customer self-service account deletion.
 * Completed orders are retained with personal details redacted.
 */
general.delete('/me', authed, async (req, res) => {
  const user = req.user!;

  if (user.role !== 'customer') {
    throw new HttpError(
      403,
      'not_allowed',
      'Staff accounts are removed by the store admin.',
    );
  }

  const open = await Order.findOne()
    .where('customerId')
    .equals(user.id)
    .where('status')
    .in(OPEN_STATUSES)
    .select('_id')
    .lean();

  if (open) {
    throw new HttpError(
      409,
      'active_orders',
      'You have an order in progress. Please wait until it is delivered or cancel it first.',
    );
  }

  const dbUser = await User.findById(user.id)
    .select('_id')
    .lean();

  if (!dbUser) throw notFound('User not found');

  const orders = await Order.find({ customerId: user.id })
    .select('prescriptions')
    .lean();

  const files = orders.flatMap((o: any) =>
    (o.prescriptions ?? [])
      .map((p: any) => p.publicId)
      .filter(Boolean),
  );

  await tx(async (session) => {
    // Preserve accounting/order history but remove personal order content.
    await Order.updateMany(
      { customerId: user.id },
      {
        $set: {
          note: null,
          addressSnapshot: null,
          items: [],
          prescriptions: [],
        },
      },
      { session },
    );

    await Address.deleteMany({ userId: user.id }).session(session);
    await DeviceToken.deleteMany({ userId: user.id }).session(session);
    await Notification.deleteMany({ userId: user.id }).session(session);

    await User.updateOne(
      { _id: user.id },
      {
        $set: {
          name: null,
          email: null,
          phone: `deleted-${user.id}`,
          avatarPublicId: null,
          avatarResourceType: null,
          gender: null,
          dateOfBirth: null,
          city: null,
          isActive: false,
        },
      },
      { session },
    );
  });

  invalidateUser(user.phone);

  if (files.length) {
    await deletePrescriptionFiles(files);
  }

  res.status(204).end();
});
