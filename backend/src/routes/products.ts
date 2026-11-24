import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { HttpError, notFound, parse } from '../http.js';
import { Product } from '../models/Product.js';

export const productsPublic = Router();
export const productsAdmin = Router();

const idValid = (id: string) => mongoose.Types.ObjectId.isValid(id);
const productInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(3000).default(''),
  images: z.array(z.string().url().max(1000)).max(8).default([]),
  price: z.number().finite().min(0).max(10000000),
  discountedPrice: z.number().finite().min(0).max(10000000).nullable().optional(),
  stockQuantity: z.number().int().min(0).max(1000000),
  isAvailable: z.boolean().default(true),
}).refine(v => v.discountedPrice == null || v.discountedPrice <= v.price, {
  message: 'Discounted price cannot exceed regular price', path: ['discountedPrice'],
});
const view = (p: any) => ({
  id: String(p._id), name: p.name, description: p.description ?? '',
  images: p.images ?? [], price: p.price, discountedPrice: p.discountedPrice ?? null,
  stockQuantity: p.stockQuantity ?? 0, isAvailable: p.isAvailable !== false,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
});

productsPublic.get('/products', authed, async (_req, res) => {
  const rows = await Product.find({ isAvailable: true, stockQuantity: { $gt: 0 } }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ products: rows.map(view) });
});
productsPublic.get('/products/:id', authed, async (req, res) => {
  if (!idValid(String(req.params.id))) throw notFound('Product not found');
  const p = await Product.findOne({ _id: req.params.id, isAvailable: true, stockQuantity: { $gt: 0 } }).lean();
  if (!p) throw notFound('Product not found');
  res.json({ product: view(p) });
});

productsAdmin.use(authed, requireRole('admin'));
productsAdmin.get('/products', async (_req, res) => {
  const rows = await Product.find().sort({ createdAt: -1 }).limit(500).lean();
  res.json({ products: rows.map(view) });
});
productsAdmin.post('/products', async (req, res) => {
  const b = parse(productInput, req.body);
  const p = await Product.create({ ...b, discountedPrice: b.discountedPrice ?? null });
  res.status(201).json({ product: view(p) });
});
productsAdmin.patch('/products/:id', async (req, res) => {
  if (!idValid(String(req.params.id))) throw notFound('Product not found');
  const b = parse(productInput.partial(), req.body);
  if (b.price != null && b.discountedPrice != null && b.discountedPrice > b.price) {
    throw new HttpError(422, 'validation_error', 'Discounted price cannot exceed regular price.');
  }
  const p = await Product.findByIdAndUpdate(req.params.id, { $set: b }, { new: true, runValidators: true });
  if (!p) throw notFound('Product not found');
  res.json({ product: view(p) });
});
productsAdmin.delete('/products/:id', async (req, res) => {
  if (!idValid(String(req.params.id))) throw notFound('Product not found');
  const result = await Product.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) throw notFound('Product not found');
  res.status(204).end();
});
