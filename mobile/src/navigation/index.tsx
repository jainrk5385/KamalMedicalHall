import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '../components/ui';
import { LoginScreen, OtpScreen, SignupScreen, WelcomeScreen } from '../screens/auth/AuthScreens';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { CashScreen } from '../screens/admin/CashScreen';
import { ShopDetailsScreen } from '../screens/admin/ShopDetails';
import { SmsSettingsScreen } from '../screens/admin/SmsSettings';
import { ShopScreen } from '../screens/customer/ShopScreen';
import { AccountStatusScreen, DeactivatedScreen } from '../screens/customer/AccountScreens';
import { AnnouncementScreen } from '../screens/customer/AnnouncementScreen';
import { AnnouncementsScreen } from '../screens/admin/AdminAnnouncements';
import { AdminChatScreen, AdminChatsScreen, AdminReviewsScreen, BroadcastScreen, ExportsScreen, RevenueScreen } from '../screens/admin/AdminMore';
import { AccountRequestsScreen, CustomerDetailScreen, CustomerFormScreen, CustomersScreen } from '../screens/admin/CustomerAdmin';
import { AllOrdersScreen, AttendanceScreen, DashboardScreen, MoreScreen, OrderReviewScreen, OrdersByStatusScreen, PartnerAreasScreen, PaymentDetailsScreen, PincodesScreen, ReportsScreen, RequestsScreen, StoreSettingsScreen, TeamScreen, TermsScreen } from '../screens/admin/AdminScreens';
import { AddressFormScreen, AddressesScreen } from '../screens/customer/AddressScreens';
import { CartScreen } from '../screens/customer/CartScreen';
import { DeliveryTimeScreen, ReviewScreen, SuccessScreen } from '../screens/customer/CheckoutScreens';
import { HomeScreen } from '../screens/customer/HomeScreen';
import { TypeMedicinesScreen, UploadScreen } from '../screens/customer/OrderInputScreens';
import { OrderDetailScreen, OrdersScreen, PaymentScreen } from '../screens/customer/OrderScreens';
import { TrackScreen } from '../screens/customer/TrackScreen';
import { NotificationsScreen } from '../features/notifications/presentation/NotificationsScreen';
import { ChatScreen, MyReviewsScreen, WriteReviewScreen } from '../screens/customer/Extras';
import { EditProfileScreen, HelpScreen, LanguageScreen, LegalScreen, ProfileScreen } from '../screens/customer/ProfileScreens';
import { JobScreen, MyAttendanceScreen, PartnerHomeScreen, PartnerOrdersScreen } from '../screens/partner/PartnerScreens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout } from '../layout';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';
import { colors, fonts } from '../theme';
import { navigationRef } from './ref';
import { nativeLinking, webLinking } from './linking';
import type { AdminStackParamList, AdminTabParamList, AuthStackParamList, CustomerStackParamList, CustomerTabParamList, PartnerStackParamList, PartnerTabParamList } from './types';


const headerOptions = {
  headerTitleAlign: 'center' as const,
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: colors.white },
  animation: 'slide_from_right' as const,
  animationDuration: 280,
};

const tabBase = {
  headerShown: false,
  animation: 'fade' as const,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.secondary,
  tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
};
/**
 * Tab bar that respects the device's safe areas: the gesture / 3-button navigation bar at the bottom and the curved
 * or cut-out edges of edge-to-edge, foldable and landscape screens on the sides.
 */
