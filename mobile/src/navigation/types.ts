import type { NavigatorScreenParams } from '@react-navigation/native';
import type { SignupProfile } from '../api/types';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: { phone?: string } | undefined;
  Register: { phone?: string } | undefined;
OTP: {
  phone: string;
  purpose?: 'login' | 'signup';
  profile?: SignupProfile;
  testMode?: boolean;
};
  Legal: undefined;
};

export type CustomerTabParamList = { Home: undefined; Orders: undefined; Cart: undefined; Profile: undefined };
export type CustomerStackParamList = {
  Tabs: NavigatorScreenParams<CustomerTabParamList> | undefined;
  Upload: undefined;
  TypeMedicines: undefined;
  Shop: undefined;
  Announcement: { id: string };
  Addresses: { select?: boolean } | undefined;
  AddressForm: { addressId?: string } | undefined;
  DeliveryTime: undefined;
  Review: undefined;
  Success: { orderId: string; orderNumber: string };
  OrderDetail: { orderId: string };
  Track: { orderId: string };
  Payment: { orderId: string };
  Notifications: undefined;
  EditProfile: undefined;
  Language: undefined;
  Help: undefined;
  Legal: undefined;
  Chat: { orderId?: string } | undefined;
  WriteReview: { orderId: string; orderNumber: string };
  MyReviews: undefined;
  Account: undefined;
};

export type AdminTabParamList = { Dashboard: undefined; Requests: undefined; Orders: undefined; Team: undefined; More: undefined };
export type AdminStackParamList = {
  Tabs: NavigatorScreenParams<AdminTabParamList> | undefined;
  OrderReview: { orderId: string };
  Customers: undefined;
  Reports: undefined;
  StoreSettings: undefined;
  Pincodes: undefined;
  PaymentDetails: undefined;
  Attendance: undefined;
  Terms: undefined;
  OrdersByStatus: { title: string; status: string };
  Revenue: undefined;
  Cash: undefined;
  Announcements: undefined;
  ShopDetails: undefined;
  AdminReviews: undefined;
  AdminChats: undefined;
  AdminChat: { threadId: string; name: string };
  CustomerDetail: { id: string; name: string };
  CustomerForm: { id?: string } | undefined;
  AccountRequests: undefined;
  Broadcast: undefined;
  Exports: undefined;
  PartnerAreas: { partnerId: string; name: string };
  Language: undefined;
  Notifications: undefined;
  SmsSettings: undefined;
};

export type PartnerTabParamList = { Home: undefined; Orders: undefined };
export type PartnerStackParamList = { Tabs: NavigatorScreenParams<PartnerTabParamList> | undefined; Job: { orderId: string }; MyAttendance: undefined; Language: undefined };
