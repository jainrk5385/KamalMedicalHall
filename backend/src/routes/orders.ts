import express, { Router } from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { authed, requireRole } from '../auth.js';
import type { AuthUser } from '../auth.js';
import { config } from '../config.js';
import { tx } from '../db.js';
import {
  HttpError,
  bad,
  conflict,
  notFound,
  parse,
  publicBase,
} from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { fillOrderCoordinates } from '../geocode.js';
import {
  distanceMeters,
  etaMinutes,
  releasePartner,
  storeLocation,
} from '../partnerState.js';
import { CANCELLABLE, loadOrder, transition } from '../orderService.js';
import { isServiceable } from '../pincodes.js';
import { isDateBookable } from '../slots.js';
import { INVOICE_STATUSES, streamInvoice } from '../invoice.js';
import {
  isBlockedFile,
  jpgUrl,
  razorpayClient,
  verifyPaymentSignature,
  verifyRazorpayPayment,
  verifyWebhookSignature,
} from '../services.js';

import { Address } from '../models/Address.js';
import { Order, generateOrderNumber } from '../models/Order.js';
import { Payment } from '../models/Payment.js';
import { StoreSettings } from '../models/StoreSettings.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { Assignment } from '../models/Assignment.js';

export const orders = Router();
export const razorpayWebhook = Router();

const MAX_FILES = 3;
const MAX_BYTES = 10 * 1024 * 1024;

