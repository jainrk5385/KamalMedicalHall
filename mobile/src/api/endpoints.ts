import { api } from './client';

/** The SMS gateway used for login OTPs. The API key itself is never sent back, only its last 4 characters. */
export interface SmsSettings { apiUrl: string; senderId: string; smsType: string; otpTemplate: string; otpChannel: 'static' | 'sms'; apiKeySet: boolean; apiKeyHint: string | null; updatedAt: string; inUse: boolean }
import type { AccountRequest, CustomerSummary, Gender, SignupProfile,
  Announcement,
  ShopDetails, ShopPublic,
  CashSummary, ClosingSummary, Address, AddressInput, AppNotification, AdminChatThread, Attendance, ChatMessage, ChatQueue, CustomerDetail, DutyStatus, ExportKind, Order, OrderSummary, Overview, Partner, PartnerAttendance, Review, Revenue, PartnerState, PaymentDetails, PaymentMethod, StoreConfig, StoreSettings, Terms, Tracking, User } from './types';

export interface RazorpayIntent { orderId: string; amount: number; currency: string; keyId: string }
export interface UploadSignature { cloudName: string; apiKey: string; signature: string; timestamp: number; folder: string; type: string }
export interface NewOrderInput {
  kind: 'prescription' | 'medicines';
  items: { name: string; quantity: number }[];
  prescriptions: { publicId: string; mimeType: string; sizeBytes: number; url: string; resourceType: 'image' | 'raw' | 'video' }[];
  note?: string; addressId: string; deliveryDate: string; idempotencyKey: string;
}

