import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from 'mongoose';

export interface IOtpModeAudit extends Document {
  previousMode: 'sms' | 'static';
  newMode: 'sms' | 'static';
  changedBy: Types.ObjectId;
  createdAt: Date;
}

const OtpModeAuditSchema = new Schema<IOtpModeAudit>(
  {
    previousMode: {
      type: String,
      enum: ['sms', 'static'],
      required: true,
    },
    newMode: {
      type: String,
      enum: ['sms', 'static'],
      required: true,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'otp_mode_audit',
  },
);

export const OtpModeAuditModel: Model<IOtpModeAudit> =
  (mongoose.models.OtpModeAudit as Model<IOtpModeAudit>) ||
  mongoose.model<IOtpModeAudit>('OtpModeAudit', OtpModeAuditSchema);

export default OtpModeAuditModel;