function useTabOptions() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  const narrow = useWindowDimensions().width < 360;
  return {
    ...tabBase,
    tabBarLabelStyle: { ...tabBase.tabBarLabelStyle, fontSize: narrow ? 10.5 : 12 },
    sceneStyle: { paddingLeft: insets.left, paddingRight: insets.right },
    tabBarStyle: { height: 58 + bottom, paddingTop: 6, paddingBottom: bottom, paddingLeft: insets.left, paddingRight: insets.right, borderTopColor: colors.border },
  };
}
function TabIcon({ name, focusedName, color, focused }: { name: IconName; focusedName: IconName; color: string; focused: boolean }) {
  const sc = useSharedValue(1);
  const dot = useSharedValue(0);
  useEffect(() => {
    if (focused) sc.value = withSequence(withTiming(0.8, { duration: 90 }), withSpring(1.18, { damping: 5, stiffness: 240 }), withSpring(1, { damping: 10 }));
    dot.value = withSpring(focused ? 1 : 0, { damping: 12 });
  }, [focused, sc, dot]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  const d = useAnimatedStyle(() => ({ opacity: dot.value, transform: [{ scaleX: dot.value }] }));
  return <View style={{ alignItems: 'center' }}><Animated.View style={a}><Icon name={focused ? focusedName : name} size={25} color={color} /></Animated.View><Animated.View style={[{ position: 'absolute', top: -7, width: 22, height: 3, borderRadius: 2, backgroundColor: colors.primary }, d]} /></View>;
}
const tabIcon = (name: IconName, focusedName: IconName) => ({ color, focused }: { color: string; focused: boolean }) => <TabIcon name={name} focusedName={focusedName} color={color} focused={focused} />;

const Auth = createNativeStackNavigator<AuthStackParamList>();
function AuthNavigator() {
  const { t } = useTranslation();
  return (
    <Auth.Navigator screenOptions={{ ...headerOptions, headerShown: false }}>
      <Auth.Screen name="Welcome" component={WelcomeScreen} />
      <Auth.Screen name="Login" component={LoginScreen} />
      <Auth.Screen name="Register" component={RegisterScreen} />
      <Auth.Screen name="OTP" component={OtpScreen} />
      <Auth.Screen name="Legal" component={LegalScreen} options={{ headerShown: true, title: t('legal.title') }} />
    </Auth.Navigator>
  );
}

const CTabs = createBottomTabNavigator<CustomerTabParamList>();
function CustomerTabs() {
  const { t } = useTranslation();
  const count = useCart((s) => s.medicines.length + s.prescriptions.length);
  const tabOptions = useTabOptions();
  return (
    <CTabs.Navigator screenOptions={tabOptions}>
      <CTabs.Screen name="Home" component={HomeScreen} options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-outline', 'home') }} />
      <CTabs.Screen name="Orders" component={OrdersScreen} options={{ title: t('tabs.orders'), tabBarIcon: tabIcon('document-text-outline', 'document-text') }} />
      <CTabs.Screen name="Cart" component={CartScreen} options={{ title: t('tabs.cart'), tabBarBadge: count || undefined, tabBarIcon: tabIcon('cart-outline', 'cart') }} />
      <CTabs.Screen name="Profile" component={ProfileScreen} options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('person-outline', 'person') }} />
    </CTabs.Navigator>
  );
}

const CStack = createNativeStackNavigator<CustomerStackParamList>();
function CustomerNavigator() {
  const { t } = useTranslation();
  return (
    <CStack.Navigator screenOptions={headerOptions}>
      <CStack.Screen name="Tabs" component={CustomerTabs} options={{ headerShown: false }} />
      <CStack.Screen name="Upload" component={UploadScreen} options={{ title: t('screens.upload') }} />
      <CStack.Screen name="TypeMedicines" component={TypeMedicinesScreen} options={{ title: t('screens.typeMedicines') }} />
      <CStack.Screen name="Addresses" component={AddressesScreen} options={{ title: t('screens.address') }} />
      <CStack.Screen name="AddressForm" component={AddressFormScreen} options={{ title: t('screens.addressForm') }} />
      <CStack.Screen name="DeliveryTime" component={DeliveryTimeScreen} options={{ title: t('screens.time') }} />
      <CStack.Screen name="Review" component={ReviewScreen} options={{ title: t('screens.review') }} />
      <CStack.Screen name="Success" component={SuccessScreen} options={{ headerShown: false, gestureEnabled: false, animation: 'fade_from_bottom', animationDuration: 420 }} />
      <CStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: t('screens.orderDetail') }} />
      <CStack.Screen name="Track" component={TrackScreen} options={{ title: t('screens.track'), animation: 'fade_from_bottom' }} />
      <CStack.Screen name="Payment" component={PaymentScreen} options={{ title: t('screens.payment'), animation: 'fade_from_bottom' }} />
      <CStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t('home.notifications') }} />
      <CStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: t('profile.edit') }} />
      <CStack.Screen name="Language" component={LanguageScreen} options={{ title: t('profile.language') }} />
      <CStack.Screen name="Help" component={HelpScreen} options={{ title: t('profile.help') }} />
      <CStack.Screen name="Shop" component={ShopScreen} options={{ title: t('shop.title') }} />
      <CStack.Screen name="Announcement" component={AnnouncementScreen} options={{ title: t('ann.detailTitle') }} />
      <CStack.Screen name="Legal" component={LegalScreen} options={{ title: t('legal.title') }} />
      <CStack.Screen name="Chat" component={ChatScreen} options={{ title: t('chat.title') }} />
      <CStack.Screen name="WriteReview" component={WriteReviewScreen} options={{ title: t('reviews.writeTitle') }} />
      <CStack.Screen name="MyReviews" component={MyReviewsScreen} options={{ title: t('reviews.title') }} />
      <CStack.Screen name="Account" component={AccountStatusScreen} options={{ title: t('account.title') }} />
    </CStack.Navigator>
  );
}