const createSchema = z.object({
  kind: z.enum(['prescription', 'medicines']),
  items: z.array(
    z.object({
      name: z.string().trim().min(2).max(120),
      quantity: z.number().int().min(1).max(99),
    }),
  ).max(30).default([]),
  prescriptions: z.array(
    z.object({
      publicId: z.string().min(1).max(300),
      mimeType: z.string().min(3).max(120),
      resourceType: z.enum(['image', 'raw', 'video']).default('image'),
      sizeBytes: z.number().int().positive().max(MAX_BYTES),
      url: z.string().url().max(600),
    }),
  ).max(MAX_FILES).default([]),
  note: z.string().trim().max(300).optional(),
  addressId: z.string().min(1),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliverySlot: z.string().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

orders.post('/', authed, requireRole('customer'), async (req, res) => {
  const user = req.user!;
  const b = parse(createSchema, req.body);

  if (!mongoose.isValidObjectId(b.addressId)) {
    throw bad('Invalid address.', 'invalid_address');
  }

  if (b.prescriptions.length < 1) {
    throw bad(
      'Please upload your prescription to place an order.',
      'prescription_required',
    );
  }

  if (
    b.prescriptions.some(
      (p) =>
        !p.publicId.startsWith(`prescriptions/${user.id}/`) ||
        isBlockedFile(p.publicId),
    )
  ) {
    throw bad('Invalid prescription file.', 'invalid_file');
  }

  const store = await StoreSettings.findOne().lean();

  if (!store) {
    throw new HttpError(503, 'store_unavailable', 'Store settings are unavailable.');
  }

  if (!isDateBookable(b.deliveryDate, new Date(), store.orderCutoffTime)) {
    throw bad(
      'That delivery date is no longer available. Please choose another.',
      'slot_unavailable',
    );
  }

  if (!store.isOpen) {
    throw new HttpError(
      409,
      'store_closed',
      'The store is currently not accepting orders.',
    );
  }

  const address = await Address.findOne({
    _id: b.addressId,
    userId: user.id,
  }).lean();

  if (!address) throw notFound('Address not found');

  if (!(await isServiceable(address.pincode))) {
    throw new HttpError(
      422,
      'unsupported_pincode',
      'Sorry, we do not deliver to this pincode yet.',
    );
  }

  const snapshot = {
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    pincode: address.pincode,
    city: address.city,
    latitude: address.latitude,
    longitude: address.longitude,
  };

  const created = await tx(async (session) => {
    const existing = await Order.findOne({
      customerId: user.id,
      idempotencyKey: b.idempotencyKey,
    }).session(session);

    if (existing) {
      return {
        id: existing._id.toString(),
        replay: true,
      };
    }

        const orderNumber = await generateOrderNumber();

    const [order] = await Order.create(
      [
        {
          orderNumber,
          customerId: user.id,
          kind: 'prescription',
          note: b.note ?? null,
          addressSnapshot: snapshot,
          deliveryDate: b.deliveryDate,
          deliverySlot: null,
          idempotencyKey: b.idempotencyKey,
          items: b.items,
          prescriptions: b.prescriptions,
          status: 'requested',
          statusHistory: [
            {
              status: 'requested',
              actorId: user.id,
              reason: null,
              createdAt: new Date(),
            },
          ],
        },
      ],
      { session },
    );

    await notifyAdmins(
      order._id.toString(),
      'order_requested',
      'New order request',
      `${order.orderNumber} from ${user.name ?? user.phone}`,
      session,
    );

    return {
      id: order._id.toString(),
      replay: false,
    };
  });

  if (!created.replay) {
   void fillOrderCoordinates(created.id, {
  line1: snapshot.line1,
  line2: snapshot.line2 ?? undefined,
  landmark: snapshot.landmark ?? undefined,
  pincode: snapshot.pincode,
  city: snapshot.city ?? undefined,
  latitude: snapshot.latitude,
}).catch(() => undefined);
  }

  res
    .status(created.replay ? 200 : 201)
    .json({ order: await loadOrder(created.id, user) });
});

orders.get('/', authed, requireRole('customer'), async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

  const { scope, limit, offset, from, to } = parse(
    z.object({
      scope: z.enum(['completed', 'cancelled', 'active']).default('completed'),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      offset: z.coerce.number().int().min(0).default(0),
      from: date,
      to: date,
    }),
    req.query,
  );

  const statusFilter =
    scope === 'completed'
      ? { status: 'delivered' }
      : scope === 'cancelled'
        ? { status: { $in: ['cancelled', 'rejected'] } }
        : { status: { $nin: ['delivered', 'rejected', 'cancelled'] } };

  const filter: Record<string, unknown> = {
    customerId: req.user!.id,
    ...statusFilter,
  };

  if (from || to) {
    const dateFilter: Record<string, Date> = {};

    if (from) {
      dateFilter.$gte = new Date(`${from}T00:00:00+05:30`);
    }

    if (to) {
      dateFilter.$lte = new Date(`${to}T23:59:59.999+05:30`);
    }

    filter.createdAt = dateFilter;
  }

  const rows = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

  res.json({
    orders: rows.map((r) => ({
      id: r._id.toString(),
      orderNumber: r.orderNumber,
      kind: r.kind,
      status: r.status,
      createdAt: r.createdAt,
      quotedAmount:
        r.quotedAmount === null ? null : Number(r.quotedAmount),
      fileCount: r.prescriptions?.length ?? 0,
      summary:
        r.items?.map((i) => `${i.name} x${i.quantity}`).join(', ') ?? '',
    })),
    hasMore: rows.length === limit,
  });
});

/** Downloads the customer's prescription pictures as JPEG for the invoice. */
async function prescriptionImages(orderId: string): Promise<Buffer[]> {
  const order = await Order.findById(orderId).select('prescriptions').lean();

  if (!order) return [];

  const out: Buffer[] = [];

  for (const r of (order.prescriptions ?? []).slice(0, 3)) {
    const url = jpgUrl(
      r.publicId,
      r.mimeType,
      r.resourceType,
      1,
      1000,
    );

    if (!url) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) continue;

      const buf = Buffer.from(await response.arrayBuffer());
      const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const png = buf[0] === 0x89 && buf[1] === 0x50;

      if (
        buf.length > 0 &&
        buf.length < 6_000_000 &&
        (jpeg || png)
      ) {
        out.push(buf);
      }
    } catch {
      // Skip an unavailable prescription image.
    } finally {
      clearTimeout(timer);
    }
  }

  return out;
}

