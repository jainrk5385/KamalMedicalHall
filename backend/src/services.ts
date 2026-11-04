import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import Razorpay from 'razorpay';
import { config } from './config.js';
import { HttpError } from './http.js';

const cld = config.cloudinary;
if (cld.cloudName) cloudinary.config({ cloud_name: cld.cloudName, api_key: cld.apiKey, api_secret: cld.apiSecret, secure: true });

export function cloudinaryConfigured() { return Boolean(cld.cloudName && cld.apiKey && cld.apiSecret); }

/** Prescriptions are uploaded with type=authenticated, so only signed URLs can read them. */
export type UploadPurpose = 'prescription' | 'bill' | 'avatar' | 'review' | 'proof' | 'announcement';
const FOLDERS: Record<UploadPurpose, string> = { prescription: 'prescriptions', bill: 'bills', avatar: 'avatars', review: 'reviews', proof: 'proofs', announcement: 'announcements' };

export function signUpload(userId: string, purpose: UploadPurpose = 'prescription') {
  if (!cloudinaryConfigured()) throw new HttpError(503, 'uploads_unavailable', 'File upload is not configured yet');
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder: `${FOLDERS[purpose]}/${userId}`, timestamp, type: 'authenticated' };
  const signature = cloudinary.utils.api_sign_request(params, cld.apiSecret);
  return { cloudName: cld.cloudName, apiKey: cld.apiKey, signature, ...params };
}

export type ResourceType = 'image' | 'raw' | 'video';

/** Files that could harm whoever opens them are never accepted, whatever the upload form says. */
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|apk|aab|sh|bash|js|mjs|jar|scr|vbs|ps1|dll|dmg|pkg|app|lnk|reg)$/i;
export const isBlockedFile = (name: string) => BLOCKED_EXT.test(name.trim());

export function signedPrescriptionUrl(publicId: string, mimeType: string, resourceType: ResourceType = 'image') {
  if (!cloudinaryConfigured()) return null;
  return cloudinary.url(publicId, {
    type: 'authenticated', resource_type: resourceType, sign_url: true, secure: true,
    format: resourceType === 'image' && mimeType === 'application/pdf' ? 'pdf' : undefined,
  });
}

const isPdfFile = (publicId: string, mimeType: string) => mimeType === 'application/pdf' || /\.pdf$/i.test(publicId);

/**
 * A JPEG version of an image (or of page `page` of a PDF), sized for screens and for embedding in the invoice.
 * Cloudinary does the conversion, so HEIC / WebP / PDF all become something every phone can show. Null when the
 * file cannot be shown as a picture (documents) or uploads are not configured.
 */
export function jpgUrl(publicId: string, mimeType: string, resourceType: ResourceType, page = 1, width = 1200): string | null {
  if (!cloudinaryConfigured() || resourceType !== 'image') return null;
  const pdf = isPdfFile(publicId, mimeType);
  return cloudinary.url(publicId, {
    type: 'authenticated', resource_type: 'image', sign_url: true, secure: true, format: 'jpg',
    transformation: [{ ...(pdf ? { page } : {}), width, crop: 'limit' }],
  });
}

/** Links the app shows inside itself: one picture for an image, one per page (up to `max`) for a PDF. */
export function previewUrls(publicId: string, mimeType: string, resourceType: ResourceType, max = 10): string[] {
  if (resourceType !== 'image') return [];
  const count = isPdfFile(publicId, mimeType) ? max : 1;
  return Array.from({ length: count }, (_, i) => jpgUrl(publicId, mimeType, resourceType, i + 1)).filter((u): u is string => !!u);
}

/** Signed link that downloads the bill as a file (Cloudinary attachment flag) instead of displaying it. */
export function signedBillUrl(publicId: string, mimeType: string, resourceType: ResourceType, download: boolean, fileName: string) {
  if (!cloudinaryConfigured()) return null;
  return cloudinary.url(publicId, {
    type: 'authenticated', resource_type: resourceType, sign_url: true, secure: true,
    ...(download ? { flags: `attachment:${fileName.replace(/[^\w-]/g, '_').slice(0, 60)}` } : {}),
    format: resourceType === 'image' && mimeType === 'application/pdf' ? 'pdf' : undefined,
  });
}

let razorpay: Razorpay | undefined;
const rz = config.razorpay;
export function razorpayConfigured() { return Boolean(rz.keyId && rz.keySecret); }
export function razorpayClient() {
  if (!razorpayConfigured()) throw new HttpError(503, 'payments_unavailable', 'Online payment is not configured yet');
  razorpay ??= new Razorpay({ key_id: rz.keyId, key_secret: rz.keySecret });
  return razorpay;
}

export async function verifyRazorpayPayment(
  paymentId: string,
  expectedOrderId: string,
  expectedAmountPaise: number,
) {
  if (
    !Number.isSafeInteger(expectedAmountPaise) ||
    expectedAmountPaise <= 0
  ) {
    throw new HttpError(
      400,
      'invalid_payment_amount',
      'Invalid expected payment amount.',
    );
  }

  const payment = await razorpayClient().payments.fetch(paymentId);

  if (payment.id !== paymentId) {
    throw new HttpError(
      400,
      'payment_mismatch',
      'Payment ID does not match Razorpay records.',
    );
  }

  if (payment.order_id !== expectedOrderId) {
    throw new HttpError(
      400,
      'payment_order_mismatch',
      'Payment does not belong to this order.',
    );
  }

  if (payment.currency !== 'INR') {
    throw new HttpError(
      400,
      'payment_currency_mismatch',
      'Payment currency does not match.',
    );
  }

  if (Number(payment.amount) !== expectedAmountPaise) {
    throw new HttpError(
      400,
      'payment_amount_mismatch',
      'Payment amount does not match the order amount.',
    );
  }

  if (payment.status !== 'captured' || payment.captured !== true) {
    throw new HttpError(
      409,
      'payment_not_captured',
      'Payment has not been captured yet.',
    );
  }

  return payment;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const expected = crypto.createHmac('sha256', rz.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}
export function verifyWebhookSignature(rawBody: Buffer, signature: string) {
  if (!rz.webhookSecret) return false;
  return safeEqual(crypto.createHmac('sha256', rz.webhookSecret).update(rawBody).digest('hex'), signature);
}

/** Best-effort removal of uploaded prescription files (used when a customer deletes their account). */
export async function deletePrescriptionFiles(publicIds: string[]) {
  if (!cloudinaryConfigured() || !publicIds.length) return;
  try { await cloudinary.api.delete_resources(publicIds, { type: 'authenticated', resource_type: 'image' }); }
  catch (e) { console.error('cloudinary delete failed', e); }
}