const ATabs = createBottomTabNavigator<AdminTabParamList>();
function AdminTabs() {
  const { t } = useTranslation();
  const { isDesktop } = useLayout();
  const tabOptions = useTabOptions();
  const insets = useSafeAreaInsets();
  const sidebar = isDesktop ? { tabBarPosition: 'left' as const, tabBarVariant: 'material' as const, tabBarLabelPosition: 'beside-icon' as const, tabBarStyle: { width: 230 + insets.left, paddingLeft: insets.left, paddingBottom: insets.bottom, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.white } } : null;
  return (
    <ATabs.Navigator screenOptions={{ ...tabOptions, ...(sidebar ?? {}) }}>
      <ATabs.Screen name="Dashboard" component={DashboardScreen} options={{ title: t('admin.dashboard'), tabBarLabel: t('admin.tabHome'), tabBarIcon: tabIcon('grid-outline', 'grid') }} />
      <ATabs.Screen name="Requests" component={RequestsScreen} options={{ title: t('admin.newRequests'), tabBarLabel: t('admin.tabRequests'), tabBarIcon: tabIcon('mail-unread-outline', 'mail-unread') }} />
      <ATabs.Screen name="Orders" component={AllOrdersScreen} options={{ title: t('tabs.orders'), tabBarLabel: t('admin.tabOrders'), tabBarIcon: tabIcon('document-text-outline', 'document-text') }} />
      <ATabs.Screen name="Team" component={TeamScreen} options={{ title: t('admin.team'), tabBarLabel: t('admin.tabTeam'), tabBarIcon: tabIcon('people-outline', 'people') }} />
      <ATabs.Screen name="More" component={MoreScreen} options={{ title: t('admin.more'), tabBarIcon: tabIcon('menu-outline', 'menu') }} />
    </ATabs.Navigator>
  );
}
const AStack = createNativeStackNavigator<AdminStackParamList>();
function AdminNavigator() {
  const { t } = useTranslation();
  return (
    <AStack.Navigator screenOptions={headerOptions}>
      <AStack.Screen name="Tabs" component={AdminTabs} options={{ headerShown: false }} />
      <AStack.Screen name="OrderReview" component={OrderReviewScreen} options={{ title: t('screens.orderDetail') }} />
      <AStack.Screen name="Customers" component={CustomersScreen} options={{ title: t('admin.customers') }} />
      <AStack.Screen name="Reports" component={ReportsScreen} options={{ title: t('admin.reports') }} />
      <AStack.Screen name="PaymentDetails" component={PaymentDetailsScreen} options={{ title: t('admin.paymentDetails') }} />
      <AStack.Screen name="Attendance" component={AttendanceScreen} options={{ title: t('admin.attendance') }} />
      <AStack.Screen name="Pincodes" component={PincodesScreen} options={{ title: t('admin.pincodes') }} />
      <AStack.Screen name="PartnerAreas" component={PartnerAreasScreen} options={({ route }) => ({ title: route.params.name })} />
      <AStack.Screen name="OrdersByStatus" component={OrdersByStatusScreen} options={({ route }) => ({ title: route.params.title })} />
      <AStack.Screen name="Revenue" component={RevenueScreen} options={{ title: t('admin.revenue') }} />
      <AStack.Screen name="Cash" component={CashScreen} options={{ title: t('cash.title') }} />
      <AStack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: t('ann.title') }} />
      <AStack.Screen name="ShopDetails" component={ShopDetailsScreen} options={{ title: t('shop.adminTitle') }} />
      <AStack.Screen name="AdminReviews" component={AdminReviewsScreen} options={{ title: t('admin.reviews') }} />
      <AStack.Screen name="AdminChats" component={AdminChatsScreen} options={{ title: t('admin.chats') }} />
      <AStack.Screen name="AdminChat" component={AdminChatScreen} options={({ route }) => ({ title: route.params.name })} />
      <AStack.Screen name="CustomerDetail" component={CustomerDetailScreen} options={({ route }) => ({ title: route.params.name })} />
      <AStack.Screen name="CustomerForm" component={CustomerFormScreen} options={{ title: t('cust.addTitle') }} />
      <AStack.Screen name="AccountRequests" component={AccountRequestsScreen} options={{ title: t('cust.requests') }} />
      <AStack.Screen name="Broadcast" component={BroadcastScreen} options={{ title: t('admin.broadcast') }} />
      <AStack.Screen name="Exports" component={ExportsScreen} options={{ title: t('admin.exports') }} />
      <AStack.Screen name="Terms" component={TermsScreen} options={{ title: t('admin.terms') }} />
      <AStack.Screen name="StoreSettings" component={StoreSettingsScreen} options={{ title: t('admin.settings') }} />
      <AStack.Screen name="Language" component={LanguageScreen} options={{ title: t('profile.language') }} />
      <AStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t('admin.notifications') }} />
      <AStack.Screen name="SmsSettings" component={SmsSettingsScreen} options={{ title: t('sms.title') }} />
    </AStack.Navigator>
  );
}

