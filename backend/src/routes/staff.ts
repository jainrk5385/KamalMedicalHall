
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { authed, normalisePhone, requireRole } from '../auth.js';
import { config } from '../config.js';
import { tx } from '../db.js';
import { bad, conflict, HttpError, notFound, parse } from '../http.js';
import { cashToCollect, closingMessage, closingSummary, settleCash } from '../cash.js';
import { notify, notifyAdmins, notifyMany } from '../notify.js';
import { CANCELLABLE, loadOrder, transition, type OrderStatus } from '../orderService.js';
import { closeStore, reopenStore, setDutyStatus, type DutyStatus } from '../dutyService.js';
import {
  distanceMeters, etaMinutes, getTodayISTDateKey, releasePartner,
  setPartnerState, storeLocation,
} from '../partnerState.js';
import { clearPincodeCache } from '../pincodes.js';
import { isBlockedFile } from '../services.js';
import { emitAdmins, emitUser } from '../realtime.js';

import { User } from '../models/User.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { Order } from '../models/Order.js';
import { Assignment } from '../models/Assignment.js';
import { Payment } from '../models/Payment.js';
import Attendance from '../models/Attendance.js';
import { ServicePincode } from '../models/ServicePincode.js';
import { PartnerPincode } from '../models/PartnerPincode.js';
import { StoreSettings } from '../models/StoreSettings.js';
import StoreClosedDay from '../models/StoreClosedDay.js';

export const adminRouter = Router();
export const partnerRouter = Router();

adminRouter.use(authed, requireRole('admin'));
partnerRouter.use(authed, requireRole('delivery_partner'));

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Record not found');
  return new Types.ObjectId(id);
};

const idString = (v: any) => String(v?._id ?? v?.id ?? v ?? '');

