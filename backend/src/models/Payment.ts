
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export type PaymentMethod = 'razorpay' | 'cod';

export type PaymentStatus =
  | 'pending'
  | 'cod_pending'
  | 'cod_collected'
  | 'paid'
  | 'refunded'
  | 'cancelled';

export type CollectionMethod = 'cash' | 'upi' | 'bank';

export interface IPayment {
  _id?: Types.ObjectId;

  orderId: Types.ObjectId;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;

  // Razorpay details
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  razorpaySignature: string | null;

  // COD collection details
  collectedBy: Types.ObjectId | null;
  collectedVia: CollectionMethod | null;
  collectionRef: string | null;
  collectedAt: Date | null;

  // Cash settlement details
  cashSettledAt: Date | null;
  cashSettledBy: Types.ObjectId | null;

  // Collection proof details
  proofPublicId: string | null;
  proofMime: string | null;
  proofResourceType: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },

    method: {
      type: String,
      enum: ['razorpay', 'cod'],
      required: true,
    },

    amount: {
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: (value: number) =>
      Number.isFinite(value) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
    message: 'Payment amount must have no more than 2 decimal places',
  },
},

    status: {
      type: String,
      enum: [
        'pending',
        'cod_pending',
        'cod_collected',
        'paid',
        'refunded',
        'cancelled',
      ],
      default: 'cod_pending',
      required: true,
      index: true,
    },

    // Razorpay details
    razorpayOrderId: {
      type: String,
      default: null,
      trim: true,
    },

    razorpayPaymentId: {
      type: String,
      default: null,
      trim: true,
    },

    razorpaySignature: {
      type: String,
      default: null,
      trim: true,
    },

    // COD collection details
    collectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    collectedVia: {
      type: String,
      enum: ['cash', 'upi', 'bank'],
      default: null,
    },

    collectionRef: {
      type: String,
      default: null,
      trim: true,
    },

    collectedAt: {
      type: Date,
      default: null,
    },

    // Cash settlement details
    cashSettledAt: {
      type: Date,
      default: null,
    },

    cashSettledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Collection proof details
    proofPublicId: {
      type: String,
      default: null,
    },

    proofMime: {
      type: String,
      default: null,
    },

    proofResourceType: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Find payments belonging to an order.
paymentSchema.index({ orderId: 1 });

// Filter payments by method and status.
paymentSchema.index({ method: 1, status: 1 });

// Find COD collections assigned to a staff member.
paymentSchema.index({ collectedBy: 1, collectedAt: -1 });

// Find unsettled cash collections.
paymentSchema.index({
  method: 1,
  collectedVia: 1,
  cashSettledAt: 1,
});

export const Payment: Model<IPayment> =
  (mongoose.models.Payment as Model<IPayment>) ||
  model<IPayment>('Payment', paymentSchema);

export default Payment;