orders.get('/:id/invoice-link', authed, async (req, res) => {
  if (req.user!.role === 'delivery_partner') {
    throw new HttpError(403, 'forbidden', 'Not allowed');
  }

  const order = await loadOrder(String(req.params.id), req.user!);

  if (
    order.quotedAmount === null ||
    !INVOICE_STATUSES.includes(order.status)
  ) {
    throw conflict(
      'The invoice is available after you accept the amount.',
      'no_invoice',
    );
  }

  const token = jwt.sign(
    { oid: order.id, purpose: 'invoice' },
    config.jwtSecret,
    { expiresIn: '10m' },
  );

  res.json({
    url: `${publicBase(req)}/orders/${order.id}/invoice.pdf?t=${encodeURIComponent(token)}`,
  });
});

orders.get('/:id/invoice.pdf', async (req, res) => {
  let oid = '';

  try {
    const payload = jwt.verify(
      String(req.query.t ?? ''),
      config.jwtSecret,
    ) as { oid?: string; purpose?: string };

    if (
      payload.purpose !== 'invoice' ||
      payload.oid !== req.params.id
    ) {
      throw new Error('Wrong token');
    }

    oid = payload.oid;
  } catch {
    throw new HttpError(
      401,
      'invalid_link',
      'This invoice link has expired. Please open it again from the app.',
    );
  }

  const order = await loadOrder(oid, {
    id: 'system',
    role: 'admin',
    phone: '',
    name: null,
  } as unknown as AuthUser);

  const store = await StoreSettings.findOne().lean();
  const images = await prescriptionImages(order.id);

  streamInvoice(
    res,
    order,
    {
      name: 'Kamal Medical Hall',
      address: store?.address ?? null,
      phone: store?.phone ?? null,
      email: store?.email ?? null,
    },
    images,
  );
});

orders.get('/:id', authed, async (req, res) => {
  res.json({
    order: await loadOrder(String(req.params.id), req.user!),
  });
});

orders.post('/:id/cancel', authed, requireRole('customer'), async (req, res) => {
  const { reason } = parse(
    z.object({
      reason: z.string().trim().min(5).max(300),
    }),
    req.body,
  );

  const order = await loadOrder(String(req.params.id), req.user!);

  await tx(async (session) => {
    const current = await Order.findById(order.id)
      .select('partnerId')
      .session(session);

    const row = await transition(
      session,
      order.id,
      CANCELLABLE,
      'cancelled',
      req.user!.id,
      {
        cancel_reason: reason,
        cancelled_by: req.user!.id,
        partner_id: null,
        partner_accepted_at: null,
      },
      reason,
    );

    const partnerId = current?.partnerId?.toString();

    await Assignment.updateMany(
  {
    orderId: order.id,
    status: { $in: ['pending', 'accepted'] },
  },
  {
    $set: {
      status: 'cancelled',
      respondedAt: new Date(),
    },
  },
).session(session);

    if (partnerId) {
      await releasePartner(session, partnerId);
    }

    const paid = row.payment_status === 'paid';

    await notifyAdmins(
      order.id,
      'order_cancelled',
      'Order cancelled by customer',
      `${order.orderNumber}: ${reason}${paid ? ' (online payment was already received; handle manually)' : ''}`,
      session,
    );

    if (partnerId) {
      await notify(
        partnerId,
        order.id,
        'order_cancelled',
        'Delivery cancelled',
        `${order.orderNumber} was cancelled`,
        session,
      );
    }
  });

  res.json({
    order: await loadOrder(order.id, req.user!),
  });
});

const acceptSchema = z.object({
  paymentMethod: z.enum(['razorpay', 'cod']),
});