const PTabs = createBottomTabNavigator<PartnerTabParamList>();
function PartnerTabs() {
  const { t } = useTranslation();
  const tabOptions = useTabOptions();
  return (
    <PTabs.Navigator screenOptions={tabOptions}>
      <PTabs.Screen name="Home" component={PartnerHomeScreen} options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-outline', 'home') }} />
      <PTabs.Screen name="Orders" component={PartnerOrdersScreen} options={{ title: t('tabs.orders'), tabBarIcon: tabIcon('document-text-outline', 'document-text') }} />
    </PTabs.Navigator>
  );
}
const PStack = createNativeStackNavigator<PartnerStackParamList>();
function PartnerNavigator() {
  const { t } = useTranslation();
  return (
    <PStack.Navigator screenOptions={headerOptions}>
      <PStack.Screen name="Tabs" component={PartnerTabs} options={{ headerShown: false }} />
      <PStack.Screen name="Job" component={JobScreen} options={{ title: t('screens.orderDetail') }} />
      <PStack.Screen name="MyAttendance" component={MyAttendanceScreen} options={{ title: t('partner.myAttendance') }} />
      <PStack.Screen name="Language" component={LanguageScreen} options={{ title: t('profile.language') }} />
    </PStack.Navigator>
  );
}

/** Customers must have a name on file before reaching the app (first-login signup). A deactivated account sees only its status. */
function CustomerGate() {
  const needsName = useSession((s) => !s.user?.name);
  const deactivated = useSession((s) => s.user?.isActive === false);
  if (deactivated) return <DeactivatedScreen />;
  return needsName ? <SignupScreen /> : <CustomerNavigator />;
}

export function Navigation() {
  const status = useSession((s) => s.status);
  const role = useSession((s) => s.user?.role);
  const bootstrap = useSession((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: colors.white }} />; // the animated splash covers this
  return (
    <NavigationContainer ref={navigationRef} linking={Platform.OS === 'web' ? webLinking : nativeLinking}>
      {status === 'out' ? <AuthNavigator /> : role === 'admin' ? <AdminNavigator /> : role === 'delivery_partner' ? <PartnerNavigator /> : <CustomerGate />}
    </NavigationContainer>
  );
}