const istStart = (date = new Date()) => {
  const d = new Date(date);
  const ist = new Date(d.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
};

const todayKey = () => getTodayISTDateKey();

const activeOrderStatuses = [
  'quoted',
  'awaiting_payment',
  'ready_to_dispatch',
  'out_for_delivery',
];

const ASSIGNABLE: OrderStatus[] = [
  'quoted',
  'awaiting_payment',
  'ready_to_dispatch',
];

const listRow = (o: any) => ({
  id: idString(o._id),
  orderNumber: o.orderNumber,
  kind: o.kind,
  status: o.status,
  createdAt: o.createdAt,
  quotedAmount: o.quotedAmount == null ? null : Number(o.quotedAmount),
  paymentMethod: o.paymentMethod,
  paymentStatus: o.paymentStatus,
  customerName: o.customer?.name ?? o.customerName ?? null,
  customerPhone: o.customer?.phone ?? o.customerPhone ?? null,
  deliverySlot: o.deliverySlot,
  deliveryDate: o.deliveryDate,
  partnerName: o.partner?.name ?? o.partnerName ?? null,
  fileCount: Number(o.fileCount ?? o.prescriptions?.length ?? 0),
  summary: o.summary ?? (o.items ?? []).map((i: any) => `${i.name} x ${i.quantity}`).join(', '),
  partnerAccepted: Boolean(o.partnerAcceptedAt),
  pincode: o.addressSnapshot?.pincode ?? null,
  rejectedReason: o.assignmentReason ?? undefined,
  respondedAt: o.assignmentAt ?? undefined,
});

async function getStoreSettings(session?: any) {
  let query: any = StoreSettings.findOne();
  if (session) query = query.session(session);
  const settings = await query;
  if (!settings) throw new Error('Store settings document is missing.');
  return settings;
}

// ============================================================
// Admin: cash and dashboard
// ============================================================

adminRouter.get('/cash', async (_req, res) => {
  res.json(await cashToCollect());
});

adminRouter.post('/cash/settle', async (req, res) => {
  const b = parse(z.object({
    partnerId: z.string().min(1),
    orderIds: z.array(z.string().min(1)).max(200).optional(),
  }), req.body);

  const r = await settleCash(req.user!.id, b.partnerId, b.orderIds);
  if (!r.settled) {
    throw conflict('There is no cash to collect from this partner.', 'nothing_to_settle');
  }

  emitAdmins('cash:update', { partnerId: b.partnerId });
  res.json({ ...r, ...(await cashToCollect()) });
});

adminRouter.get('/closing-summary', async (_req, res) => {
  const s = await closingSummary();
  res.json({ ...s, message: closingMessage(s) });
});

adminRouter.get('/dashboard', async (_req, res) => {
  const start = istStart();

  const [
    requested,
    awaiting,
    ready,
    outForDelivery,
    delivered,
    store,
  ] = await Promise.all([
    Order.countDocuments({ status: 'requested' }),
    Order.countDocuments({ status: { $in: ['quoted', 'accepted', 'awaiting_payment'] } }),
    Order.countDocuments({ status: 'ready_to_dispatch' }),
    Order.countDocuments({ status: 'out_for_delivery' }),
    Order.find({
      status: 'delivered',
      deliveredAt: { $gte: start },
    }).select('quotedAmount').lean(),
    getStoreSettings(),
  ]);

  res.json({
    isOpen: store.isOpen,
    requested,
    awaitingPayment: awaiting,
    readyToDispatch: ready,
    outForDelivery,
    deliveredToday: delivered.length,
    salesToday: delivered.reduce((sum: number, o: any) => sum + Number(o.quotedAmount ?? 0), 0),
  });
});

// ============================================================
// Admin: orders
// ============================================================

adminRouter.get('/orders', async (req, res) => {
  const q = parse(z.object({
    status: z.string().optional(),
    search: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  }), req.query);

  const filter: Record<string, any> = {};
  const statuses = q.status?.split(',').filter(Boolean) ?? [];
  if (statuses.length) filter.status = { $in: statuses };

  if (q.search) {
    const regex = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchingUsers = await User.find({
      $or: [{ name: regex }, { phone: regex }],
    }).distinct('_id');

    filter.$or = [
      { orderNumber: regex },
      { customerId: { $in: matchingUsers } },
    ];
  }

  const rows = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip(q.offset)
    .limit(q.limit)
    .populate('customerId', 'name phone')
    .populate('partnerId', 'name')
    .lean();

  res.json({
    orders: rows.map((o: any) => listRow({
      ...o,
      customer: o.customerId,
      partner: o.partnerId,
    })),
    hasMore: rows.length === q.limit,
  });
});

adminRouter.post('/orders/:id/quote', async (req, res) => {
  const { amount, bill } = parse(z.object({
    amount: z.number().positive().max(500000),
    bill: z.object({
      publicId: z.string().min(3).max(300),
      mimeType: z.string().min(3).max(120),
      resourceType: z.enum(['image', 'raw', 'video']).default('image'),
      sizeBytes: z.number().int().min(0).max(30_000_000).optional(),
      name: z.string().trim().max(160).optional(),
    }),
  }), req.body);

  if (
    !bill.publicId.startsWith('bills/') ||
    isBlockedFile(bill.publicId) ||
    isBlockedFile(bill.name ?? '')
  ) {
    throw bad('Invalid bill file.', 'invalid_file');
  }

  const order = await loadOrder(String(req.params.id), req.user!);
  const store = await getStoreSettings();
  const acceptRequired = store.customerAcceptRequired !== false;
  const expires = new Date(Date.now() + config.quoteValidHours * 3600000);

  const fields = {
    quoted_amount: amount,
    quote_expires_at: expires,
    reviewed_by: req.user!.id,
    bill_public_id: bill.publicId,
    bill_mime: bill.mimeType,
    bill_resource_type: bill.resourceType,
    bill_name: bill.name ?? null,
    bill_size: bill.sizeBytes ?? null,
    bill_uploaded_at: new Date(),
  };

  await tx(async (session) => {
    if (acceptRequired || order.status === 'quoted') {
      await transition(
        session,
        order.id,
        ['requested', 'quoted'],
        'quoted',
        req.user!.id,
        fields,
      );

      await notify(
        order.customer!.id,
        order.id,
        'quote_ready',
        'Your order amount is ready',
        `${order.orderNumber}: pay ₹${amount} (free delivery). Please review and accept.`,
        session,
      );
      return;
    }

    await transition(
      session,
      order.id,
      ['requested'],
      'ready_to_dispatch',
      req.user!.id,
      {
        ...fields,
        payment_method: 'cod',
        payment_status: 'cod_pending',
      },
    );

await Payment.deleteMany()
  .where('orderId')
  .equals(oid(order.id))
  .where('status')
  .equals('pending')
  .session(session);

    await Payment.create([{
      orderId: oid(order.id),
      method: 'cod',
      amount,
      status: 'cod_pending',
    }], { session });

    await notify(
      order.customer!.id,
      order.id,
      'order_confirmed',
      'Your order is confirmed',
      `${order.orderNumber}: ₹${amount} (free delivery). Pay on delivery by cash or UPI. The bill is in your order.`,
      session,
    );

    if (order.partner?.id) {
      await notify(
        order.partner.id,
        order.id,
        'order_confirmed',
        'Order confirmed',
        `${order.orderNumber} is confirmed. You can start the delivery when you are ready.`,
        session,
      );
    }
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/reject', async (req, res) => {
  const { reason } = parse(
    z.object({ reason: z.string().trim().min(3).max(300) }),
    req.body,
  );

  const order = await loadOrder(String(req.params.id), req.user!);

  await tx(async (session) => {
    await transition(
      session,
      order.id,
      ['requested'],
      'rejected',
      req.user!.id,
      {
        rejection_reason: reason,
        reviewed_by: req.user!.id,
      },
      reason,
    );

    await notify(
      order.customer!.id,
      order.id,
      'order_rejected',
      'Order could not be accepted',
      `${order.orderNumber}: ${reason}`,
      session,
    );
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/cancel', async (req, res) => {
  const { reason } = parse(
    z.object({ reason: z.string().trim().min(3).max(300) }),
    req.body,
  );

  const order = await loadOrder(String(req.params.id), req.user!);

  await tx(async (session) => {
    const current = await Order.findById(order.id).session(session);
    if (!current) throw notFound('Order not found');

    const partnerId = current.partnerId?.toString();

    await transition(
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

    await Assignment.updateMany(
      {
        orderId: oid(order.id),
        status: { $in: ['pending', 'accepted'] },
      },
      {
        $set: {
          status: 'cancelled',
          respondedAt: new Date(),
        },
      },
      { session },
    );

    if (partnerId) {
      await releasePartner(session, partnerId);
      await notify(
        partnerId,
        order.id,
        'order_cancelled',
        'Delivery cancelled',
        `${order.orderNumber} was cancelled by the store`,
        session,
      );
    }

    await notify(
      order.customer!.id,
      order.id,
      'order_cancelled',
      'Order cancelled by the store',
      `${order.orderNumber}: ${reason}`,
      session,
    );
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/assign', async (req, res) => {
  const { partnerId } = parse(
    z.object({ partnerId: z.string().min(1) }),
    req.body,
  );

  const order = await loadOrder(String(req.params.id), req.user!);

  if (order.partner) {
    throw conflict('This order already has a delivery partner. Unassign first.', 'already_assigned');
  }

  if (!ASSIGNABLE.includes(order.status)) {
    throw conflict('A delivery partner can be assigned once the amount has been sent.', 'invalid_state');
  }

  await tx(async (session) => {
    const partnerObjectId = oid(partnerId);
    const partner = await DeliveryPartner.findOne({
      userId: partnerObjectId,
    }).session(session);

    if (!partner || !partner.active) {
      throw conflict('That delivery partner is not active.', 'partner_unavailable');
    }

    const coverage = await PartnerPincode.find({
      partnerId: partnerObjectId,
    }).session(session).lean();

    if (
      coverage.length &&
      !coverage.some((p: any) => p.pincode === order.address?.pincode)
    ) {
      throw conflict('That delivery partner does not cover this pincode.', 'out_of_coverage');
    }

    if (['available', 'off', 'break'].includes(partner.state)) {
      await setPartnerState(session, partnerId, 'reserved');
    }

    await Assignment.create([{
      orderId: oid(order.id),
      partnerId: partnerObjectId,
      status: 'pending',
      assignedAt: new Date(),
    }], { session });

    await transition(
      session,
      order.id,
      ASSIGNABLE,
      order.status,
      req.user!.id,
      {
        partner_id: partnerId,
        partner_accepted_at: null,
      },
      'Partner assigned',
    );

    const waiting = order.status !== 'ready_to_dispatch';

    await notify(
      partnerId,
      order.id,
      'assigned',
      'New delivery request',
      `${order.orderNumber} to ${order.address?.line1 ?? 'customer address'}.${waiting ? ' The customer has not confirmed yet; you can accept now.' : ' Please accept or reject.'}`,
      session,
    );
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/unassign', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);

  await tx(async (session) => {
    const current = await Order.findById(order.id).session(session);
    if (!current) throw notFound('Order not found');

    const partnerId = current.partnerId?.toString();
    if (!partnerId) {
      throw conflict('No delivery partner is assigned.', 'not_assigned');
    }

    const wasOut = order.status === 'out_for_delivery';

    await transition(
      session,
      order.id,
      [...ASSIGNABLE, 'out_for_delivery'],
      wasOut ? 'ready_to_dispatch' : order.status,
      req.user!.id,
      {
        partner_id: null,
        partner_accepted_at: null,
      },
      'Partner unassigned',
    );

    await Assignment.updateMany(
      {
        orderId: oid(order.id),
        status: { $in: ['pending', 'accepted'] },
      },
      {
        $set: {
          status: 'cancelled',
          respondedAt: new Date(),
        },
      },
      { session },
    );

    await releasePartner(session, partnerId);

    await notify(
      partnerId,
      order.id,
      'unassigned',
      'Delivery removed',
      `${order.orderNumber} was taken back by the store`,
      session,
    );

    if (wasOut) {
      await notify(
        order.customer!.id,
        order.id,
        'reassigning',
        'Delivery being reassigned',
        `${order.orderNumber} will be handed to another delivery partner shortly.`,
        session,
      );
    }
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

// ============================================================
// Admin: delivery partners
// ============================================================

adminRouter.post('/partners', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().trim().min(10).max(15),
    }),
    req.body,
  );
  const phone = normalisePhone(body.phone);
  let id = '';

  try {
    const user = await User.create({
      phone,
      role: 'delivery_partner',
      name: body.name,
      signedUpAt: new Date(),
    });

    try {
      await DeliveryPartner.create({ userId: user._id });
      id = user._id.toString();
    } catch (profileError) {
      // Keep the user collection clean if the second standalone write fails.
      try {
        await User.deleteOne({ _id: user._id }).exec();
      } catch (cleanupError) {
        console.error(JSON.stringify({
          level: 'error',
          msg: 'delivery_partner_create_cleanup_failed',
          error: cleanupError instanceof Error
            ? { name: cleanupError.name, message: cleanupError.message }
            : String(cleanupError),
        }));
      }
      throw profileError;
    }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new HttpError(
        409,
        'already_registered',
        'This mobile number already has an account.',
      );
    }

    throw error;
  }

  emitAdmins('partner:update', { partnerId: id });
  res.status(201).json({ id });
});

adminRouter.post('/broadcast', async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(2).max(60),
      body: z.string().trim().min(2).max(240),
    }),
    req.body,
  );

  const customers = await User.find({
    role: 'customer',
    isActive: { $ne: false },
  })
    .select('_id')
    .lean()
    .exec();

  const customerIds = customers.map((customer) => customer._id.toString());
  await notifyMany(customerIds, 'announcement', body.title, body.body);

  res.json({ sent: customerIds.length });
});

adminRouter.get('/partners', async (_req, res) => {
  const day = todayKey();
  const start = istStart();

  const partners = await DeliveryPartner.find()
    .populate('userId', 'name phone')
    .lean();

  const userIds = partners.map((p: any) => p.userId?._id).filter(Boolean);

  const [attendance, orders, completed, pincodes, payments] = await Promise.all([
    Attendance.find({
      partnerId: { $in: userIds },
      day,
    } as any).lean(),
    Order.find({
      partnerId: { $in: userIds },
      status: { $in: activeOrderStatuses },
    } as any).select('partnerId').lean(),
    Assignment.find({
      partnerId: { $in: userIds },
      status: 'completed',
      completedAt: { $gte: start },
    } as any).lean(),
    PartnerPincode.find({ partnerId: { $in: userIds } }).lean(),
    Payment.find({
      status: 'cod_collected',
      collectedAt: { $gte: start },
    }).populate({
      path: 'orderId',
      select: 'partnerId quotedAmount',
    }).lean(),
  ]);

  const attendanceByPartner = new Map(attendance.map((a: any) => [a.partnerId.toString(), a]));
  const activeCount = new Map<string, number>();
  const deliveredCount = new Map<string, number>();
  const pincodeMap = new Map<string, string[]>();
  const codMap = new Map<string, number>();

  for (const o of orders as any[]) {
    const key = o.partnerId.toString();
    activeCount.set(key, (activeCount.get(key) ?? 0) + 1);
  }

  for (const a of completed as any[]) {
    const key = a.partnerId.toString();
    deliveredCount.set(key, (deliveredCount.get(key) ?? 0) + 1);
  }

  for (const p of pincodes as any[]) {
    const key = p.partnerId.toString();
    pincodeMap.set(key, [...(pincodeMap.get(key) ?? []), p.pincode]);
  }

  for (const payment of payments as any[]) {
    const partnerId = payment.orderId?.partnerId?.toString();
    if (partnerId) {
      codMap.set(
        partnerId,
        (codMap.get(partnerId) ?? 0) + Number(payment.amount ?? 0),
      );
    }
  }

  res.json({
    partners: partners.map((p: any) => {
      const user = p.userId;
      const key = user?._id?.toString() ?? '';
      const a: any = attendanceByPartner.get(key);
      const onDuty = Boolean(p.onDuty && p.onDutyDay === day);
      const state = ['available', 'returning', 'break'].includes(p.state) && !onDuty
        ? 'off'
        : p.state;

      const dutyStatus =
        a?.status === 'leave' || a?.status === 'paid_leave'
          ? 'leave'
          : a?.status === 'absent'
            ? 'absent'
            : state === 'break'
              ? 'on_break'
              : onDuty
                ? 'on_duty'
                : 'off_duty';

      return {
        id: key,
        name: user?.name,
        phone: user?.phone,
        active: p.active,
        state,
        isAvailable: state === 'available',
        onDuty,
        dutyStatus,
        paidLeave: a?.status === 'paid_leave',
        breakMinutes: Number(a?.breakMinutes ?? 0),
        canCallCustomer: p.canCallCustomer,
        checkedInAt: a?.checkedInAt ?? null,
        checkedOutAt: a?.checkedOutAt ?? null,
        lastSeen: p.lastSeen,
        activeOrders: activeCount.get(key) ?? 0,
        deliveredToday: deliveredCount.get(key) ?? 0,
        codCollectedToday: codMap.get(key) ?? 0,
        pincodes: pincodeMap.get(key) ?? [],
      };
    }),
  });
});

adminRouter.get('/attendance', async (req, res) => {
  const { days } = parse(
    z.object({
      days: z.coerce.number().int().min(1).max(31).default(7),
    }),
    req.query,
  );

  const today = todayKey();
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDay = start.toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });

  const [partnerRows, attendanceRows, closedRows] = await Promise.all([
    DeliveryPartner.find({ active: true })
      .populate('userId', 'name phone role')
      .lean()
      .exec(),
    Attendance.find({
      day: { $gte: startDay, $lte: today },
    }).lean().exec(),
    StoreClosedDay.find({
      day: { $gte: startDay, $lte: today },
    })
      .select('day')
      .lean()
      .exec(),
  ]);

  const partners = (partnerRows as any[])
    .filter((partner) => partner.userId?.role === 'delivery_partner')
    .sort((a, b) =>
      String(a.userId?.name ?? '').localeCompare(String(b.userId?.name ?? '')),
    );
  const attendanceByPartnerDay = new Map<string, any>();

  for (const attendance of attendanceRows as any[]) {
    attendanceByPartnerDay.set(
      `${attendance.partnerId.toString()}:${attendance.day}`,
      attendance,
    );
  }

  const closedDays = (closedRows as any[]).map((row) => row.day as string);
  const closedDaySet = new Set(closedDays);
  const current = partners.map((partner) => {
    const user = partner.userId;
    const id = user._id.toString();
    const attendance = attendanceByPartnerDay.get(`${id}:${today}`);
    const onDuty = Boolean(partner.onDuty && partner.onDutyDay === today);
    const state = ['available', 'returning', 'break'].includes(partner.state) && !onDuty
      ? 'off'
      : partner.state;
    const isLeave = attendance?.status === 'leave' || attendance?.status === 'paid_leave';
    const present = Boolean(attendance?.checkedInAt) || attendance?.status === 'present';
    const dutyStatus = isLeave
      ? 'leave'
      : attendance?.status === 'absent'
        ? 'absent'
        : state === 'break'
          ? 'on_break'
          : onDuty
            ? 'on_duty'
            : 'off_duty';
    const notIn = !present && !isLeave && !closedDaySet.has(today);

    return {
      id,
      name: user.name ?? '',
      phone: user.phone,
      state,
      dutyStatus,
      paidLeave: attendance?.status === 'paid_leave',
      present,
      notIn,
      checkedInAt: attendance?.checkedInAt ?? null,
      checkedOutAt: attendance?.checkedOutAt ?? null,
      breakMinutes: Number(attendance?.breakMinutes ?? 0),
    };
  });

  const summary = {
    total: current.length,
    present: current.filter((partner) => partner.present).length,
    onDuty: current.filter((partner) => partner.dutyStatus === 'on_duty').length,
    onBreak: current.filter((partner) => partner.dutyStatus === 'on_break').length,
    offDuty: current.filter(
      (partner) => partner.dutyStatus === 'off_duty' && !partner.notIn,
    ).length,
    onLeave: current.filter((partner) => partner.dutyStatus === 'leave').length,
    absent: current.filter(
      (partner) => partner.notIn || partner.dutyStatus === 'absent',
    ).length,
    available: current.filter((partner) => partner.state === 'available').length,
    busy: current.filter((partner) => ['reserved', 'busy', 'returning'].includes(partner.state)).length,
  };

  const history = partners.map((partner) => {
    const user = partner.userId;
    const id = user._id.toString();

    return {
      id,
      name: user.name ?? '',
      days: dates.map((day) => {
        const attendance = attendanceByPartnerDay.get(`${id}:${day}`);
        if (!attendance) return null;
        if (attendance.status === 'break') return 'present';
        return attendance.status;
      }),
    };
  });

  res.json({
    dates,
    closedDays,
    today: current,
    summary,
    history,
  });
});

adminRouter.patch('/partners/:id', async (req, res) => {
  const b = parse(
    z.object({
      active: z.boolean().optional(),
      canCallCustomer: z.boolean().optional(),
    }),
    req.body,
  );

  if (b.active === undefined && b.canCallCustomer === undefined) {
    throw bad('Nothing to change.');
  }

  const partner = await DeliveryPartner.findOne({ userId: oid(String(req.params.id)) });
  if (!partner) throw notFound('Partner not found');

  if (b.active !== undefined) {
    partner.active = b.active;

    if (!b.active) {
      if (['available', 'returning'].includes(partner.state)) {
        partner.state = 'off';
      }
      partner.isAvailable = false;
      partner.onDuty = false;
    }
  }

  if (b.canCallCustomer !== undefined) {
    partner.canCallCustomer = b.canCallCustomer;
  }

  await partner.save();

  emitAdmins('partner:update', { partnerId: req.params.id });
  emitUser(String(req.params.id), 'partner:update', { partnerId: req.params.id });

  res.status(204).end();
});

adminRouter.post('/partners/:id/state', async (req, res) => {
  const { state } = parse(
    z.object({ state: z.enum(['available', 'off']) }),
    req.body,
  );

  await tx(async (session) => {
    const partner = await DeliveryPartner.findOne({
      userId: oid(String(req.params.id)),
    }).session(session);

    if (!partner) throw notFound('Partner not found');

    if (['reserved', 'busy'].includes(partner.state)) {
      throw conflict('This partner has an order in progress.', 'has_active_order');
    }

    if (state === 'available' && !partner.active) {
      throw conflict('This partner is inactive.', 'inactive');
    }

    const day = todayKey();

    partner.onDuty = state === 'available';
    if (partner.onDuty) partner.onDutyDay = day;
    await partner.save({ session });

    if (state === 'available') {
      await Attendance.findOneAndUpdate(
        { partnerId: oid(String(req.params.id)), day },
        {
          $set: { status: 'present', checkedOutAt: null },
          $setOnInsert: { checkedInAt: new Date(), breakMinutes: 0 },
        },
        { upsert: true, returnDocument: 'after', session },
      );
    } else {
      await Attendance.updateOne(
        {
          partnerId: oid(String(req.params.id)),
          day,
          checkedOutAt: null,
        },
        { $set: { checkedOutAt: new Date() } },
        { session },
      );
    }

    await setPartnerState(session, String(req.params.id), state);
  });

  emitAdmins('partner:update', { partnerId: req.params.id });
  res.status(204).end();
});

adminRouter.put('/partners/:id/pincodes', async (req, res) => {
  const { pincodes } = parse(
    z.object({
      pincodes: z.array(z.string().regex(/^\d{6}$/)).max(300),
    }),
    req.body,
  );

  const unique = [...new Set(pincodes)];
  const partnerId = oid(String(req.params.id));

  if (unique.length) {
    const valid = await ServicePincode.find({
      pincode: { $in: unique },
      active: true,
    }).distinct('pincode');

    const invalid = unique.filter((p) => !valid.includes(p));
    if (invalid.length) {
      throw bad(`Not in the delivery area: ${invalid.join(', ')}`);
    }
  }

  await tx(async (session) => {
    const exists = await DeliveryPartner.exists({ userId: partnerId }).session(session);
    if (!exists) throw notFound('Partner not found');

    await PartnerPincode.deleteMany({ partnerId }).session(session);

    if (unique.length) {
      await PartnerPincode.insertMany(
        unique.map((pincode) => ({ partnerId, pincode })),
        { session },
      );
    }
  });

  res.status(204).end();
});

// ============================================================
// Admin: delivery area / pincodes
// ============================================================

adminRouter.get('/pincodes', async (_req, res) => {
  const pincodes = await ServicePincode.find()
    .sort({ pincode: 1 })
    .select('pincode area active')
    .lean();

  res.json({ pincodes });
});

adminRouter.post('/pincodes', async (req, res) => {
  const b = parse(
    z.object({
      pincodes: z.array(
        z.string().regex(/^\d{6}$/, 'Pincodes must be 6 digits'),
      ).min(1).max(200),
      area: z.string().trim().max(80).optional(),
    }),
    req.body,
  );

  const unique = [...new Set(b.pincodes)];

  try {
    await ServicePincode.bulkWrite(
      unique.map((pincode) => ({
        updateOne: {
          filter: { pincode },
          update: {
            $set: {
              active: true,
              ...(b.area !== undefined ? { area: b.area } : {}),
            },
            $setOnInsert: { pincode },
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );
  } finally {
    // A bulk upsert may have saved earlier entries before a later entry fails.
    clearPincodeCache();
  }

  res.status(201).json({ added: unique.length });
});

adminRouter.patch('/pincodes/:pincode', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body);

  const result = await ServicePincode.updateOne(
    { pincode: String(req.params.pincode) },
    { $set: { active } },
  );

  if (!result.matchedCount) throw notFound('Pincode not found');

  clearPincodeCache();
  res.status(204).end();
});

adminRouter.delete('/pincodes/:pincode', async (req, res) => {
  const pincode = String(req.params.pincode);

  await tx(async (session) => {
    const result = await ServicePincode.deleteOne({ pincode }).session(session);
    if (!result.deletedCount) throw notFound('Pincode not found');

    await PartnerPincode.deleteMany({ pincode }).session(session);
  });

  clearPincodeCache();
  res.status(204).end();
});

// ============================================================
// Admin: reports
// ============================================================

adminRouter.get('/reports', async (req, res) => {
  const q = parse(
    z.object({
      days: z.coerce.number().int().min(1).max(366).default(30),
    }),
    req.query,
  );

  const todayStart = istStart();
  const since = new Date(todayStart.getTime() - (q.days - 1) * 86400_000);
  const until = new Date(todayStart.getTime() + 86400_000);

  const delivered = await Order.find({
    status: 'delivered',
    deliveredAt: { $gte: since, $lt: until },
  } as any)
    .select('deliveredAt quotedAmount paymentMethod partnerId')
    .populate('partnerId', 'name')
    .lean();

  const dailyMap = new Map<string, { orders: number; sales: number }>();
  const paymentMap = new Map<string, { orders: number; sales: number }>();
  const partnerMap = new Map<string, { name: string; orders: number }>();

  for (const order of delivered as any[]) {
    const date = new Date(order.deliveredAt ?? Date.now());
    const day = new Date(date.getTime() + 330 * 60_000)
      .toISOString()
      .slice(0, 10);

    const amount = Number(order.quotedAmount ?? 0);

    const daily = dailyMap.get(day) ?? { orders: 0, sales: 0 };
    daily.orders++;
    daily.sales += amount;
    dailyMap.set(day, daily);

    const method = order.paymentMethod ?? 'unknown';
    const payment = paymentMap.get(method) ?? { orders: 0, sales: 0 };
    payment.orders++;
    payment.sales += amount;
    paymentMap.set(method, payment);

    const partner = order.partnerId;
    if (partner?._id) {
      const id = partner._id.toString();
      const item = partnerMap.get(id) ?? {
        name: partner.name ?? 'Unknown',
        orders: 0,
      };
      item.orders++;
      partnerMap.set(id, item);
    }
  }

  const daily = [...dailyMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, value]) => ({ day, ...value }));

  const paymentSplit = [...paymentMap.entries()].map(([method, value]) => ({
    method,
    ...value,
  }));

  const perPartner = [...partnerMap.values()]
    .sort((a, b) => b.orders - a.orders);

  res.json({
    days: q.days,
    daily,
    paymentSplit,
    perPartner,
  });
});

// ============================================================
// Admin: store settings
// ============================================================

const settingsSchema = z.object({
  isOpen: z.boolean(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceM: z.number().int().min(30).max(2000).optional(),
  orderCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  customerAcceptRequired: z.boolean().optional(),
});

const settingsView = (s: any) => ({
  isOpen: s.isOpen,
  openingTime: s.openingTime,
  closingTime: s.closingTime,
  address: s.address,
  phone: s.phone,
  email: s.email,
  latitude: s.latitude,
  longitude: s.longitude,
  geofenceM: s.geofenceM,
  orderCutoffTime: s.orderCutoffTime,
  customerAcceptRequired: s.customerAcceptRequired,
});

adminRouter.get('/settings', async (_req, res) => {
  const settings = await getStoreSettings();
  res.json(settingsView(settings));
});

adminRouter.put('/settings', async (req, res) => {
  const s = parse(settingsSchema, req.body);

  await tx(async (session) => {
    const current = await StoreSettings.findOne().session(session);
    if (!current) throw new Error('Store settings document is missing.');

    const wasOpen = current.isOpen;

    current.isOpen = s.isOpen;
    current.openingTime = s.openingTime;
    current.closingTime = s.closingTime;

    if (s.address !== undefined) current.address = s.address;
    if (s.phone !== undefined) current.phone = s.phone;
    if (s.email !== undefined) current.email = s.email;
    if (s.latitude !== undefined) current.latitude = s.latitude;
    if (s.longitude !== undefined) current.longitude = s.longitude;
    if (s.geofenceM !== undefined) current.geofenceM = s.geofenceM;
    if (s.orderCutoffTime !== undefined) {
      current.orderCutoffTime = s.orderCutoffTime;
    }

    if (s.customerAcceptRequired !== undefined) {
      (current as any).customerAcceptRequired = s.customerAcceptRequired;
    }

    await current.save({ session });

    if (wasOpen && !s.isOpen) {
      await closeStore(session);
    } else if (!wasOpen && s.isOpen) {
      await reopenStore(session);
    }
  });

  emitAdmins('store:update', { isOpen: s.isOpen });
  res.status(204).end();
});

/** Quick open / closed switch. */
adminRouter.put('/store-open', async (req, res) => {
  const { isOpen } = parse(
    z.object({ isOpen: z.boolean() }),
    req.body,
  );

  await tx(async (session) => {
    const settings = await StoreSettings.findOne().session(session);
    if (!settings) throw new Error('Store settings document is missing.');

    const before = settings.isOpen;
    settings.isOpen = isOpen;
    await settings.save({ session });

    if (before && !isOpen) {
      await closeStore(session);
    } else if (!before && isOpen) {
      await reopenStore(session);
    }
  });

  emitAdmins('store:update', { isOpen });
  res.json({ isOpen });
});

// ============================================================
// Admin: terms and conditions
// ============================================================

adminRouter.get('/terms', async (_req, res) => {
  const settings = await getStoreSettings();

  res.json({
    text: settings.termsText ?? '',
    updatedAt: settings.termsUpdatedAt ?? null,
  });
});

adminRouter.put('/terms', async (req, res) => {
  const { text } = parse(
    z.object({ text: z.string().max(30000) }),
    req.body,
  );

  await StoreSettings.updateOne(
    {},
    {
      $set: {
        termsText: text.trim() || null,
        termsUpdatedAt: new Date(),
      },
    },
  );

  res.status(204).end();
});

// ============================================================
// Admin: store payment details
// ============================================================

const paymentSchema = z.object({
  upiId: z.string()
    .trim()
    .max(80)
    .regex(/^[\w.\-]{2,}@[\w.\-]{2,}$/, 'Enter a valid UPI ID, e.g. shop@upi')
    .nullable()
    .optional()
    .or(z.literal('')),
  upiName: z.string().trim().max(80).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankAccountName: z.string().trim().max(80).nullable().optional(),
  bankAccountNumber: z.string()
    .trim()
    .regex(/^\d{6,20}$/, 'Account number must be 6–20 digits')
    .nullable()
    .optional()
    .or(z.literal('')),
  bankIfsc: z.string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. SBIN0001234')
    .nullable()
    .optional()
    .or(z.literal('')),
});

const paymentDetailsView = (s: any) => ({
  upiId: s.upiId ?? null,
  upiName: s.upiName ?? null,
  bankName: s.bankName ?? null,
  bankAccountName: s.bankAccountName ?? null,
  bankAccountNumber: s.bankAccountNumber ?? null,
  bankIfsc: s.bankIfsc ?? null,
});

adminRouter.get('/payment-details', async (_req, res) => {
  const settings = await getStoreSettings();
  res.json(paymentDetailsView(settings));
});

adminRouter.put('/payment-details', async (req, res) => {
  const p = parse(paymentSchema, req.body);

  const value = (v: string | null | undefined) => v || null;

  await StoreSettings.updateOne(
    {},
    {
      $set: {
        upiId: value(p.upiId),
        upiName: value(p.upiName),
        bankName: value(p.bankName),
        bankAccountName: value(p.bankAccountName),
        bankAccountNumber: value(p.bankAccountNumber),
        bankIfsc: value(p.bankIfsc),
      },
    },
  );

  res.status(204).end();
});

// ============================================================
// Delivery partner helpers
// ============================================================

async function partnerRow(id: string) {
  const partner = await DeliveryPartner.findOne({
    userId: oid(id),
  }).lean();

  if (!partner) throw notFound('Partner profile not found');

  const today = todayKey();
  const onDuty = Boolean(partner.onDuty && partner.onDutyDay === today);

  const state =
    ['available', 'returning', 'break'].includes(partner.state) && !onDuty
      ? 'off'
      : partner.state;

  return {
    ...partner,
    effState: state,
    dutyToday: onDuty,
  };
}

async function dutyReply(userId: string) {
  const partner = await partnerRow(userId);

  const attendance = await Attendance.findOne({
    partnerId: oid(userId),
    day: todayKey(),
  }).lean();

  const state = partner.effState;

  const dutyStatus =
    attendance?.status === 'leave' || attendance?.status === 'paid_leave'
      ? 'leave'
      : attendance?.status === 'absent'
        ? 'absent'
        : state === 'break'
          ? 'on_break'
          : partner.dutyToday
            ? 'on_duty'
            : 'off_duty';

  return {
    state,
    dutyStatus,
    paidLeave: attendance?.status === 'paid_leave',
    onDuty: dutyStatus === 'on_duty' || dutyStatus === 'on_break',
  };
}

const dutyStatusSchema = z.object({
  status: z.enum(['on_duty', 'off_duty', 'on_break', 'leave']),
});

// ============================================================
// Delivery partner: profile and duty
// ============================================================

partnerRouter.get('/me', async (req, res) => {
  const partner = await partnerRow(req.user!.id);
  const store = await storeLocation();
  const attendance = await dutyReply(req.user!.id);
  const settings = await getStoreSettings();

  res.json({
    state: partner.effState,
    isAvailable: partner.effState === 'available',
    onDuty: partner.dutyToday,
    active: partner.active,
    canCallCustomer: partner.canCallCustomer,
    dutyStatus: attendance.dutyStatus,
    paidLeave: attendance.paidLeave,
    storeOpen: settings.isOpen,
    store: store
      ? {
          lat: store.lat,
          lng: store.lng,
          geofenceM: store.geofenceM,
        }
      : null,
  });
});

partnerRouter.post('/status', async (req, res) => {
  const { status } = parse(dutyStatusSchema, req.body);

  await tx((session) =>
    setDutyStatus(
      session,
      req.user!.id,
      status as DutyStatus,
      req.user!.name ?? null,
    ),
  );

  res.json(await dutyReply(req.user!.id));
});

/** Legacy on/off duty endpoint. */
partnerRouter.post('/duty', async (req, res) => {
  const { onDuty } = parse(
    z.object({ onDuty: z.boolean() }),
    req.body,
  );

  await tx((session) =>
    setDutyStatus(
      session,
      req.user!.id,
      onDuty ? 'on_duty' : 'off_duty',
      req.user!.name ?? null,
    ),
  );

  res.json(await dutyReply(req.user!.id));
});

partnerRouter.get('/attendance', async (req, res) => {
  const { days } = parse(
    z.object({
      days: z.coerce.number().int().min(1).max(31).default(14),
    }),
    req.query,
  );

  const today = todayKey();
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  todayDate.setUTCDate(todayDate.getUTCDate() - (days - 1));
  const startDay = todayDate.toISOString().slice(0, 10);

  const [rows, closed] = await Promise.all([
    Attendance.find({
      partnerId: oid(req.user!.id),
      day: { $gte: startDay, $lte: today },
    } as any)
      .sort({ day: -1 })
      .lean(),

    StoreClosedDay.find({
      day: { $gte: startDay, $lte: today },
    }).lean(),
  ]);

  const summary = {
    present: 0,
    leave: 0,
    paidLeave: 0,
    absent: 0,
  };

  for (const row of rows as any[]) {
    if (row.status === 'present') summary.present++;
    else if (row.status === 'leave') summary.leave++;
    else if (row.status === 'paid_leave') summary.paidLeave++;
    else if (row.status === 'absent') summary.absent++;
  }

  res.json({
    days: rows.map((row: any) => ({
      day: row.day,
      status: row.status,
      checkedInAt: row.checkedInAt,
      checkedOutAt: row.checkedOutAt,
      breakMinutes: row.breakMinutes,
    })),
    closedDays: closed.map((row: any) => row.day),
    summary,
  });
});

partnerRouter.put('/availability', async (req, res) => {
  const { available } = parse(
    z.object({ available: z.boolean() }),
    req.body,
  );

  const current = await partnerRow(req.user!.id);

  if (available === current.dutyToday) {
    return res.json({
      isAvailable: current.effState === 'available',
    });
  }

  await tx(async (session) => {
    if (!available && ['reserved', 'busy'].includes(current.effState)) {
      throw conflict('Finish your current delivery first.', 'has_active_order');
    }

    const partner = await DeliveryPartner.findOne({
      userId: oid(req.user!.id),
    }).session(session);

    if (!partner) throw notFound('Partner profile not found');

    partner.onDuty = available;
    if (available) partner.onDutyDay = todayKey();

    await partner.save({ session });

    await setPartnerState(
      session,
      req.user!.id,
      available ? 'available' : 'off',
    );
  });

  res.json({ isAvailable: available });
});

// ============================================================
// Delivery partner: order lists
// ============================================================

partnerRouter.get('/orders', async (req, res) => {
  const { scope } = parse(
    z.object({
      scope: z.enum(['active', 'delivered', 'rejected', 'history']).default('active'),
    }),
    req.query,
  );

  if (scope === 'active') {
    const rows = await Order.find({
      partnerId: oid(req.user!.id),
      status: { $in: activeOrderStatuses },
    } as any)
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate('customerId', 'name phone')
      .lean();

    return res.json({
      orders: rows.map((o: any) =>
        listRow({
          ...o,
          customer: o.customerId,
          customerPhone: undefined,
        }),
      ).map((o: any) => ({
        ...o,
        customerPhone: undefined,
      })),
    });
  }

  const assignmentStatus = scope === 'rejected' ? 'rejected' : 'completed';

  const assignments = await Assignment.find({
    partnerId: oid(req.user!.id),
    status: assignmentStatus,
  })
    .sort({ completedAt: -1, respondedAt: -1 })
    .limit(100)
    .populate({
      path: 'orderId',
      populate: { path: 'customerId', select: 'name phone' },
    })
    .lean();

  const orders = assignments
    .filter((a: any) => a.orderId)
    .map((a: any) => ({
      ...listRow({
        ...a.orderId,
        customer: a.orderId.customerId,
        assignmentReason: a.reason,
        assignmentAt: a.completedAt ?? a.respondedAt,
      }),
      customerPhone: undefined,
    }));

  res.json({ orders });
});

// ============================================================
// Delivery partner: accept / reject / dispatch
// ============================================================

partnerRouter.post('/orders/:id/accept', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);

  await tx(async (session) => {
    const assignment = await Assignment.findOneAndUpdate(
      {
        orderId: oid(order.id),
        partnerId: oid(req.user!.id),
        status: 'pending',
      },
      {
        $set: {
          status: 'accepted',
          respondedAt: new Date(),
        },
      },
      { returnDocument: 'after', session },
    );

    if (!assignment) {
      throw conflict(
        'This delivery is no longer waiting for your response.',
        'invalid_state',
      );
    }

    await transition(
      session,
      order.id,
      ASSIGNABLE,
      order.status,
      req.user!.id,
      { partner_accepted_at: new Date() },
      'Partner accepted',
    );

    if (order.status === 'ready_to_dispatch') {
      await notify(
        order.customer!.id,
        order.id,
        'partner_assigned',
        'Delivery partner confirmed',
        `${order.orderNumber} will be delivered by our staff.`,
        session,
      );
    }

    await notifyAdmins(
      order.id,
      'partner_accepted',
      'Delivery accepted',
      `${req.user!.name ?? 'A delivery partner'} accepted ${order.orderNumber}`,
      session,
    );
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

partnerRouter.post('/orders/:id/reject', async (req, res) => {
  const { reason } = parse(
    z.object({ reason: z.string().trim().max(200).optional() }),
    req.body ?? {},
  );

  const order = await loadOrder(String(req.params.id), req.user!);

  await tx(async (session) => {
    const assignment = await Assignment.findOneAndUpdate(
      {
        orderId: oid(order.id),
        partnerId: oid(req.user!.id),
        status: { $in: ['pending', 'accepted'] },
      },
      {
        $set: {
          status: 'rejected',
          reason: reason ?? null,
          respondedAt: new Date(),
        },
      },
      { returnDocument: 'after', session },
    );

    if (!assignment) {
      throw conflict(
        'This delivery can no longer be rejected.',
        'invalid_state',
      );
    }

    await transition(
      session,
      order.id,
      ASSIGNABLE,
      order.status,
      req.user!.id,
      {
        partner_id: null,
        partner_accepted_at: null,
      },
      `Rejected by partner${reason ? `: ${reason}` : ''}`,
    );

    await releasePartner(session, req.user!.id);

    await notifyAdmins(
      order.id,
      'partner_rejected',
      'Delivery rejected',
      `${req.user!.name ?? 'A delivery partner'} rejected ${order.orderNumber}${reason ? `: ${reason}` : ''}. Please assign someone else.`,
      session,
    );
  });

  res.json({ ok: true });
});

partnerRouter.post('/orders/:id/out-for-delivery', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);

  if (!order.partnerAccepted) {
    throw conflict('Accept the delivery first.', 'not_accepted');
  }

  if (order.status !== 'ready_to_dispatch') {
    throw conflict(
      'The customer has not confirmed this order yet. You can start once they do.',
      'waiting_for_customer',
    );
  }

  await tx(async (session) => {
    await transition(
      session,
      order.id,
      ['ready_to_dispatch'],
      'out_for_delivery',
      req.user!.id,
    );

    await setPartnerState(session, req.user!.id, 'busy');

    await notify(
      order.customer!.id,
      order.id,
      'out_for_delivery',
      'Your order is out for delivery',
      `${order.orderNumber} is on its way. Track it live in the app.`,
      session,
    );

    await notifyAdmins(
      order.id,
      'out_for_delivery',
      'Out for delivery',
      `${order.orderNumber} left the store`,
      session,
    );
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

// ============================================================
// Delivery partner: COD payment details
// ============================================================

partnerRouter.get('/orders/:id/payment-details', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);

  if (order.paymentMethod !== 'cod') {
    throw conflict('This order is already paid online.', 'not_cod');
  }

  const settings = await getStoreSettings();
  const amount = order.quotedAmount ?? 0;
  const upiUri = settings.upiId
    ? `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.upiName ?? 'Kamal Medical Hall')}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(order.orderNumber)}`
    : null;

  res.json({
    ...paymentDetailsView(settings),
    amount,
    orderNumber: order.orderNumber,
    upiUri,
    configured: Boolean(settings.upiId || settings.bankAccountNumber),
  });
});

// ============================================================
// Delivery partner: complete delivery
// ============================================================

partnerRouter.post('/orders/:id/delivered', async (req, res) => {
  const b = parse(
    z.object({
      collectedVia: z.enum(['cash', 'upi', 'bank']).optional(),
      reference: z.string()
        .trim()
        .min(6)
        .max(40)
        .regex(/^[A-Za-z0-9._\-/]+$/, 'Transaction id has unexpected characters')
        .optional(),
      proof: z.object({
        publicId: z.string().max(300),
        mimeType: z.string().max(100),
        resourceType: z.enum(['image', 'raw', 'video']).default('image'),
        sizeBytes: z.number().int().max(15_000_000).optional(),
      }).optional(),
    }),
    req.body ?? {},
  );

  const order = await loadOrder(String(req.params.id), req.user!);
  const cod = order.paymentMethod === 'cod';

  if (cod && !b.collectedVia) {
    throw bad('Record how the customer paid before completing the delivery.', 'payment_required');
  }

  const online = cod && b.collectedVia !== 'cash';

  if (online && (!b.reference || !b.proof)) {
    throw bad('Add the payment screenshot and its transaction id.', 'payment_proof_required');
  }

  if (b.proof && !b.proof.publicId.startsWith(`proofs/${req.user!.id}/`)) {
    throw bad('That file does not belong to you.', 'bad_proof');
  }

  if (b.proof && isBlockedFile(b.proof.publicId)) {
    throw bad('Invalid payment proof.', 'bad_proof');
  }

  const store = await storeLocation();

  await tx(async (session) => {
    await transition(
      session,
      order.id,
      ['out_for_delivery'],
      'delivered',
      req.user!.id,
      cod
        ? { payment_status: online ? 'paid' : 'cod_collected' }
        : {},
    );

    if (cod) {
      const payment = await Payment.findOne({
        orderId: oid(order.id),
        method: 'cod',
      }).session(session);

      if (!payment) {
        throw conflict('COD payment record was not found.', 'payment_not_found');
      }

      payment.status = online ? 'paid' : 'cod_collected';
      payment.collectedBy = oid(req.user!.id);
      payment.collectedVia = b.collectedVia!;
      payment.collectionRef = b.reference ?? null;
      payment.collectedAt = new Date();

      if (b.proof) {
        payment.proofPublicId = b.proof.publicId;
        payment.proofMime = b.proof.mimeType;
        payment.proofResourceType = b.proof.resourceType;
      }

      await payment.save({ session });
    }

    await Assignment.updateOne(
      {
        orderId: oid(order.id),
        partnerId: oid(req.user!.id),
        status: 'accepted',
      },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
        },
      },
      { session },
    );

    const remaining = await Order.countDocuments({
      partnerId: oid(req.user!.id),
      status: 'out_for_delivery',
      _id: { $ne: oid(order.id) },
    }).session(session);

    if (remaining > 0) {
      await setPartnerState(session, req.user!.id, 'busy');
    } else if (store) {
      await setPartnerState(session, req.user!.id, 'returning');
    } else {
      await releasePartner(session, req.user!.id);
    }

    await notify(
      order.customer!.id,
      order.id,
      'delivered',
      'Order delivered',
      `${order.orderNumber} has been delivered. Thank you!`,
      session,
    );

    const who = req.user!.name ?? 'The delivery partner';
    const amount = `₹${Math.round(order.quotedAmount ?? 0).toLocaleString('en-IN')}`;

    if (cod && b.collectedVia === 'cash') {
      await notifyAdmins(
        order.id,
        'cash_to_collect',
        'Collect cash from delivery partner',
        `${who} collected ${amount} cash for ${order.orderNumber}. Please collect it from them.`,
        session,
      );
    } else {
      await notifyAdmins(
        order.id,
        'delivered',
        'Order delivered',
        `${order.orderNumber} delivered${cod ? ` (paid by ${b.collectedVia}, ref ${b.reference})` : ''}`,
        session,
      );
    }
  });

  res.json({ order: await loadOrder(order.id, req.user!) });
});

// ============================================================
// Delivery partner: live location
// ============================================================

partnerRouter.post('/location', async (req, res) => {
  const { lat, lng } = parse(
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    req.body,
  );

  const partner = await DeliveryPartner.findOneAndUpdate(
    { userId: oid(req.user!.id) },
    {
      $set: {
        lastLat: lat,
        lastLng: lng,
        lastSeen: new Date(),
      },
    },
    { returnDocument: 'after' },
  );

  if (!partner) throw notFound('Partner profile not found');

  const state = partner.state;

  if (state === 'busy') {
    const orders = await Order.find({
      partnerId: oid(req.user!.id),
      status: 'out_for_delivery',
    }).select('_id customerId addressSnapshot').lean();

    for (const order of orders as any[]) {
      const snapshot = order.addressSnapshot;
      const eta =
        snapshot?.latitude != null && snapshot?.longitude != null
          ? etaMinutes(
              distanceMeters(
                { lat, lng },
                { lat: snapshot.latitude, lng: snapshot.longitude },
              ),
            )
          : null;

      const payload = {
        orderId: order._id.toString(),
        lat,
        lng,
        etaMinutes: eta,
        at: new Date().toISOString(),
      };

      emitUser(order.customerId.toString(), 'partner:location', payload);
      emitAdmins('partner:location', {
        ...payload,
        partnerId: req.user!.id,
      });
    }
  }

  let arrived = false;

  if (state === 'returning') {
    const store = await storeLocation();

    if (
      store &&
      distanceMeters({ lat, lng }, store) <= store.geofenceM
    ) {
      await tx(async (session) => {
        await releasePartner(session, req.user!.id);

        await notify(
          req.user!.id,
          null,
          'back_at_shop',
          'Back at the shop',
          'You are available for the next delivery.',
          session,
        );
      });

      arrived = true;
    }
  }

  const latest = arrived
    ? await DeliveryPartner.findOne({ userId: oid(req.user!.id) }).select('state').lean()
    : partner;

  res.json({
    state: latest?.state ?? state,
    arrived,
  });
});

// ============================================================
// Delivery partner: manual return confirmation
// ============================================================

partnerRouter.post('/arrived', async (req, res) => {
  const partner = await partnerRow(req.user!.id);

  if (partner.effState !== 'returning') {
    return res.json({ state: partner.effState });
  }

  const store = await storeLocation();

  if (store) {
    const near =
      partner.lastLat != null &&
      partner.lastLng != null &&
      distanceMeters(
        { lat: partner.lastLat, lng: partner.lastLng },
        store,
      ) <= store.geofenceM * 2;

    if (!near) {
      throw conflict(
        'You do not seem to be at the shop yet. You become available automatically when you arrive.',
        'not_at_shop',
      );
    }
  }

  await tx(async (session) => {
    await releasePartner(session, req.user!.id);
  });

  res.json({
    state: (await partnerRow(req.user!.id)).effState,
  });
});
