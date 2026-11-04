
import mongoose, {
  Schema,
  Types,
  type Model,
} from 'mongoose';

export interface IUser {
  _id?: Types.ObjectId;
  phone: string;
  role: 'customer' | 'admin' | 'delivery_partner';
  name: string | null;
  email: string | null;
  language: string | null;
  avatarPublicId: string | null;
  avatarResourceType: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  city: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  signedUpAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }

  return digits;
}

const userSchema = new Schema<IUser>(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      set: normalizePhone,
    },

    role: {
      type: String,
      enum: ['customer', 'admin', 'delivery_partner'],
      required: true,
    },

    name: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 120,
      default: null,
    },

    language: {
      type: String,
      default: 'en',
    },

    avatarPublicId: {
      type: String,
      default: null,
    },

    avatarResourceType: {
      type: String,
      default: null,
    },

    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: null,
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    city: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },

    signedUpAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.index({ phone: 1 }, { unique: true });

export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser>) ||
  mongoose.model<IUser>('User', userSchema);

export default User;
