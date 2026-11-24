import mongoose from 'mongoose';

const { Schema } = mongoose;

const productSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 3000 },
  images: { type: [String], default: [] },
  price: { type: Number, required: true, min: 0 },
  discountedPrice: { type: Number, min: 0, default: null },
  stockQuantity: { type: Number, required: true, min: 0, default: 0 },
  isAvailable: { type: Boolean, default: true },
}, { timestamps: true });

productSchema.index({ isAvailable: 1, name: 1 });

export const Product =
  mongoose.models.Product ||
  mongoose.model('Product', productSchema);
