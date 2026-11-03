
import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IAddress extends Document {
  userId: Types.ObjectId;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  updatedAt: Date;
  label?: string | null;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    recipientName: {
      type: String,
      required: true,
      trim: true,
    },

    label: {
      type: String,
      default: null,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    line1: {
      type: String,
      required: true,
      trim: true,
    },

    line2: {
      type: String,
      default: null,
      trim: true,
    },

    landmark: {
      type: String,
      default: null,
      trim: true,
    },

    pincode: {
      type: String,
      required: true,
      match: /^\d{6}$/,
    },

    city: {
      type: String,
      default: null,
      trim: true,
    },

    latitude: {
      type: Number,
      default: null,
    },

    longitude: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'addresses',
  },
);

AddressSchema.index({ userId: 1, createdAt: -1 });

export const Address =
  (mongoose.models.Address as mongoose.Model<IAddress>) ||
  mongoose.model<IAddress>('Address', AddressSchema);

export default Address;
