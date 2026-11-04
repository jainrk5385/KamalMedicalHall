export type Role = 'customer' | 'admin' | 'delivery_partner';
export type OrderStatus = 'requested' | 'quoted' | 'accepted' | 'awaiting_payment' | 'ready_to_dispatch' | 'out_for_delivery' | 'delivered' | 'rejected' | 'cancelled';
export type OrderKind = 'prescription' | 'medicines';
export type PaymentMethod = 'razorpay' | 'cod';

export type Gender = 'male' | 'female' | 'other';
export interface User {
  avatarUrl?: string | null; id: string; phone: string; role: Role; name: string | null; email: string | null; language?: string;
  gender?: Gender | null; dateOfBirth?: string | null; city?: string | null;
  /** False once the admin approved a deactivation: the app then shows only the account status and the reactivation form. */
  isActive?: boolean;
}

/** What the sign-up form sends. Everything but the name is optional. */
export interface SignupProfile { name: string; email?: string; gender?: Gender | null; dateOfBirth?: string | null; city?: string }

/** A customer's request to deactivate their account, or to activate it again. The admin approves or declines it. */
export interface AccountRequest {
  id: string; kind: 'deactivate' | 'reactivate'; reason: string; details: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; adminNote: string | null; createdAt: string; decidedAt: string | null;
}

export interface CustomerSummary {
  id: string; name: string | null; phone: string; email: string | null; gender: Gender | null; dateOfBirth: string | null; city: string | null;
  isActive: boolean; deactivatedAt: string | null; joinedAt: string; signedUp: boolean; orderCount?: number; pendingRequest: { kind: AccountRequest['kind'] } | null;
}

export interface Address {
  id: string; label: 'home' | 'office' | 'other'; recipientName: string; phone: string;
  line1: string; line2?: string | null; landmark?: string | null; pincode: string; city: string;
  latitude?: number | null; longitude?: number | null;
}
export type AddressInput = Omit<Address, 'id' | 'city'>;

export interface DeliveryDay { date: string; slots: { id: string; label: string; available: boolean }[] }
export interface StoreConfig {
  store: { isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null; latitude: number | null; longitude: number | null };
  deliveryDays: DeliveryDay[];
  /** The dates a customer can choose (no times). Before the admin's cut-off time today is included, after it the list starts tomorrow. */
  deliveryDates: string[];
  orderCutoffTime: string;
  authMode: 'sms';
  /** True while the admin has OTP delivery set to the test code 123456 (no SMS is sent). */
  otpTestMode?: boolean;
}

export interface Order {
  id: string; orderNumber: string; kind: OrderKind; status: OrderStatus; note: string | null;
  address: { recipientName: string; phone: string | null; line1: string; line2?: string; landmark?: string; pincode: string; city: string; latitude?: number; longitude?: number };
  deliveryDate: string; deliverySlot: string | null; quotedAmount: number | null; quoteExpiresAt: string | null;
  paymentMethod: PaymentMethod | null; paymentStatus: string | null; rejectionReason: string | null; cancelReason: string | null;
  createdAt: string;
  /** Staff only: how a cash-on-delivery order was paid, with the proof the partner uploaded. */
  collection?: { via: 'cash' | 'upi' | 'bank'; reference: string | null; collectedAt: string; collectedBy: string | null; cashSettledAt: string | null; proof: { url: string | null; mimeType: string } | null } | null;
  items: { id: string; name: string; quantity: number }[];
  prescriptions: { id: string; mimeType: string; sizeBytes: number | null; url: string | null; name?: string; previewUrls?: string[] }[];
  history: { status: OrderStatus; reason: string | null; created_at: string }[];
  deliveredAt: string | null;
  review?: { id: string; rating: number; status: ReviewStatus } | null;
  /** The bill the store attached to the amount request (not shown to delivery partners). */
  bill: { name: string; mimeType: string; sizeBytes: number | null; uploadedAt: string | null; viewUrl: string | null; downloadUrl: string | null; previewUrls?: string[] } | null;
  store: { name: string; address: string | null; phone: string | null };
  customer?: { id: string; name: string | null; phone: string | null };
  /** Delivery partner has accepted the assignment (customers only see the partner after this). */
  partnerAccepted: boolean;
  /** Delivery partners: whether the store lets them see/call the customer's number. */
  canCallCustomer: boolean;
  partner: { id: string; name: string | null; phone?: string } | null;
}
export interface OrderSummary {
  id: string; orderNumber: string; kind: OrderKind; status: OrderStatus; createdAt: string; quotedAmount: number | null;
  fileCount: number; summary: string | null;
  paymentMethod?: PaymentMethod | null; paymentStatus?: string | null; customerName?: string; customerPhone?: string;
  deliverySlot?: string | null; deliveryDate?: string; partnerName?: string | null;
  partnerAccepted?: boolean; pincode?: string | null; rejectedReason?: string; respondedAt?: string;
}
export interface AppNotification { id: string; type: string; title: string; body: string; read: boolean; createdAt: string; orderId: string | null; orderNumber: string | null; announcementId?: string | null }
export type PartnerState = 'off' | 'available' | 'reserved' | 'busy' | 'returning' | 'break';
export type DutyStatus = 'on_duty' | 'off_duty' | 'on_break' | 'leave';
export type DayStatus = 'present' | 'leave' | 'paid_leave' | 'absent';
export interface Partner {
  id: string; name: string; phone: string; active: boolean; state: PartnerState; isAvailable: boolean; onDuty: boolean;
  dutyStatus: DutyStatus | 'absent'; paidLeave: boolean; breakMinutes: number;
  canCallCustomer: boolean; checkedInAt: string | null; checkedOutAt: string | null; lastSeen: string | null;
  activeOrders: number; deliveredToday: number; codCollectedToday: number; pincodes: string[];
}
export interface Attendance {
  dates: string[];
  closedDays: string[];
  today: { id: string; name: string; phone: string; state: PartnerState; dutyStatus: DutyStatus | 'absent'; paidLeave: boolean; present: boolean; notIn: boolean; checkedInAt: string | null; checkedOutAt: string | null; breakMinutes: number }[];
  summary: { total: number; present: number; onDuty: number; onBreak: number; offDuty: number; onLeave: number; absent: number; available: number; busy: number };
  history: { id: string; name: string; days: (DayStatus | null)[] }[];
}
export interface PartnerAttendance {
  days: { day: string; status: DayStatus; checkedInAt: string | null; checkedOutAt: string | null; breakMinutes: number }[];
  closedDays: string[];
  summary: { present: number; leave: number; paidLeave: number; absent: number };
}
export interface Terms { text: string; updatedAt: string | null }
export interface Tracking {
  orderId: string; orderNumber: string; status: OrderStatus;
  store: { lat: number; lng: number } | null; destination: { lat: number; lng: number } | null;
  partner: { name: string | null } | null; rider: { lat: number; lng: number; updatedAt: string } | null; etaMinutes: number | null;
}
export interface PaymentDetails {
  upiId: string | null; upiName: string | null; bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null; bankIfsc: string | null;
}
export interface StoreSettings {
  isOpen: boolean; openingTime: string; closingTime: string; address: string | null; phone: string | null; email: string | null;
  latitude: number | null; longitude: number | null; geofenceM: number; orderCutoffTime?: string;
  /** Whether customers see the page to accept the amount and choose how to pay. Off: the amount is confirmed as pay on delivery. */
  customerAcceptRequired?: boolean;
}

