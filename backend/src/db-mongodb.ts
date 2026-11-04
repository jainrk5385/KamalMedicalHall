
import mongoose, { Schema } from 'mongoose';
import { config } from './config.js';

// ==========================================
// MONGODB CONNECTION
// ==========================================

export const connection: mongoose.Connection = mongoose.createConnection();

let connectionPromise: Promise<mongoose.Connection> | null = null;

export async function connectDatabase(): Promise<mongoose.Connection> {
  if (connection.readyState === 1) {
    return connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = config.mongoUrl;

  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  connectionPromise = (async () => {
    try {
      await connection.openUri(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 15000,
        bufferCommands: false,
      });

      console.log('MongoDB connected');

      return connection;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Export mongoose
export { mongoose };

// ==========================================
// USER SCHEMA
// ==========================================

export const userSchema = new Schema({
  phone: { type: String, unique: true, index: true },
  role: {
    type: String,
    enum: ['customer', 'admin', 'delivery_partner'],
    required: true,
  },
  name: String,
  email: String,
  language: String,
  avatarPublicId: String,
  avatarResourceType: String,
  gender: String,
  dateOfBirth: Date,
  city: String,
  isActive: { type: Boolean, default: true },
  signedUpAt: Date,
}, { timestamps: true });

// ==========================================
// ORDER SCHEMA
// ==========================================

export const orderSchema = new Schema({
  customerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  kind: {
    type: String,
    enum: ['catalogue', 'prescription'],
    required: true,
  },
  note: String,
  addressSnapshot: Schema.Types.Mixed,
  deliveryDate: Date,
  deliverySlot: String,
  status: {
    type: String,
    enum: [
      'requested',
      'quote_sent',
      'quote_rejected',
      'accepted',
      'paid',
      'out_for_delivery',
      'delivered',
      'cancelled',
      'returned',
    ],
    default: 'requested',
  },
  idempotencyKey: {
    type: String,
    unique: true,
    index: true,
  },
}, { timestamps: true });

// ==========================================
// PRESCRIPTION SCHEMA
// ==========================================

export const prescriptionSchema = new Schema({
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true,
  },
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  resourceType: {
    type: String,
    enum: ['image', 'video', 'pdf'],
    required: true,
  },
}, { timestamps: true });

// ==========================================
// CHAT THREAD SCHEMA
// ==========================================

export const chatThreadSchema = new Schema({
  customerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'Order',
  },
  subject: String,
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
  },
}, { timestamps: true });

// ==========================================
// CHAT MESSAGE SCHEMA
// ==========================================

export const chatMessageSchema = new Schema({
  threadId: {
    type: Schema.Types.ObjectId,
    ref: 'ChatThread',
    index: true,
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  senderRole: {
    type: String,
    enum: ['customer', 'admin', 'bot'],
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
}, { timestamps: true });

// ==========================================
// NOTIFICATION SCHEMA
// ==========================================

export const notificationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'Order',
  },
  type: {
    type: String,
    enum: [
      'order_status',
      'chat',
      'announcement',
      'customer_signup',
    ],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  readAt: Date,
}, { timestamps: true });

// ==========================================
// STORE SETTINGS SCHEMA
// ==========================================

export const storeSettingsSchema = new Schema({
  isOpen: { type: Boolean, default: true },
  openingTime: { type: String, default: '09:00' },
  closingTime: { type: String, default: '21:00' },
  orderCutoffTime: { type: String, default: '01:00:00' },
  address: String,
  phone: String,
  email: String,
  latitude: Number,
  longitude: Number,
}, { _id: false });

// ==========================================
// OTP SCHEMA
// ==========================================

export const otpCodeSchema = new Schema({
  phone: {
    type: String,
    primaryKey: true,
    index: true,
  },
  codeHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  lastSentAt: Date,
  sends: {
    type: Number,
    default: 1,
  },
  windowStartedAt: Date,
});

// ==========================================
// MODEL REGISTRATION
// ==========================================

export const User = connection.model('User', userSchema);

export const Order = connection.model('Order', orderSchema);

export const Prescription = connection.model(
  'Prescription',
  prescriptionSchema
);

export const ChatThread = connection.model(
  'ChatThread',
  chatThreadSchema
);

export const ChatMessage = connection.model(
  'ChatMessage',
  chatMessageSchema
);

export const Notification = connection.model(
  'Notification',
  notificationSchema
);

export const StoreSettings = connection.model(
  'StoreSettings',
  storeSettingsSchema
);

export const OtpCode = connection.model(
  'OtpCode',
  otpCodeSchema
);
