
import mongoose from 'mongoose';

import { tx } from './db.js';
import { Payment } from './models/Payment.js';
import { Order } from './models/Order.js';
import { StoreSettings } from './models/StoreSettings.js';

import { notifyAdmins } from './notify.js';
import { emitAdmins } from './realtime.js';

const IST_TIME_ZONE = 'Asia/Kolkata';

const roundMoney = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const inr = (n: number) =>
  `₹${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(roundMoney(n))}`;

export interface CashPartner {
  partnerId: string;
  name: string;
  phone: string;
  total: number;
  orders: {
    orderId: string;
    orderNumber: string;
    amount: number;
    collectedAt: string;
  }[];
}

interface PopulatedCashPayment {
  _id: mongoose.Types.ObjectId;
  amount: number;
  collectedAt: Date | null;
  orderId: {
    _id: mongoose.Types.ObjectId;
    orderNumber: string;
  } | null;
  collectedBy: {
    _id: mongoose.Types.ObjectId;
    name?: string;
    phone?: string;
  } | null;
}

/**
 * Cash delivery partners collected from customers
 * but have not yet handed over to the shop.
 */
export async function cashToCollect(): Promise<{
  total: number;
  partners: CashPartner[];
}> {
  const payments = await Payment.find({
    method: 'cod',
    collectedVia: 'cash',
    cashSettledAt: null,
    status: 'cod_collected',
    collectedBy: { $ne: null },
  })
    .populate('orderId', 'orderNumber')
    .populate('collectedBy', 'name phone')
    .lean<PopulatedCashPayment[]>();

  const byPartner = new Map<string, CashPartner>();

  for (const payment of payments) {
    if (!payment.orderId || !payment.collectedBy) {
      continue;
    }

    const partnerId = payment.collectedBy._id.toString();

    const partner =
      byPartner.get(partnerId) ?? {
        partnerId,
        name: payment.collectedBy.name ?? 'Delivery partner',
        phone: payment.collectedBy.phone ?? '',
        total: 0,
        orders: [],
      };

    const amount = roundMoney(Number(payment.amount));
    const collectedAt = payment.collectedAt
      ? payment.collectedAt.toISOString()
      : '';

    partner.total = roundMoney(partner.total + amount);

    partner.orders.push({
      orderId: payment.orderId._id.toString(),
      orderNumber: payment.orderId.orderNumber,
      amount,
      collectedAt,
    });

    byPartner.set(partnerId, partner);
  }

  const partners = [...byPartner.values()];

  for (const partner of partners) {
    partner.orders.sort((a, b) =>
      a.collectedAt.localeCompare(b.collectedAt)
    );
  }

  partners.sort((a, b) => a.name.localeCompare(b.name));

  return {
  total: roundMoney(
    partners.reduce((sum, partner) => sum + partner.total, 0)
  ),
  partners,
};
}

/**
 * Get the current IST calendar date and minutes since midnight.
 */
function istNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');

  return {
    day: `${year}-${month}-${day}`,
    mins: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Convert an IST date (YYYY-MM-DD) to its UTC midnight instant.
 */
function istMidnightUtc(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(
    Date.UTC(year, month - 1, date) - 330 * 60 * 1000
  );
}

/**
 * Today's delivered-order revenue, split by payment method.
 *
 * The boundary is midnight in Asia/Kolkata, not UTC midnight.
 */
export async function todayRevenue() {
  const now = istNow();
  const start = istMidnightUtc(now.day);

  const [result] = await Order.aggregate<{
    orders: number;
    total: number;
    online: number;
    cod: number;
  }>([
    {
      $match: {
        status: 'delivered',
        deliveredAt: { $gte: start },
      },
    },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        total: {
          $sum: { $ifNull: ['$quotedAmount', 0] },
        },
        online: {
          $sum: {
            $cond: [
              { $eq: ['$paymentMethod', 'razorpay'] },
              { $ifNull: ['$quotedAmount', 0] },
              0,
            ],
          },
        },
        cod: {
          $sum: {
            $cond: [
              { $eq: ['$paymentMethod', 'cod'] },
              { $ifNull: ['$quotedAmount', 0] },
              0,
            ],
          },
        },
      },
    },
  ]);

return {
  orders: result?.orders ?? 0,
  total: roundMoney(Number(result?.total ?? 0)),
  online: roundMoney(Number(result?.online ?? 0)),
  cod: roundMoney(Number(result?.cod ?? 0)),
};
}

/**
 * Store closing summary.
 */
export async function closingSummary() {
  const [revenue, cash, store] = await Promise.all([
    todayRevenue(),
    cashToCollect(),
    StoreSettings.findOne().lean(),
  ]);

  return {
    closingTime: store?.closingTime,
    isOpen: Boolean(store?.isOpen),
    revenue,
    cash,
  };
}