orders.post('/:id/accept-quote', authed, requireRole('customer'), async (req, res) => {
  const { paymentMethod } = parse(acceptSchema, req.body);
  const order = await loadOrder(String(req.params.id), req.user!);

  if (!['quoted', 'awaiting_payment'].includes(order.status)) {
    throw conflict(
      'This order can no longer be changed this way. Please refresh.',
      'invalid_state',
    );
  }

  if (
    order.status === 'quoted' &&
    order.quoteExpiresAt &&
    new Date(order.quoteExpiresAt) < new Date()
  ) {
    throw conflict(
      'This quote has expired. Please contact the store.',
      'quote_expired',
    );
  }

  if (order.quotedAmount === null) {
    throw conflict('No quote available yet.', 'no_quote');
  }

  const amountPaise = Math.round(Number(order.quotedAmount) * 100);

  if (
    !Number.isSafeInteger(amountPaise) ||
    amountPaise <= 0 ||
    Math.abs(Number(order.quotedAmount) * 100 - amountPaise) > 1e-7
  ) {
    throw bad('The quoted amount is invalid.', 'invalid_payment_amount');
  }

  type RzOrder = {
    id: string;
    amount: number;
    currency: string;
  };

  // An already accepted online quote must reuse its existing Razorpay order.
  // Never create a second payable provider order for the same pending payment.
  if (order.status === 'awaiting_payment' && paymentMethod === 'razorpay') {
    const existingPayment = await Payment.findOne({
      orderId: order.id,
      method: 'razorpay',
      status: 'pending',
      razorpayOrderId: { $type: 'string', $ne: '' },
    }).lean();

    if (!existingPayment?.razorpayOrderId) {
      throw conflict(
        'Your payment setup is still being processed. Please refresh and try again.',
        'payment_setup_pending',
      );
    }

    const razorpayOrder = await razorpayClient().orders.fetch(
      existingPayment.razorpayOrderId,
    ) as unknown as RzOrder;

    // Confirm the stored provider order still matches this quote before
    // returning it to the client for checkout.
    if (
      razorpayOrder.id !== existingPayment.razorpayOrderId ||
      razorpayOrder.amount !== amountPaise ||
      razorpayOrder.currency !== 'INR'
    ) {
      throw new HttpError(
        409,
        'payment_order_mismatch',
        'The existing payment order does not match this quote. Please contact the store.',
      );
    }

    res.json({
      order: await loadOrder(order.id, req.user!),
      razorpay: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: config.razorpay.keyId,
      },
    });
    return;
  }

  let razorpayOrder: RzOrder | null = null;

  if (paymentMethod === 'razorpay') {
    try {
      razorpayOrder = await razorpayClient().orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: order.orderNumber,
      }) as unknown as RzOrder;
    } catch (error) {
      if (error instanceof HttpError) throw error;

      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'razorpay order not created',
          status: (error as { statusCode?: number }).statusCode,
          reason: (error as { error?: { description?: string } }).error?.description,
        }),
      );

      throw new HttpError(
        502,
        'payment_provider_error',
        'Online payment is not available right now. Please try again or choose cash on delivery.',
      );
    }

    if (
      !razorpayOrder?.id ||
      razorpayOrder.amount !== amountPaise ||
      razorpayOrder.currency !== 'INR'
    ) {
      throw new HttpError(
        502,
        'payment_provider_error',
        'The payment provider returned an invalid order. Please try again.',
      );
    }
  }

  await tx(async (session) => {
    // Only the first request may move a quoted order into payment.
    // A concurrent request loses this conditional transition and cannot
    // replace the active payment record.
    await transition(
      session,
      order.id,
      paymentMethod === 'cod' ? ['quoted', 'awaiting_payment'] : ['quoted'],
      paymentMethod === 'cod' ? 'ready_to_dispatch' : 'awaiting_payment',
      req.user!.id,
      {
        payment_method: paymentMethod,
        payment_status: paymentMethod === 'cod' ? 'cod_pending' : 'pending',
      },
    );

    // Keep old records for auditability; mark superseded pending payments
    // as cancelled instead of deleting payment history.
    await Payment.updateMany(
      {
        orderId: order.id,
        status: 'pending',
      },
      {
        $set: { status: 'cancelled' },
      },
      { session },
    );

    const payment = new Payment({
      orderId: order.id,
      method: paymentMethod,
      amount: Number(order.quotedAmount),
      status: paymentMethod === 'cod' ? 'cod_pending' : 'pending',
      razorpayOrderId: razorpayOrder?.id ?? null,
    });

    await payment.save({ session });

    if (paymentMethod === 'cod') {
      await tellPartnerConfirmed(session, order.id, order.orderNumber);
    }

    await notifyAdmins(
      order.id,
      paymentMethod === 'cod' ? 'ready_to_dispatch' : 'awaiting_payment',
      'Quote accepted',
      `${order.orderNumber} accepted (${paymentMethod === 'cod' ? 'Cash on delivery' : 'Razorpay'})`,
      session,
    );
  });

  res.json({
    order: await loadOrder(order.id, req.user!),
    razorpay: razorpayOrder
      ? {
          orderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          keyId: config.razorpay.keyId,
        }
      : null,
  });
});