export const endpoints = {
  config: () => api<StoreConfig>('GET', '/config', undefined, { auth: false }),
  terms: () => api<Terms>('GET', '/terms', undefined, { auth: false }),

  devLogin: (
    phone: string,
    otp: string,
    purpose: 'login' | 'signup' = 'login'
  ) =>
    api<{ token: string }>(
      'POST',
      '/auth/otp/dev-login',
      { phone, otp, purpose },
      {
        auth: false,
        retry: 'never',
      }
    ),
  session: (
  idToken: string,
  b?: { purpose?: 'login' | 'signup'; profile?: SignupProfile }
) =>
  api<{ token: string; user: User }>(
    'POST',
    '/auth/otp/verify',
    {
      idToken,
      purpose: b?.purpose ?? 'login',
      ...(b?.profile?.name ? { name: b.profile.name.trim() } : {}),
      ...(b?.profile?.email ? { email: b.profile.email.trim() } : {}),
    },
    {
      auth: false,
      retry: 'never',
      timeoutMs: 65_000,
    }
  ),
  me: (options?: { timeoutMs?: number; retry?: 'never' }) => api<{ user: User; accountRequest: AccountRequest | null }>('GET', '/me', undefined, options),
  accountRequests: () => api<{ requests: AccountRequest[] }>('GET', '/account/requests'),
  requestAccountChange: (b: { kind: AccountRequest['kind']; reason: string; details?: string }) => api<{ request: AccountRequest }>('POST', '/account/requests', b, { retry: 'never' }),
  cancelAccountRequest: (id: string) => api<void>('DELETE', `/account/requests/${id}`),
  deleteAccount: () => api<void>('DELETE', '/me'),
  pincodes: () => api<{ pincodes: string[] }>('GET', '/pincodes', undefined, { auth: false }),
  updateMe: (b: { name?: string; email?: string; language?: 'en' | 'hi'; gender?: Gender | null; dateOfBirth?: string | null; city?: string }) => api<{ user: User }>('PATCH', '/me', b),

  addresses: () => api<{ addresses: Address[] }>('GET', '/addresses'),
  addAddress: (b: AddressInput) => api<{ address: Address }>('POST', '/addresses', b),
  updateAddress: (id: string, b: AddressInput) => api<{ address: Address }>('PUT', `/addresses/${id}`, b),
  deleteAddress: (id: string) => api<void>('DELETE', `/addresses/${id}`),

  signUpload: (purpose: 'prescription' | 'bill' | 'avatar' | 'review' | 'proof' | 'announcement' = 'prescription') => api<UploadSignature>('POST', '/uploads/sign', { purpose }),
  invoiceLink: (orderId: string) => api<{ url: string }>('GET', `/orders/${orderId}/invoice-link`),
  createOrder: (b: NewOrderInput) => api<{ order: Order }>('POST', '/orders', b, { timeoutMs: 30000, retry: 'always' /* safe: the idempotency key makes a repeat return the same order */ }),
  orders: (scope: 'completed' | 'cancelled' | 'active', offset = 0, range?: { from?: string; to?: string }) => api<{ orders: OrderSummary[]; hasMore: boolean }>('GET', `/orders?${new URLSearchParams({ scope, offset: String(offset), ...(range?.from ? { from: range.from } : {}), ...(range?.to ? { to: range.to } : {}) })}`),
  order: (id: string) => api<{ order: Order }>('GET', `/orders/${id}`),
  tracking: (id: string) => api<Tracking>('GET', `/orders/${id}/tracking`),
  cancelOrder: (id: string, reason: string) => api<{ order: Order }>('POST', `/orders/${id}/cancel`, { reason }),
  acceptQuote: (id: string, paymentMethod: PaymentMethod) => api<{ order: Order; razorpay: RazorpayIntent | null }>('POST', `/orders/${id}/accept-quote`, { paymentMethod }),
  verifyPayment: (id: string, b: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => api<{ order: Order }>('POST', `/orders/${id}/payment/verify`, b),

  notifications: () => api<{ notifications: AppNotification[] }>('GET', '/notifications'),
  markAllRead: () => api<void>('POST', '/notifications/read-all'),
  markRead: (id: string) => api<void>('POST', `/notifications/${id}/read`),
  deleteNotification: (id: string) => api<void>('DELETE', `/notifications/${id}`),
  clearNotifications: () => api<void>('DELETE', '/notifications'),
  setAvatar: (publicId: string) => api<{ user: User }>('PUT', '/me/avatar', { publicId }),
  removeAvatar: () => api<{ user: User }>('DELETE', '/me/avatar'),

  chat: {
    thread: () => api<{ thread: { id: string; status: 'open' | 'closed'; orderId: string | null } | null; messages: ChatMessage[]; queue: ChatQueue | null }>('GET', '/chat/thread'),
    send: (body: string, orderId?: string) => api<{ messages: ChatMessage[] }>('POST', '/chat/messages', { body, orderId }),
    read: () => api<void>('POST', '/chat/read'),
    close: () => api<void>('POST', '/chat/close'),
  },
  reviews: {
    create: (b: { orderId: string; rating: number; comment?: string; images: { publicId: string; mimeType: string; sizeBytes?: number }[] }) => api<{ review: Review }>('POST', '/reviews', b),
    mine: () => api<{ reviews: Review[] }>('GET', '/reviews/mine'),
  },
  shop: () => api<ShopPublic>('GET', '/shop', undefined, { auth: false }),
  announcements: () => api<{ announcements: Announcement[] }>('GET', '/announcements'),
  announcement: (id: string) => api<{ announcement: Announcement }>('GET', `/announcements/${id}`),
  registerDevice: (token: string, platform: 'android' | 'ios' | 'web') => api<void>('POST', '/devices', { token, platform }),
  unregisterDevice: (token: string) => api<void>('DELETE', '/devices', { token }),

  admin: {
    overview: () => api<Overview>('GET', '/admin/overview'),
    revenue: (days = 30) => api<Revenue>('GET', `/admin/revenue?days=${days}`),
    shop: () => api<{ details: ShopDetails; legacy: { address: string | null; phone: string | null; email: string | null; latitude: number | null; longitude: number | null } }>('GET', '/admin/shop'),
    saveShop: (d: ShopDetails) => api<{ details: ShopDetails }>('PUT', '/admin/shop', d),
    sms: () => api<SmsSettings>('GET', '/admin/sms'),
    saveSms: (b: { senderId: string; smsType: string; otpTemplate: string; apiKey?: string; apiUrl?: string; otpChannel?: 'static' | 'sms' }) => api<SmsSettings>('PUT', '/admin/sms', b),
    testSms: (phone: string) => api<{ sent: boolean; requestId: string | null }>('POST', '/admin/sms/test', { phone }, { retry: 'never', timeoutMs: 30000 }),
    announcements: () => api<{ announcements: Announcement[] }>('GET', '/admin/announcements'),
    createAnnouncements: (items: { title: string; body: string; images: { publicId: string; mimeType: string; resourceType: string; sizeBytes?: number }[]; expiresAt: string | null }[]) => api<{ ids: string[]; sentTo: number }>('POST', '/admin/announcements', { items }, { timeoutMs: 60000, retry: 'never' }),
    updateAnnouncement: (id: string, b: { title?: string; body?: string; expiresAt?: string | null; isActive?: boolean }) => api<{ announcement: Announcement }>('PATCH', `/admin/announcements/${id}`, b),
    sendAnnouncement: (id: string) => api<{ sentTo: number; announcement: Announcement }>('POST', `/admin/announcements/${id}/send`, undefined, { retry: 'never' }),
    deleteAnnouncement: (id: string) => api<void>('DELETE', `/admin/announcements/${id}`),
    cash: () => api<CashSummary>('GET', '/admin/cash'),
    settleCash: (partnerId: string, orderIds?: string[]) => api<CashSummary & { settled: number; amount: number }>('POST', '/admin/cash/settle', { partnerId, orderIds }),
    closingSummary: () => api<ClosingSummary>('GET', '/admin/closing-summary'),
    customer: (id: string) => api<CustomerDetail>('GET', `/admin/customers/${id}`),
    broadcast: (title: string, body: string) => api<{ sent: number }>('POST', '/admin/broadcast', { title, body }),
    exportLink: (kind: ExportKind, days = 30) => api<{ url: string }>('GET', `/admin/export-link?kind=${kind}&days=${days}`),
    reviews: (status: 'pending' | 'approved' | 'rejected') => api<{ reviews: Review[] }>('GET', `/admin/reviews?status=${status}`),
    decideReview: (id: string, status: 'approved' | 'rejected', note?: string) => api<{ review: Review }>('POST', `/admin/reviews/${id}/decision`, { status, note }),
    chatSummary: () => api<{ open: number; waiting: number; active: number; unread: number; busy: boolean }>('GET', '/admin/chat/summary'),
    chatThreads: (status: 'open' | 'closed') => api<{ adminBusy: boolean; threads: AdminChatThread[] }>('GET', `/admin/chat/threads?status=${status}`),
    chatThread: (id: string) => api<{ thread: { id: string; status: 'open' | 'closed'; customerName: string | null; customerPhone: string; orderId: string | null; orderNumber: string | null; customerId: string }; messages: ChatMessage[] }>('GET', `/admin/chat/threads/${id}`),
    chatReply: (id: string, body: string) => api<{ message: ChatMessage }>('POST', `/admin/chat/threads/${id}/messages`, { body }),
    chatClose: (id: string) => api<void>('POST', `/admin/chat/threads/${id}/close`),
    dashboard: () => api<{ isOpen: boolean; requested: number; awaitingPayment: number; readyToDispatch: number; outForDelivery: number; deliveredToday: number; salesToday: number }>('GET', '/admin/dashboard'),
    orders: (status?: string, search?: string) => api<{ orders: OrderSummary[] }>('GET', `/admin/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`),
    quote: (id: string, amount: number, bill: { publicId: string; mimeType: string; resourceType: 'image' | 'raw' | 'video'; sizeBytes?: number; name?: string }) => api<{ order: Order }>('POST', `/admin/orders/${id}/quote`, { amount, bill }),
    setStoreOpen: (isOpen: boolean) => api<{ isOpen: boolean }>('PUT', '/admin/store-open', { isOpen }),
    reject: (id: string, reason: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/reject`, { reason }),
    cancel: (id: string, reason: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/cancel`, { reason }),
    assign: (id: string, partnerId: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/assign`, { partnerId }),
    unassign: (id: string) => api<{ order: Order }>('POST', `/admin/orders/${id}/unassign`),
    partners: () => api<{ partners: Partner[] }>('GET', '/admin/partners'),
    terms: () => api<Terms>('GET', '/admin/terms'),
    saveTerms: (text: string) => api<void>('PUT', '/admin/terms', { text }),
    attendance: (days = 7) => api<Attendance>('GET', `/admin/attendance?days=${days}`),
    addPartner: (name: string, phone: string) => api<{ id: string }>('POST', '/admin/partners', { name, phone }),
    updatePartner: (id: string, b: { active?: boolean; canCallCustomer?: boolean }) => api<void>('PATCH', `/admin/partners/${id}`, b),
    setPartnerActive: (id: string, active: boolean) => api<void>('PATCH', `/admin/partners/${id}`, { active }),
    setPartnerState: (id: string, state: 'available' | 'off') => api<void>('POST', `/admin/partners/${id}/state`, { state }),
    pincodes: () => api<{ pincodes: { pincode: string; area: string | null; active: boolean }[] }>('GET', '/admin/pincodes'),
    addPincodes: (pincodes: string[], area?: string) => api<{ added: number }>('POST', '/admin/pincodes', { pincodes, area }),
    setPincodeActive: (pincode: string, active: boolean) => api<void>('PATCH', `/admin/pincodes/${pincode}`, { active }),
    deletePincode: (pincode: string) => api<void>('DELETE', `/admin/pincodes/${pincode}`),
    setPartnerPincodes: (id: string, pincodes: string[]) => api<void>('PUT', `/admin/partners/${id}/pincodes`, { pincodes }),
    customers: (search?: string, status: 'all' | 'active' | 'deactivated' = 'all') => api<{ customers: CustomerSummary[]; counts: { active: number; deactivated: number; pendingRequests: number } }>('GET', `/admin/customers?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    addCustomer: (b: SignupProfile & { phone: string }) => api<{ customer: CustomerSummary }>('POST', '/admin/customers', b, { retry: 'never' }),
    updateCustomer: (id: string, b: Partial<SignupProfile>) => api<{ customer: CustomerSummary }>('PATCH', `/admin/customers/${id}`, b),
    setCustomerActive: (id: string, active: boolean, note?: string) => api<void>('POST', `/admin/customers/${id}/status`, { active, note }, { retry: 'never' }),
    accountRequests: (status: 'pending' | 'all' = 'pending') => api<{ requests: (AccountRequest & { customer: { id: string; name: string | null; phone: string; isActive: boolean } })[] }>('GET', `/admin/account-requests?status=${status}`),
    decideAccountRequest: (id: string, approve: boolean, note?: string) => api<void>('POST', `/admin/account-requests/${id}/decide`, { approve, note }, { retry: 'never' }),
    reports: (days = 30) => api<{ days: number; daily: { day: string; orders: number; sales: number }[]; paymentSplit: { method: string | null; orders: number; sales: number }[]; perPartner: { name: string; orders: number }[] }>('GET', `/admin/reports?days=${days}`),
    settings: () => api<StoreSettings>('GET', '/admin/settings'),
    saveSettings: (b: Partial<StoreSettings> & Pick<StoreSettings, 'isOpen' | 'openingTime' | 'closingTime'>) => api<void>('PUT', '/admin/settings', b),
    paymentDetails: () => api<PaymentDetails>('GET', '/admin/payment-details'),
    savePaymentDetails: (b: PaymentDetails) => api<void>('PUT', '/admin/payment-details', b),
  },
  partner: {
    me: () => api<{ state: PartnerState; isAvailable: boolean; onDuty: boolean; dutyStatus: DutyStatus | 'absent'; paidLeave: boolean; storeOpen: boolean; active: boolean; canCallCustomer: boolean; store: { lat: number; lng: number; geofenceM: number } | null }>('GET', '/partner/me'),
    setStatus: (status: DutyStatus) => api<{ state: PartnerState; onDuty: boolean; dutyStatus: DutyStatus | 'absent'; paidLeave: boolean }>('POST', '/partner/status', { status }),
    attendance: (days = 14) => api<PartnerAttendance>('GET', `/partner/attendance?days=${days}`),
    orders: (scope: 'active' | 'delivered' | 'rejected') => api<{ orders: OrderSummary[] }>('GET', `/partner/orders?scope=${scope}`),
    accept: (id: string) => api<{ order: Order }>('POST', `/partner/orders/${id}/accept`),
    reject: (id: string, reason?: string) => api<{ ok: boolean }>('POST', `/partner/orders/${id}/reject`, { reason }),
    outForDelivery: (id: string) => api<{ order: Order }>('POST', `/partner/orders/${id}/out-for-delivery`),
    delivered: (id: string, b: { collectedVia?: 'cash' | 'upi' | 'bank'; reference?: string; proof?: { publicId: string; mimeType: string; resourceType: string; sizeBytes?: number } }) => api<{ order: Order }>('POST', `/partner/orders/${id}/delivered`, b),
    paymentDetails: (id: string) => api<PaymentDetails & { amount: number; orderNumber: string; upiUri: string | null; configured: boolean }>('GET', `/partner/orders/${id}/payment-details`),
    location: (lat: number, lng: number) => api<{ state: PartnerState; arrived: boolean }>('POST', '/partner/location', { lat, lng }, { timeoutMs: 10000 }),
    arrived: () => api<{ state: PartnerState }>('POST', '/partner/arrived'),
  },
};