/**
 * One-line message sent to administrators.
 */
export function closingMessage(
  summary: Awaited<ReturnType<typeof closingSummary>>
) {
  const staff = summary.cash.partners.length
    ? `Collect cash: ${summary.cash.partners
        .map((partner) => `${partner.name} ${inr(partner.total)}`)
        .join(', ')} (total ${inr(summary.cash.total)}).`
    : 'No cash to collect from staff.';

  return `Today's revenue ${inr(summary.revenue.total)} from ${
    summary.revenue.orders
  } order${summary.revenue.orders === 1 ? '' : 's'} (online ${inr(
    summary.revenue.online
  )}, cash/UPI on delivery ${inr(summary.revenue.cod)}). ${staff}`;
}

/**
 * Mark a partner's collected cash as handed over.
 *
 * If orderIds are supplied, only those orders are settled.
 * Otherwise, all outstanding cash collections for that partner are settled.
 *
 * Payment and order updates happen inside one MongoDB transaction.
 */
export async function settleCash(
  adminId: string,
  partnerId: string,
  orderIds?: string[]
) {
  return tx(async (session) => {
    const filter: Record<string, unknown> = {
      method: 'cod',
      collectedVia: 'cash',
      cashSettledAt: null,
      status: 'cod_collected',
      collectedBy: new mongoose.Types.ObjectId(partnerId),
    };

    if (orderIds?.length) {
      filter.orderId = {
        $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const payments = await Payment.find(filter)
      .select('_id orderId amount')
      .session(session)
      .lean();

    if (!payments.length) {
      return {
        settled: 0,
        amount: 0,
      };
    }

    const paymentIds = payments.map((payment) => payment._id);

    const settledAt = new Date();

    const settlement = await Payment.updateMany(
      {
        _id: { $in: paymentIds },
        cashSettledAt: null,
        status: 'cod_collected',
      },
      {
        $set: {
          cashSettledAt: settledAt,
          cashSettledBy: new mongoose.Types.ObjectId(adminId),
          status: 'paid',
        },
      },
      { session }
    );

    // Never assume updateMany modified documents in the same order
    // as the original query. Abort if any payment was not settled.
    if (settlement.modifiedCount !== payments.length) {
      throw new Error(
        'Cash settlement mismatch. Transaction must be retried.'
      );
    }

    const settledPayments = payments;

    const settledOrderIds = [
      ...new Map(
        settledPayments.map((payment) => [
          payment.orderId.toString(),
          payment.orderId,
        ])
      ).values(),
    ];

    const orderUpdate = await Order.updateMany(
      {
        _id: { $in: settledOrderIds },
      },
      {
        $set: {
          paymentStatus: 'paid',
        },
      },
      { session }
    );

    // Ensure every settled payment has a corresponding order.
    if (orderUpdate.matchedCount !== settledOrderIds.length) {
      throw new Error(
        'Cash settlement order mismatch. Transaction aborted.'
      );
    }

    return {
      settled: settlement.modifiedCount,
      amount: roundMoney(
  settledPayments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0
  )
),
    };
  });
}

/**
 * Convert HH:MM into minutes since midnight.
 */
const minutes = (hhmm: string) => {
  const [hours, mins] = hhmm.split(':').map(Number);

  return (hours ?? 0) * 60 + (mins ?? 0);
};

/**
 * Runs every minute.
 *
 * Sends one closing alert per IST calendar day, starting one hour
 * before closing time and ending 30 minutes after closing time.
 *
 * The alert date is atomically claimed before notifications are sent.
 */
export async function closingAlertTick() {
  const now = istNow();

  const store = await StoreSettings.findOne().lean();

  if (!store?.isOpen || !store.closingTime) {
    return;
  }

  const closes = minutes(store.closingTime);

  if (
    now.mins < closes - 60 ||
    now.mins > closes + 30
  ) {
    return;
  }

  // Atomic claim: only one server instance can claim this date.
  const claimed = await StoreSettings.findOneAndUpdate(
    {
      _id: store._id,
      isOpen: true,
      closingTime: store.closingTime,
      closingAlertDay: { $ne: now.day },
    },
    {
      $set: {
        closingAlertDay: now.day,
      },
    },
    {
      returnDocument: 'after',
    }
  ).lean();

  if (!claimed) {
    return;
  }

  const summary = await closingSummary();
  const message = closingMessage(summary);

  await notifyAdmins(
    null,
    'closing_alert',
    'Store closes in 1 hour',
    message
  );

  emitAdmins('closing:alert', {
    message,
    ...summary,
  });
}
