
import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from 'mongoose';

const PEARL_SMS_URL = 'https://sms.pearlsms.com/public/sms/send';

export interface ISmsSettings extends Document {
  key: string;
  apiUrl: string;
  senderId: string;
  smsType: string;
  apiKey: string | null;
  otpTemplate: string;
  otpChannel: 'sms';
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const SmsSettingsSchema = new Schema<ISmsSettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    apiUrl: {
      type: String,
      default: PEARL_SMS_URL,
      immutable: true,
    },
    senderId: {
      type: String,
      default: '',
    },
    smsType: {
      type: String,
      default: 'TRANS',
    },
    apiKey: {
      type: String,
      default: null,
    },
    otpTemplate: {
      type: String,
      default: 'Your OTP is {otp}.',
    },
    otpChannel: {
      type: String,
      enum: ['sms'],
      default: 'sms',
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'sms_settings',
  },
);

export const SmsSettingsModel: Model<ISmsSettings> =
  (mongoose.models.SmsSettings as Model<ISmsSettings>) ||
  mongoose.model<ISmsSettings>('SmsSettings', SmsSettingsSchema);

export default SmsSettingsModel;