export type ChatRole = 'customer' | 'admin' | 'bot';
export interface ChatMessage { id: string; threadId: string; role: ChatRole; body: string; createdAt: string; customerName?: string | null }
export interface ChatQueue { state: 'active' | 'waiting' | 'closed'; position: number; estimatedMinutes: number; adminBusy: boolean }
export interface AdminChatThread {
  id: string; status: 'open' | 'closed'; customerName: string | null; customerPhone: string; orderNumber: string | null; subject: string | null;
  lastBody: string | null; lastMessageAt: string; unread: number; state: 'active' | 'waiting' | 'closed'; position: number;
}
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export interface Review {
  id: string; orderId: string; orderNumber: string; rating: number; comment: string | null; status: ReviewStatus; adminNote: string | null;
  createdAt: string; decidedAt: string | null; customerName: string | null; customerPhone: string; images: { id: string; url: string | null }[];
}
export interface Overview {
  customers: number; ordersTotal: number; ordersToday: number; cancelledToday: number; salesToday: number; sales7d: number; sales30d: number;
  avgOrder30d: number; pendingReviews: number; chatWaiting: number; chatOpen: number;
}
export interface Revenue {
  days: number; sales: number; delivered: number; avgOrder: number; ordersPlaced: number; ordersLost: number;
  daily: { day: string; orders: number; sales: number }[];
  paymentSplit: { method: string | null; orders: number; sales: number }[];
  topItems: { name: string; quantity: number; orders: number }[];
}
export interface CustomerDetail {
  customer: CustomerSummary;
  orderCount: number; deliveredCount: number; lifetimeValue: number;
  orders: { id: string; orderNumber: string; status: OrderStatus; amount: number | null; createdAt: string }[];
  requests: AccountRequest[];
  addresses: string[];
}
export type ExportKind = 'orders' | 'revenue' | 'customers' | 'payments' | 'attendance' | 'reviews';

export interface CashPartner { partnerId: string; name: string; phone: string; total: number; orders: { orderId: string; orderNumber: string; amount: number; collectedAt: string }[] }
export interface CashSummary { total: number; partners: CashPartner[] }
export interface ClosingSummary { closingTime: string; isOpen: boolean; revenue: { orders: number; total: number; online: number; cod: number }; cash: CashSummary; message: string }

export interface ShopBranch { name?: string; address?: string; city?: string; pincode?: string; phone?: string; hours?: string; mapsUrl?: string; latitude?: number | null; longitude?: number | null }
export interface ShopDetails {
  name?: string; tagline?: string; about?: string; ownerName?: string; establishedYear?: number;
  address?: { line1?: string; line2?: string; area?: string; landmark?: string; city?: string; state?: string; pincode?: string };
  latitude?: number | null; longitude?: number | null; mapsUrl?: string;
  phones?: { label?: string; number?: string }[]; whatsapp?: string; email?: string; website?: string; hoursNote?: string;
  licence?: { drugLicense1?: string; drugLicense2?: string; drugLicenseValidTill?: string; gstin?: string; pan?: string; fssai?: string; pharmacistName?: string; pharmacistRegNo?: string };
  services?: string[]; paymentModes?: string[]; social?: { facebook?: string; instagram?: string }; branches?: ShopBranch[];
}
/** What customers see (the PAN is never included), plus today's opening hours and the older settings as a fallback. */
export type ShopPublic = ShopDetails & { isOpen: boolean; openingTime: string; closingTime: string; legacy: { address: string | null; phone: string | null; email: string | null; latitude: number | null; longitude: number | null } };

export interface Announcement {
  id: string; title: string; body: string; expiresAt: string | null; createdAt: string; lastSentAt: string | null; sendCount: number;
  /** Switched on by the admin (an announcement without an expiry date stays live until it is switched off). */
  isActive: boolean; status: 'active' | 'expired' | 'inactive';
  active: boolean; expired: boolean; hasImages: boolean; images: { publicId: string; mimeType: string; url: string | null; fullUrl: string | null }[];
}