async function tellPartnerConfirmed(
  session: mongoose.ClientSession,
  orderId: string,
  orderNumber: string,
) {
  const order = await Order.findById(orderId)
    .select('partnerId')
    .session(session);

  if (order?.partnerId) {
    await notify(
      order.partnerId.toString(),
      orderId,
      'order_confirmed',
      'Customer confirmed the order',
      `${orderNumber} is confirmed. You can start the delivery when you are ready.`,
      session,
    );
  }
}

async function markPaid(
  session: mongoose.ClientSession,
  razorpayOrderId: string,
  paymentId: string,
  signature: string | null,
  paidPaise?: number,
) {
  const payment = await Payment.findOne({
    razorpayOrderId,
  }).session(session);

  if (!payment) throw notFound('Payment not found');

  if (payment.method !== 'razorpay') {
    throw conflict('This is not an online payment.', 'payment_method_mismatch');
  }

  if (
    paidPaise !== undefined &&
    paidPaise !== Math.round(Number(payment.amount) * 100)
  ) {
    throw conflict(
      'Paid amount does not match the order.',
      'amount_mismatch',
    );
  }

  if (payment.status === 'paid') {
    if (
      payment.razorpayPaymentId &&
      payment.razorpayPaymentId !== paymentId
    ) {
      throw conflict(
        'A different payment has already been recorded for this order.',
        'payment_id_mismatch',
      );
    }

    return payment.orderId.toString();
  }

  const updated = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: { $ne: 'paid' },
    },
    {
      $set: {
        status: 'paid',
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      },
    },
    {
      returnDocument: 'after',
      session,
    },
  );

  if (!updated) {
    return payment.orderId.toString();
  }

  const order = await Order.findById(payment.orderId).session(session);

  if (!order) throw notFound('Order not found');

  if (order.status === 'awaiting_payment') {
    await transition(
      session,
      order._id.toString(),
      ['awaiting_payment'],
      'ready_to_dispatch',
      null,
      { payment_status: 'paid' },
    );

    await tellPartnerConfirmed(
      session,
      order._id.toString(),
      order.orderNumber,
    );

    await notifyAdmins(
      order._id.toString(),
      'payment_received',
      'Payment received',
      `${order.orderNumber} paid online and is ready to dispatch`,
      session,
    );

    await notify(
      order.customerId.toString(),
      order._id.toString(),
      'payment_received',
      'Payment received',
      `Your payment for ${order.orderNumber} was successful.`,
      session,
    );

    return order._id.toString();
  }

  // Payment received after cancellation or another terminal state:
  // record it for manual handling, without automatically promising a refund.
  await Order.updateOne(
    { _id: order._id },
    { $set: { paymentStatus: 'paid' } },
    { session },
  );

  await notifyAdmins(
    order._id.toString(),
    'payment_after_cancel',
    'Payment received on a closed order',
    `Order ${order.orderNumber} was paid but is ${order.status}. Handle manually.`,
    session,
  );

  return order._id.toString();
}

orders.post('/:id/payment/verify', authed, requireRole('customer'), async (req, res) => {
  const b = parse(
    z.object({
      razorpayOrderId: z.string().min(1).max(100),
      razorpayPaymentId: z.string().min(1).max(100),
      razorpaySignature: z.string().min(1).max(200),
    }),
    req.body,
  );

  const order = await loadOrder(String(req.params.id), req.user!);

  const own = await Payment.findOne({
    orderId: order.id,
    method: 'razorpay',
    razorpayOrderId: b.razorpayOrderId,
  }).lean();

  if (!own) {
    throw bad('Payment does not belong to this order.', 'payment_mismatch');
  }

  if (
    !verifyPaymentSignature(
      b.razorpayOrderId,
      b.razorpayPaymentId,
      b.razorpaySignature,
    )
  ) {
    throw bad('Payment could not be verified.', 'bad_signature');
  }

  const expectedAmountPaise = Math.round(Number(own.amount) * 100);

  // A valid checkout signature alone is not enough: independently confirm
  // the payment's order, amount, currency and captured status with Razorpay.
  await verifyRazorpayPayment(
    b.razorpayPaymentId,
    b.razorpayOrderId,
    expectedAmountPaise,
  );

  await tx((session) =>
    markPaid(
      session,
      b.razorpayOrderId,
      b.razorpayPaymentId,
      b.razorpaySignature,
      expectedAmountPaise,
    ),
  );

  res.json({
    order: await loadOrder(order.id, req.user!),
  });
});

// Razorpay webhook: mounted with a raw body parser.
razorpayWebhook.post(
  '/',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const signature = String(req.headers['x-razorpay-signature'] ?? '');

    if (
      !Buffer.isBuffer(req.body) ||
      !verifyWebhookSignature(req.body, signature)
    ) {
      throw new HttpError(400, 'bad_signature', 'Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8')) as {
      event: string;
      payload?: {
        payment?: {
          entity?: {
            id: string;
            order_id: string;
            amount?: number;
          };
        };
      };
    };

    const entity = event.payload?.payment?.entity;

    if (
      (event.event === 'payment.captured' || event.event === 'order.paid') &&
      entity
    ) {
      try {
        await tx((session) =>
          markPaid(
            session,
            entity.order_id,
            entity.id,
            null,
            entity.amount,
          ),
        );
      } catch (error) {
        if (
          error instanceof HttpError &&
          [404, 409].includes(error.status)
        ) {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'razorpay webhook not applied',
              code: error.code,
              event: event.event,
              razorpayOrder: entity.order_id,
            }),
          );
        } else {
          throw error;
        }
      }
    }

    res.json({ ok: true });
  },
);

orders.get('/:id/tracking', authed, requireRole('customer'), async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);

  const raw = await Order.findById(order.id)
    .select('partnerId partnerAcceptedAt addressSnapshot')
    .lean();

  const partner = raw?.partnerId
    ? await DeliveryPartner.findOne({ userId: raw.partnerId })
        .select('lastLat lastLng lastSeen')
        .lean()
    : null;

  const store = await storeLocation();

  const latitude = raw?.addressSnapshot?.latitude;
  const longitude = raw?.addressSnapshot?.longitude;

  const dest =
    latitude != null && longitude != null
      ? { lat: latitude, lng: longitude }
      : null;

  const live =
    order.status === 'out_for_delivery' &&
    partner?.lastLat != null &&
    partner?.lastLng != null;

  const rider = live
    ? {
        lat: partner!.lastLat!,
        lng: partner!.lastLng!,
        updatedAt: partner!.lastSeen,
      }
    : null;

  const from = rider ?? store;

  res.json({
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    store: store ? { lat: store.lat, lng: store.lng } : null,
    destination: dest,
    partner: order.partner ? { name: order.partner.name } : null,
    rider,
    etaMinutes:
      dest &&
      from &&
      ['ready_to_dispatch', 'out_for_delivery'].includes(order.status)
        ? etaMinutes(distanceMeters(from, dest))
        : null,
  });
});
