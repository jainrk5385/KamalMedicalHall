import { useErrorPopup } from '../../hooks';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Toggle } from '../../components/Toggle';
import Animated, { FadeInDown, FadeOutLeft, LinearTransition } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { uploadPrescription } from '../../api/upload';
import type { Order, OrderSummary, Partner, PartnerState } from '../../api/types';
import { Avatar, CallButton } from '../../components/CallButton';
import { openFile } from '../../components/FileViewer';
import { ListRow } from '../../components/layout';
import { SourceOptions } from '../../components/SourceOptions';
import { NotificationBell } from '../../components/NotificationBell';
import { NotificationsRow } from '../../components/NotificationsRow';
import { OrderCard } from '../../components/OrderCard';
import { CountUp, Enter, Skeleton, Tap, tick } from '../../components/motion';
import { ButtonRow, Button, Card, ErrorView, Icon, Message, Pill, ResponsiveGrid, Screen, TextField, type IconName } from '../../components/ui';
import { notice, showDialog } from '../../dialog';
import { useLoad } from '../../hooks';
import { guessMime, isBlockedName, isImageMime } from '../../fileKinds';
import { useContentStyle, useLayout } from '../../layout';
import type { AdminStackParamList, AdminTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone , formatDelivery } from '../../utils';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
const LIVE = ['order:update', 'notification'];
const DASH_LIVE = ['order:update', 'notification', 'store:update'];
const Header = ({ title, right }: { title: string; right?: React.ReactNode }) => <View style={s.headRow}><Text style={[type.h2, s.heading]}>{title}</Text>{right ? <View style={s.headRight}>{right}</View> : null}</View>;
const STATE_TONE: Record<PartnerState, 'green' | 'red' | 'amber' | 'blue'> = { off: 'red', available: 'green', reserved: 'amber', busy: 'blue', returning: 'blue', break: 'amber' };
const DUTY_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue'> = { on_duty: 'green', on_break: 'amber', off_duty: 'red', leave: 'amber', absent: 'red' };
const statePill = (t: (k: string) => string, p: { state: PartnerState; active: boolean; dutyStatus?: string; paidLeave?: boolean }) =>
  !p.active ? <Pill text={t('admin.inactive')} tone="red" />
  : p.dutyStatus === 'leave' ? <Pill text={t(p.paidLeave ? 'admin.ds_paid_leave' : 'admin.ds_leave')} tone={p.paidLeave ? 'blue' : 'amber'} />
  : <Pill text={t(`admin.st_${p.state}`)} tone={STATE_TONE[p.state]} />;
const dutyPill = (t: (k: string) => string, status: string, paid = false) => <Pill text={t(status === 'leave' && paid ? 'admin.ds_paid_leave' : `admin.ds_${status}`)} tone={status === 'leave' && paid ? 'blue' : DUTY_TONE[status] ?? 'red'} />;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
const ListSkeleton = () => <View style={{ padding: spacing.lg, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={110} r={16} />)}</View>;

function OrderRow({ o, onPress, index = 0 }: { o: OrderSummary; onPress: () => void; index?: number }) {
  return <OrderCard order={o} index={index} onPress={onPress} subtitle={`${o.customerName ?? o.customerPhone ?? ''}${o.summary ? ' · ' + o.summary : ''}`} />;
}

// ---------------------------------------------------------------- Dashboard
/** The latest announcements with a one-tap "send again" (disabled once expired). */
function AnnouncementsCard() {
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const { data, reload } = useLoad(() => endpoints.admin.announcements(), ['announcement:update']);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const list = (data?.announcements ?? []).slice(0, 3);
  const again = async (id: string) => {
    setBusy(id); setErr('');
    try { await endpoints.admin.sendAnnouncement(id); tick('success'); await reload(); } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };
  return (
    <>
      <Text style={[type.h3, s.sec]}>{t('ann.sentCardTitle')}</Text>
      <Card style={{ gap: 10 }}>
        {!list.length ? <Text style={[type.small, { color: colors.secondary }]}>{t('ann.none')}</Text> : list.map((a) => (
          <View key={a.id} style={s.annRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
              <Text style={[type.small, { color: a.status === 'active' ? colors.secondary : a.status === 'expired' ? colors.red : colors.amber }]}>{a.status === 'inactive' ? t('ann.inactive') : !a.expiresAt ? t('ann.noExpiryLine') : a.expired ? t('ann.expiredOn', { date: formatDateTime(a.expiresAt) }) : t('ann.expiresOn', { date: formatDateTime(a.expiresAt) })}</Text>
            </View>
            <Button small variant="outline" icon="send" title={t('ann.pushReminder')} onPress={() => again(a.id)} loading={busy === a.id} disabled={a.status !== 'active' || !!busy} />
          </View>
        ))}
        <Button small variant="ghost" icon="megaphone" title={t('ann.manage')} onPress={() => nav.navigate('Announcements')} />
      </Card>
    </>
  );
}

export function DashboardScreen(_p: BottomTabScreenProps<AdminTabParamList, 'Dashboard'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle(true);
  const { tileColumns } = useLayout();
  const stats = useLoad(() => endpoints.admin.dashboard(), DASH_LIVE);
  const ov = useLoad(() => endpoints.admin.overview(), [...DASH_LIVE, 'chat:update']);
  const [toggling, setToggling] = useState(false);
  const team = useLoad(() => endpoints.admin.partners(), ['partner:update', 'order:update']);
  const recent = useLoad(() => endpoints.admin.orders('requested'), LIVE);
  const data = stats.data;
  let tileIndex = 1;
  const tile = (icon: IconName, label: string, value: number, money = false, tone: 'blue' | 'green' | 'amber' = 'blue', onPress?: () => void) => (
    <Enter index={tileIndex++}>
      <Card onPress={onPress} style={s.tileCard}>
        <View style={[s.tileIcon, tone === 'green' && { backgroundColor: colors.greenBg }, tone === 'amber' && { backgroundColor: colors.amberBg }]}><Icon name={icon} size={22} color={tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : colors.primary} /></View>
        <CountUp value={value} prefix={money ? '₹' : ''} style={[type.h1, { color: colors.text }]} />
        <Text style={[type.small, { color: colors.secondary }]}>{label}</Text>
      </Card>
    </Enter>
  );
  const setOpen = async (v: boolean) => {
    if (!v) {
      const ok = await showDialog({ title: t('admin.closeStoreTitle'), message: t('admin.closeStoreMsg'), icon: 'storefront', tone: 'danger', confirmLabel: t('admin.closeStore'), cancelLabel: t('common.cancel') });
      if (!ok) return;
    }
    setToggling(true);
    try { await endpoints.admin.setStoreOpen(v); tick('success'); await Promise.all([stats.reload(), team.reload()]); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } finally { setToggling(false); }
  };
  const available = team.data?.partners.filter((p) => p.isAvailable && p.active).length ?? 0;
  const totalPartners = team.data?.partners.filter((p) => p.active).length ?? 0;
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.dashboard')} right={<NotificationBell label={t('admin.notifications')} onPress={() => nav.navigate('Notifications')} />} />
      {stats.loading && !data ? <ListSkeleton /> : stats.error && !data ? <ErrorView message={stats.error} onRetry={stats.reload} retryLabel={t('common.retry')} /> : (
        <ScrollView contentContainerStyle={[s.pad, content]} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void stats.reload(); void ov.reload(); void team.reload(); void recent.reload(); }} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          <Enter index={0}>
            <View style={[s.storeCard, data!.isOpen ? { backgroundColor: colors.greenBg } : { backgroundColor: colors.redBg }]}>
              <View style={[s.tileIcon, { backgroundColor: colors.white, marginBottom: 0 }]}><Icon name="storefront" size={22} color={data!.isOpen ? colors.green : colors.red} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{data!.isOpen ? t('admin.shopIsOpen') : t('admin.shopIsClosed')}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{data!.isOpen ? t('admin.shopOpenHelp') : t('admin.shopClosedHelp')}</Text>
              </View>
              <Toggle accessibilityLabel={t('admin.storeOpen')} value={data!.isOpen} onValueChange={setOpen} disabled={toggling} />
            </View>
          </Enter>
          <Text style={[type.h3, s.sec]}>{t('admin.secOrders')}</Text>
          <ResponsiveGrid columns={tileColumns}>
            {tile('mail-unread', t('admin.newRequests'), data!.requested, false, 'amber', () => nav.navigate('Tabs', { screen: 'Requests' }))}
            {tile('hourglass', t('admin.awaiting'), data!.awaitingPayment, false, 'blue', () => nav.navigate('OrdersByStatus', { title: t('admin.awaiting'), status: 'quoted,accepted,awaiting_payment' }))}
            {tile('cube', t('admin.ready'), data!.readyToDispatch, false, 'blue', () => nav.navigate('OrdersByStatus', { title: t('admin.ready'), status: 'ready_to_dispatch' }))}
            {tile('bicycle', t('admin.outForDelivery'), data!.outForDelivery, false, 'blue', () => nav.navigate('OrdersByStatus', { title: t('admin.outForDelivery'), status: 'out_for_delivery' }))}
            {tile('checkmark-done', t('admin.deliveredToday'), data!.deliveredToday, false, 'green', () => nav.navigate('OrdersByStatus', { title: t('admin.delivered'), status: 'delivered' }))}
            {tile('close-circle', t('admin.cancelledToday'), ov.data?.cancelledToday ?? 0, false, 'amber', () => nav.navigate('OrdersByStatus', { title: t('admin.cancelled'), status: 'cancelled,rejected' }))}
          </ResponsiveGrid>

          <Text style={[type.h3, s.sec]}>{t('admin.secMoney')}</Text>
          <ResponsiveGrid columns={tileColumns}>
            {tile('cash', t('admin.salesToday'), data!.salesToday, true, 'green', () => nav.navigate('Revenue'))}
            {tile('trending-up', t('admin.sales7d'), ov.data?.sales7d ?? 0, true, 'green', () => nav.navigate('Revenue'))}
            {tile('pricetag', t('admin.avgOrder'), ov.data?.avgOrder30d ?? 0, true, 'blue', () => nav.navigate('Revenue'))}
          </ResponsiveGrid>

          <Text style={[type.h3, s.sec]}>{t('admin.secPeople')}</Text>
          <ResponsiveGrid columns={tileColumns}>
            {tile('people', t('admin.customers'), ov.data?.customers ?? 0, false, 'blue', () => nav.navigate('Customers'))}
            {tile('chatbubbles', t('admin.chatsWaiting'), ov.data?.chatWaiting ?? 0, false, (ov.data?.chatWaiting ?? 0) > 0 ? 'amber' : 'blue', () => nav.navigate('AdminChats'))}
            {tile('star', t('admin.pendingReviews'), ov.data?.pendingReviews ?? 0, false, (ov.data?.pendingReviews ?? 0) > 0 ? 'amber' : 'blue', () => nav.navigate('AdminReviews'))}
          </ResponsiveGrid>

          <Enter index={8}>
            <Card onPress={() => nav.navigate('Tabs', { screen: 'Team' })} style={s.teamCard}>
              <View style={[s.tileIcon, { backgroundColor: available ? colors.greenBg : colors.amberBg, marginBottom: 0 }]}><Icon name="people" size={22} color={available ? colors.green : colors.amber} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.liveTeam')}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{totalPartners ? t('admin.availableNow', { available, total: totalPartners }) : t('admin.noPartners')}</Text>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.muted} />
            </Card>
          </Enter>

          <AnnouncementsCard />

          <Text style={[type.h3, s.sec]}>{t('admin.secManage')}</Text>
          <ResponsiveGrid columns={tileColumns}>
            {([
              ['storefront', 'shop.adminTitle', 'ShopDetails'], ['bar-chart', 'admin.revenue', 'Revenue'], ['wallet', 'cash.title', 'Cash'], ['download', 'admin.exports', 'Exports'], ['megaphone', 'ann.title', 'Announcements'],
              ['card', 'admin.paymentDetails', 'PaymentDetails'], ['location', 'admin.pincodes', 'Pincodes'], ['calendar', 'admin.attendance', 'Attendance'],
              ['document-text', 'admin.terms', 'Terms'], ['settings', 'admin.settings', 'StoreSettings'],
            ] as const).map(([icon, label, route]) => (
              <Card key={route} onPress={() => nav.navigate(route)} style={s.manageCard}>
                <Icon name={icon} size={24} color={colors.primary} />
                <Text style={[type.smallMedium, { color: colors.text, textAlign: 'center' }]} numberOfLines={2}>{t(label)}</Text>
              </Card>
            ))}
          </ResponsiveGrid>

          <Enter index={9}><Text style={[type.h3, s.sec]}>{t('admin.recentRequests')}</Text></Enter>
          {recent.data && !recent.data.orders.length ? <Text style={[type.small, { color: colors.secondary }]}>{t('admin.noRequests')}</Text> : null}
          <ResponsiveGrid>{recent.data?.orders.slice(0, 4).map((o, i) => <OrderRow key={o.id} o={o} index={i + 10} onPress={() => nav.navigate('OrderReview', { orderId: o.id })} />)}</ResponsiveGrid>
        </ScrollView>)}
    </SafeAreaView>
  );
}

function OrderList({ status, title, search, embedded }: { status?: string; title: string; search?: boolean; embedded?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<string | undefined>(status);
  const content = useContentStyle(true);
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(id); }, [q]);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.orders(filter, term || undefined), LIVE);
  useEffect(() => { void reload(); }, [filter, term, reload]);
  const filters = [undefined, 'requested', 'quoted,awaiting_payment', 'ready_to_dispatch', 'out_for_delivery', 'delivered', 'cancelled,rejected'];
  return (
    <SafeAreaView style={s.fill} edges={embedded ? ['left', 'right', 'bottom'] : ['top']}>
      {embedded ? null : <Header title={title} />}
      {search ? <>
        <Enter><View style={s.search}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} placeholder={t('admin.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.search')} style={[type.body, s.searchInput]} /></View></Enter>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} style={{ flexGrow: 0, flexShrink: 0 }}>
          {filters.map((f) => <Tap key={f ?? 'all'} accessibilityRole="button" onPress={() => setFilter(f)} scaleTo={0.93} style={[s.chip, filter === f && s.chipOn]}><Text style={[type.smallMedium, { color: filter === f ? colors.white : colors.navy }]}>{f ? t(`status.${f.split(',')[0]}`) : t('admin.all')}</Text></Tap>)}
        </ScrollView></> : null}
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.orders.length ? <Message icon="file-tray-outline" title={t('admin.noOrders')} /> : (
        <ScrollView contentContainerStyle={[s.pad, content]} refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          <ResponsiveGrid>{data.orders.map((o, i) => <OrderRow key={o.id} o={o} index={i} onPress={() => nav.navigate('OrderReview', { orderId: o.id })} />)}</ResponsiveGrid>
        </ScrollView>)}
    </SafeAreaView>
  );
}
export const RequestsScreen = () => { const { t } = useTranslation(); return <OrderList status="requested" title={t('admin.newRequests')} />; };
export function OrdersByStatusScreen({ route }: NativeStackScreenProps<AdminStackParamList, 'OrdersByStatus'>) { return <OrderList status={route.params.status} title={route.params.title} search embedded />; }
export const AllOrdersScreen = () => { const { t } = useTranslation(); return <OrderList title={t('admin.allOrders')} search />; };

// ---------------------------------------------------------------- Order review
/** Why this partner cannot take the order right now, or null when they can. */
function assignBlocker(t: (k: string, o?: Record<string, unknown>) => string, p: Partner, pincode: string): string | null {
  const covers = p.pincodes.length === 0 || p.pincodes.includes(pincode);
  return !p.active ? t('admin.inactive') : !covers ? t('admin.notCoveredReason', { pincode }) : null;
}

function PartnerRow({ p, pincode, busy, canAssign, onAssign }: { p: Partner; pincode: string; busy: boolean; canAssign: boolean; onAssign: () => void }) {
  const { t } = useTranslation();
  const covers = p.pincodes.length === 0 || p.pincodes.includes(pincode);
  const ready = p.active && p.state === 'available' && covers;
  const reason = assignBlocker(t, p, pincode) ?? (p.state === 'available' ? null : ['off', 'break'].includes(p.state) ? t('admin.offDutyHint') : t('admin.queueHint', { count: p.activeOrders }));
  return (
    <View style={[s.partnerRow, ready && s.partnerReady]}>
      <ListRow
        leading={<Avatar name={p.name} />}
        trailing={<View style={s.partnerActions}><CallButton phone={p.phone} compact label={t('admin.callPartner')} /><Button small title={t('admin.assignBtn')} onPress={onAssign} disabled={!canAssign} loading={busy} style={s.assignBtn} /></View>}>
        <Text style={[type.bodyMedium, { color: colors.text }]}>{p.name}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{p.phone}{p.activeOrders ? ` · ${t('admin.activeOrders', { count: p.activeOrders })}` : ''}</Text>
        <View style={s.pillRow}>
          {statePill(t, p)}
          <Pill text={p.pincodes.length === 0 ? t('admin.coversAll') : covers ? t('admin.covers', { pincode }) : t('admin.notCovered')} tone={covers ? 'blue' : 'red'} />
        </View>
      </ListRow>
      {!ready && reason ? <Text style={[type.small, s.reasonText]}>{reason}</Text> : null}
    </View>
  );
}

export function OrderReviewScreen({ route }: NativeStackScreenProps<AdminStackParamList, 'OrderReview'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.order(route.params.orderId), ['order:update']);
  const partners = useLoad(() => endpoints.admin.partners(), ['partner:update', 'order:update']);
  const [amount, setAmount] = useState('');
  const [bill, setBill] = useState<{ uri: string; name: string; mimeType: string; sizeBytes?: number } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o: Order = data!.order;
  const run = async (key: string, fn: () => Promise<{ order: Order }>) => {
    setBusy(key); setErr('');
    try { const r = await fn(); setData({ order: r.order }); setReason(''); void partners.reload(); tick('success'); } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };
  const list = [...(partners.data?.partners ?? [])].sort((a, b) => Number(b.isAvailable && b.active) - Number(a.isAvailable && a.active));
  const canCancel = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status);
  const quoteValue = Number(amount);
  const mapsQuery = encodeURIComponent([o.address.line1, o.address.line2, o.address.landmark, o.address.city, o.address.pincode].filter(Boolean).join(', '));
  const openMaps = () => { void Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${mapsQuery}` : `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`); };

  /** The bill can be photographed, taken from the gallery or chosen as any file (PDF, Word, Excel...). */
  const pickBill = async (source: 'camera' | 'gallery' | 'file') => {
    setErr('');
    try {
      let picked: { uri: string; name: string; mimeType: string; sizeBytes?: number } | null = null;
      if (source === 'file') {
        const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.[0]) return;
        const a = res.assets[0];
        picked = { uri: a.uri, name: a.name, mimeType: guessMime(a.name, a.mimeType), sizeBytes: a.size };
      } else {
        if (source === 'camera') {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { setErr(t('upload.permission')); return; }
        }
        const res = source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
        if (res.canceled || !res.assets?.[0]) return;
        const a = res.assets[0];
        const mime = guessMime(a.fileName ?? a.uri, a.mimeType ?? 'image/jpeg');
        picked = { uri: a.uri, name: a.fileName ?? `bill-${o.orderNumber}.${(mime.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')}`, mimeType: isImageMime(mime) ? mime : 'image/jpeg', sizeBytes: a.fileSize };
      }
      if (isBlockedName(picked.name)) { setErr(t('admin.billType')); return; }
      if ((picked.sizeBytes ?? 0) > 10 * 1024 * 1024) { setErr(t('admin.billTooBig')); return; }
      setBill(picked);
      tick();
    } catch { setErr(t('admin.billPickFailed')); }
  };
  const sendQuote = async () => {
    if (!bill) { setErr(t('admin.billRequired')); tick('error'); return; }
    setBusy('quote'); setErr('');
    try {
      const sig = await endpoints.signUpload('bill');
      const up = await uploadPrescription({ id: 'bill', ...bill }, sig);
      await endpoints.admin.quote(o.id, quoteValue, { publicId: up.publicId, mimeType: up.mimeType, resourceType: up.resourceType, sizeBytes: up.sizeBytes, name: bill.name });
      tick('success');
      await notice(t('admin.quoteSentTitle'), t('admin.quoteSentMsg', { order: o.orderNumber, amount: formatMoney(quoteValue) }), t('common.ok'));
      nav.goBack();
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };

  const assign = async (p: Partner) => {
    // Assign is always tappable. When the partner cannot take the order, say why in a popup instead of a dead button.
    const blocker = assignBlocker(t, p, o.address.pincode);
    if (blocker) {
      const call = await showDialog({ title: t('admin.cannotAssignTitle', { name: p.name }), message: blocker, icon: 'alert-circle', confirmLabel: t('admin.callPartner'), cancelLabel: t('common.ok') });
      if (call) void Linking.openURL(`tel:${p.phone}`);
      return;
    }
    const offDuty = ['off', 'break'].includes(p.state);
    const busy_ = !offDuty && p.state !== 'available';
    const ok = await showDialog({ title: t('admin.assignConfirmTitle', { name: p.name }), message: busy_ ? t('admin.assignBusyMsg', { order: o.orderNumber, count: p.activeOrders }) : offDuty ? t('admin.assignOffDutyMsg', { order: o.orderNumber }) : t('admin.assignConfirmMsg', { order: o.orderNumber }), icon: 'bicycle', confirmLabel: t('admin.assignBtn'), cancelLabel: t('common.cancel') });
    if (ok) await run(`assign-${p.id}`, () => endpoints.admin.assign(o.id, p.id));
  };

  return (
    <Screen>
      <Enter index={0}>
        <View style={s.rowBetween}><Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} /></View>
        <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{formatDateTime(o.createdAt)}</Text>
        {['ready_to_dispatch', 'out_for_delivery', 'delivered'].includes(o.status) && o.quotedAmount !== null ? (
          <Button title={t('order.invoice')} variant="outline" icon="receipt" onPress={async () => { try { const l = await endpoints.invoiceLink(o.id); await Linking.openURL(l.url); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } }} style={{ marginBottom: spacing.md }} />
        ) : null}
      </Enter>

      <Enter index={1}>
        <Card style={s.block}>
          <View style={s.personRow}>
            <Avatar name={o.customer?.name} size={48} />
            <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{t('admin.customer')}</Text><Text style={[type.h3, { color: colors.text }]}>{o.customer?.name ?? '—'}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {o.customer?.phone}</Text></View>
          </View>
          <ButtonRow>
            <View style={{ flex: 1 }}><CallButton phone={o.customer?.phone} label={t('admin.callCustomer')} /></View>
            <Button title={t('admin.directions')} variant="outline" icon="navigate" onPress={openMaps} style={{ flex: 1 }} />
          </ButtonRow>
          <Text style={[type.body, { color: colors.text, marginTop: spacing.md }]}>{[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}, {o.address.city} - {o.address.pincode}</Text>
          <Text style={[type.smallMedium, { color: colors.secondary, marginTop: 2 }]}>{formatDelivery(o.deliveryDate, o.deliverySlot)}</Text>
        </Card>
      </Enter>

      <Enter index={2}>
        <Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{o.kind === 'prescription' ? t('admin.prescriptions') : t('order.items')}</Text>
          {o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>)}
          <View style={s.rxRow}>{o.prescriptions.map((p) => (
            <Tap key={p.id} accessibilityRole="button" onPress={() => openFile({ title: `${t('admin.prescriptions')} · #${o.orderNumber}`, urls: p.previewUrls ?? [], fallbackUrl: p.url })} style={s.rx}>
              {!isImageMime(p.mimeType) || !p.url ? <Icon name="document-text" size={30} /> : <Image source={{ uri: p.url }} style={{ flex: 1, width: '100%', borderRadius: radius.sm }} />}
            </Tap>))}</View>
          {o.note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {o.note}</Text> : null}
          {o.quotedAmount !== null ? <Text style={[type.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>{t('order.amount')}: {formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)} (${o.paymentStatus})` : ''}</Text> : null}
          {o.bill ? <ButtonRow style={{ marginTop: spacing.sm }}>
            <Button title={t('admin.viewBill')} variant="outline" icon="eye" small disabled={!o.bill.viewUrl} onPress={() => openFile({ title: o.bill!.name, urls: o.bill!.previewUrls ?? [], fallbackUrl: o.bill!.viewUrl, downloadUrl: o.bill!.downloadUrl })} style={{ flex: 1 }} />
            <Button title={t('order.downloadBill')} icon="download" small disabled={!o.bill.downloadUrl} onPress={() => { void Linking.openURL(o.bill!.downloadUrl!); }} style={{ flex: 1 }} />
          </ButtonRow> : null}

          {o.rejectionReason || o.cancelReason ? <Text style={[type.body, { color: colors.red, marginTop: spacing.sm }]}>{o.rejectionReason ?? o.cancelReason}</Text> : null}
        </Card>
      </Enter>

      {o.collection ? (
        <Enter index={3}>
          <Card style={s.block}>
            <Text style={[type.h3, { color: colors.text }]}>{t('cash.collectedTitle')}</Text>
            <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{t(`partner.via${o.collection.via === 'cash' ? 'Cash' : o.collection.via === 'upi' ? 'Upi' : 'Bank'}`)} · {formatMoney(o.quotedAmount ?? 0)}{o.collection.collectedBy ? ` · ${o.collection.collectedBy}` : ''}</Text>
            {o.collection.reference ? <Text style={[type.bodyMedium, { color: colors.primary, marginTop: 4 }]} selectable>{t('partner.txnLabel')}: {o.collection.reference}</Text> : null}
            {o.collection.proof?.url ? <Button small variant="outline" icon="image" title={t('cash.viewProof')} style={{ marginTop: spacing.sm }} onPress={() => { void openFile({ title: t('cash.proofName', { order: o.orderNumber }), urls: [o.collection!.proof!.url!], fallbackUrl: o.collection!.proof!.url }); }} /> : null}
            {o.collection.via === 'cash' ? (
              o.collection.cashSettledAt
                ? <Pill text={t('cash.received', { time: formatDateTime(o.collection.cashSettledAt) })} tone="green" />
                : <><Pill text={t('cash.withPartner')} tone="amber" />{o.partner ? <Button title={t('cash.markReceived')} icon="checkmark-done" style={{ marginTop: spacing.sm }} loading={busy === 'settle'} onPress={async () => { const ok = await showDialog({ title: t('cash.confirmTitle', { name: o.collection!.collectedBy ?? '' }), message: t('cash.confirmOne', { amount: formatMoney(o.quotedAmount ?? 0), order: o.orderNumber }), icon: 'cash', confirmLabel: t('cash.markReceived'), cancelLabel: t('common.cancel') }); if (ok) await run('settle', async () => { await endpoints.admin.settleCash(o.partner!.id, [o.id]); return endpoints.order(o.id); }); }} /> : null}</>
            ) : <Pill text={t('cash.paidOnline')} tone="green" />}
          </Card>
        </Enter>
      ) : null}

      {o.partner ? (
        <Enter index={3}>
          <Card style={s.block}>
            <View style={s.personRow}>
              <Avatar name={o.partner.name} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={[type.small, { color: colors.secondary }]}>{t('admin.partner')}</Text>
                <Text style={[type.h3, { color: colors.text }]}>{o.partner.name}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>+91 {o.partner.phone}</Text>
              </View>
              <CallButton phone={o.partner.phone} compact label={t('admin.callPartner')} />
            </View>
            <View style={[s.pillRow, { marginTop: spacing.md }]}>
              <Pill text={o.status === 'out_for_delivery' ? t('admin.st_busy') : o.partnerAccepted ? (o.status === 'ready_to_dispatch' ? t('admin.accepted') : t('admin.acceptedWaiting')) : t('admin.waitingResponse')} tone={o.status === 'out_for_delivery' ? 'blue' : o.partnerAccepted ? 'green' : 'amber'} />
            </View>
            {['quoted', 'awaiting_payment', 'ready_to_dispatch', 'out_for_delivery'].includes(o.status) ? <Button title={t('admin.unassign')} variant="outline" icon="swap-horizontal" loading={busy === 'unassign'} style={{ marginTop: spacing.md }}
              onPress={async () => { const ok = await showDialog({ title: t('admin.unassignTitle', { name: o.partner!.name }), message: t('admin.unassignMsg'), icon: 'swap-horizontal', confirmLabel: t('admin.unassign'), cancelLabel: t('common.cancel') }); if (ok) await run('unassign', () => endpoints.admin.unassign(o.id)); }} /> : null}
          </Card>
        </Enter>
      ) : null}

      {o.status === 'requested' || o.status === 'quoted' ? (
        <Enter index={4}>
          <Card style={s.block}>
            <Text style={[type.h3, { color: colors.text, marginBottom: spacing.sm }]}>{o.status === 'quoted' ? t('admin.requote') : t('admin.setQuote')}</Text>
            <TextField label={t('admin.amountLabel')} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0" valid={quoteValue > 0} />
            <Text style={[type.smallMedium, { color: colors.text, marginBottom: 6 }]}>{t('admin.billLabel')} *</Text>
            <View style={[s.billPick, bill && { borderColor: colors.green, backgroundColor: colors.greenBg, borderStyle: 'solid' }]}>
              <Icon name={bill ? 'document-attach' : 'cloud-upload-outline'} size={24} color={bill ? colors.green : colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={2}>{bill ? bill.name : t('admin.billAttach')}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{bill ? t('admin.billChange') : t('admin.billHint')}</Text>
              </View>
              {bill ? <Tap accessibilityRole="button" accessibilityLabel={t('upload.remove', { name: bill.name })} hitSlop={8} onPress={() => setBill(null)} haptic={false}><Icon name="close-circle" size={24} color={colors.muted} /></Tap> : null}
            </View>
            <SourceOptions options={[
              { icon: 'camera', label: t('upload.camera'), onPress: () => { void pickBill('camera'); } },
              { icon: 'images', label: t('upload.gallery'), onPress: () => { void pickBill('gallery'); } },
              { icon: 'document-text', label: t('upload.file'), onPress: () => { void pickBill('file'); } },
            ]} />
            <Button title={t('admin.sendQuote')} icon="send" disabled={!(quoteValue > 0) || !bill} loading={busy === 'quote'} onPress={sendQuote} style={{ marginTop: spacing.md }} />
          </Card>
        </Enter>
      ) : null}
      {o.status === 'requested' ? (
        <Enter index={5}>
          <Card style={s.block}>
            <TextField label={t('admin.rejectReason')} value={reason} onChangeText={setReason} />
            <Button title={t('admin.reject')} variant="danger" disabled={reason.trim().length < 3} loading={busy === 'reject'} onPress={() => run('reject', () => endpoints.admin.reject(o.id, reason.trim()))} />
          </Card>
        </Enter>
      ) : null}
      {o.status === 'awaiting_payment' ? <Enter index={4}><Card style={s.block}><Text style={[type.body, { color: colors.text }]}>{t('admin.awaitingRazorpay')}</Text></Card></Enter> : null}

      {['quoted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status) && !o.partner ? (
        <Enter index={4}>
          <Text style={[type.h3, s.sec]}>{t('admin.assignTitle')}</Text>
          <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.assignHelp')}</Text>
          {o.status !== 'ready_to_dispatch' ? <Text style={[type.small, { color: colors.amber, marginBottom: spacing.md }]}>{t('admin.assignEarlyHelp')}</Text> : null}
          {partners.loading && !partners.data ? <Skeleton h={90} r={16} /> : null}
          {!list.length && !partners.loading ? <Card><Text style={[type.body, { color: colors.text, marginBottom: spacing.md }]}>{t('admin.noPartners')}</Text><Button title={t('admin.addFirstPartner')} icon="person-add" onPress={() => nav.navigate('Tabs', { screen: 'Team' })} /></Card> : null}
          {list.map((p) => (
            <Animated.View key={p.id} layout={LinearTransition.springify().damping(18)} entering={FadeInDown.duration(300)}>
              <PartnerRow p={p} pincode={o.address.pincode} busy={busy === `assign-${p.id}`} canAssign={!busy} onAssign={() => assign(p)} />
            </Animated.View>
          ))}
        </Enter>
      ) : null}

      {canCancel && o.status !== 'requested' ? (
        <Enter index={6}>
          <Card style={s.block}>
            <TextField label={t('admin.cancelReason')} value={reason} onChangeText={setReason} />
            <Button title={t('admin.cancelOrder')} variant="danger" disabled={reason.trim().length < 3} loading={busy === 'cancel'}
              onPress={async () => { const ok = await showDialog({ title: t('admin.cancelOrder'), message: t('admin.cancelConfirm'), icon: 'warning', tone: 'danger', confirmLabel: t('admin.cancelOrder'), cancelLabel: t('common.back') }); if (ok) await run('cancel', () => endpoints.admin.cancel(o.id, reason.trim())); }} />
          </Card>
        </Enter>
      ) : null}
      {err ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Animated.Text> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- Team
export function TeamScreen(_p: BottomTabScreenProps<AdminTabParamList, 'Team'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle(true);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.partners(), ['partner:update', 'order:update']);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.addPartner(name.trim(), phone); setName(''); setPhone(''); setOpen(false); tick('success'); await reload(); await notice(t('admin.partnerAdded'), t('admin.partnerAddedMsg'), t('common.ok')); }
    catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };
  const toggleActive = async (p: Partner, v: boolean) => {
    if (!v) {
      const ok = await showDialog({ title: t('admin.deactivateTitle', { name: p.name }), message: t('admin.deactivateMsg'), icon: 'person-remove', tone: 'danger', confirmLabel: t('admin.deactivate'), cancelLabel: t('common.cancel') });
      if (!ok) return;
    }
    try { await endpoints.admin.updatePartner(p.id, { active: v }); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };
  const toggleCall = async (p: Partner, v: boolean) => {
    try { await endpoints.admin.updatePartner(p.id, { canCallCustomer: v }); tick(); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };
  const override = async (p: Partner, state: 'available' | 'off') => {
    try { await endpoints.admin.setPartnerState(p.id, state); tick('success'); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };
  const list = data?.partners ?? [];
  const count = (f: (p: Partner) => boolean) => list.filter((p) => p.active && f(p)).length;
  const summary: { label: string; value: number; tone: 'green' | 'blue' | 'amber' | 'red' }[] = [
    { label: t('admin.ds_on_duty'), value: count((p) => p.dutyStatus === 'on_duty'), tone: 'green' },
    { label: t('admin.ds_on_break'), value: count((p) => p.dutyStatus === 'on_break'), tone: 'amber' },
    { label: t('admin.ds_leave'), value: count((p) => p.dutyStatus === 'leave'), tone: 'blue' },
    { label: t('admin.ds_off_duty'), value: count((p) => p.dutyStatus === 'off_duty'), tone: 'red' },
  ];
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.team')} right={<Tap accessibilityRole="button" accessibilityLabel={t('admin.addPartner')} onPress={() => setOpen((v) => !v)} style={s.addBtn}><Icon name={open ? 'close' : 'person-add'} size={20} color={colors.white} /></Tap>} />
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : (
        <ScrollView contentContainerStyle={[s.pad, content]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          <Enter index={0}>
            <Tap accessibilityRole="button" onPress={() => nav.navigate('Attendance')} scaleTo={0.98}>
              <View style={s.attendance}>
                <View style={s.attHead}><Icon name="calendar" size={20} /><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{t('admin.attendanceToday')}</Text><Text style={[type.smallMedium, { color: colors.primary }]}>{t('admin.viewHistory')}</Text></View>
                <View style={s.attRow}>
                  {summary.map((x) => (
                    <View key={x.label} style={s.attCell}>
                      <CountUp value={x.value} style={[type.h2, { color: x.tone === 'green' ? colors.green : x.tone === 'red' ? colors.red : x.tone === 'amber' ? colors.amber : colors.primary }]} />
                      <Text style={[type.small, { color: colors.secondary, textAlign: 'center' }]} numberOfLines={2}>{x.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Tap>
          </Enter>
          {open ? (
            <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutLeft.duration(200)}>
              <Card style={s.block}>
                <Text style={[type.h3, { color: colors.text, marginBottom: spacing.md }]}>{t('admin.addPartner')}</Text>
                <TextField label={t('signup.name')} value={name} onChangeText={setName} valid={name.trim().length >= 2} autoCapitalize="words" returnKeyType="next" />
                <TextField label={t('address.phone')} value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} valid={/^[6-9]\d{9}$/.test(phone)} keyboardType="number-pad" hint={t('admin.partnerPhoneHint')} />
                {err ? <Text style={[type.small, { color: colors.red, marginBottom: 8 }]}>{err}</Text> : null}
                <Button title={t('admin.addPartner')} icon="person-add" onPress={add} loading={busy} disabled={name.trim().length < 2 || !/^[6-9]\d{9}$/.test(phone)} />
              </Card>
            </Animated.View>
          ) : null}
          {!list.length && !open ? <View style={{ height: 320 }}><Message icon="people-outline" title={t('admin.noPartners')} text={t('admin.noPartnersHelp')} actionLabel={t('admin.addPartner')} onAction={() => setOpen(true)} /></View> : null}
          <ResponsiveGrid>
            {list.map((p, i) => (
              <Enter key={p.id} index={i + 1}>
                <Card style={s.block}>
                  <View style={s.personRow}>
                    <Avatar name={p.name} size={48} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.h3, { color: colors.text }]}>{p.name}</Text>
                      <Text style={[type.small, { color: colors.secondary }]}>+91 {p.phone}</Text>
                      <View style={s.pillRow}>{statePill(t, p)}</View>
                      {p.checkedInAt && p.dutyStatus !== 'off_duty' && p.dutyStatus !== 'leave' ? <Text style={[type.small, { color: colors.secondary, marginTop: 4 }]}>{t('admin.checkedIn', { time: clock(p.checkedInAt) })}</Text> : null}
                    </View>
                    <CallButton phone={p.phone} compact label={t('admin.callPartner')} />
                  </View>
                  <View style={s.stats}>
                    <View style={s.stat}><Text style={[type.h3, { color: colors.text }]}>{p.activeOrders}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('admin.activeLabel')}</Text></View>
                    <View style={s.stat}><Text style={[type.h3, { color: colors.text }]}>{p.deliveredToday}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('admin.deliveredTodayShort')}</Text></View>
                    <View style={s.stat}><Text style={[type.h3, { color: colors.text }]}>{formatMoney(p.codCollectedToday)}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('admin.codToday')}</Text></View>
                  </View>
                  <Tap accessibilityRole="button" onPress={() => nav.navigate('PartnerAreas', { partnerId: p.id, name: p.name })} scaleTo={0.98} style={s.areaRow}>
                    <Icon name="map" size={20} />
                    <Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{p.pincodes.length ? t('admin.areasCount', { count: p.pincodes.length }) : t('admin.areasAll')}</Text>
                    <Text style={[type.smallMedium, { color: colors.primary }]}>{t('common.edit')}</Text>
                  </Tap>
                  <View style={s.activeRow}>
                    <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.canCall')}</Text><Text style={[type.small, { color: colors.secondary }]}>{p.canCallCustomer ? t('admin.canCallOn') : t('admin.canCallOff')}</Text></View>
                    <Toggle accessibilityLabel={t('admin.canCall')} value={p.canCallCustomer} onValueChange={(v) => toggleCall(p, v)} />
                  </View>
                  <View style={s.activeRow}><Text style={[type.small, { color: colors.secondary }]}>{t('admin.active')}</Text><Toggle accessibilityLabel={t('admin.active')} value={p.active} onValueChange={(v) => toggleActive(p, v)} /></View>
                  {p.active && (p.state === 'off' || p.state === 'returning' || p.state === 'available') ? (
                    <ButtonRow style={{ marginTop: spacing.sm }}>
                      {p.state !== 'available' ? <Button small title={t('admin.markAvailable')} variant="outline" onPress={() => override(p, 'available')} style={{ flex: 1 }} /> : null}
                      {p.state !== 'off' ? <Button small title={t('admin.markAbsent')} variant="ghost" onPress={() => override(p, 'off')} style={{ flex: 1 }} /> : null}
                    </ButtonRow>
                  ) : null}
                </Card>
              </Enter>
            ))}
          </ResponsiveGrid>
        </ScrollView>)}
    </SafeAreaView>
  );
}

// Attendance: today's roster and a 7-day strip.
const DAY_COLOR: Record<string, string> = { present: colors.green, leave: colors.amber, paid_leave: colors.primary, absent: colors.red };
export function AttendanceScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.attendance(7), ['partner:update']);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const a = data!;
  const dayLetter = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });
  const tiles = [
    { l: t('admin.ds_on_duty'), v: a.summary.onDuty, c: colors.green }, { l: t('admin.ds_on_break'), v: a.summary.onBreak, c: colors.amber },
    { l: t('admin.ds_off_duty'), v: a.summary.offDuty, c: colors.secondary }, { l: t('admin.ds_leave'), v: a.summary.onLeave, c: colors.primary },
    { l: t('admin.ds_absent'), v: a.summary.absent, c: colors.red },
  ];
  const sub = (p: (typeof a.today)[number]) => {
    if (p.dutyStatus === 'leave') return p.paidLeave ? t('admin.storeClosedPaid') : t('admin.onLeaveToday');
    if (p.present) return t('admin.checkedIn', { time: clock(p.checkedInAt) }) + (p.checkedOutAt ? ` · ${t('admin.checkedOut', { time: clock(p.checkedOutAt) })}` : '') + (p.breakMinutes ? ` · ${t('admin.breakMin', { count: p.breakMinutes })}` : '');
    return t('admin.notCheckedIn');
  };
  return (
    <Screen wide>
      <Enter><View style={s.attRow}>
        {tiles.map((x) => <View key={x.l} style={s.attCell}><CountUp value={x.v} style={[type.h1, { color: x.c }]} /><Text style={[type.small, { color: colors.secondary, textAlign: 'center' }]} numberOfLines={2}>{x.l}</Text></View>)}
      </View></Enter>
      <Enter index={1}><Text style={[type.h3, s.sec]}>{t('admin.attendanceToday')}</Text></Enter>
      <ResponsiveGrid>
        {a.today.map((p, i) => (
          <Enter key={p.id} index={i + 2}>
            <View style={s.pinRow}>
              <Avatar name={p.name} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{p.name}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{sub(p)}</Text>
              </View>
              {p.notIn ? <Pill text={t('admin.ds_absent')} tone="red" /> : dutyPill(t, p.dutyStatus, p.paidLeave)}
            </View>
          </Enter>
        ))}
      </ResponsiveGrid>
      <Enter index={9}><Text style={[type.h3, s.sec]}>{t('admin.last7')}</Text></Enter>
      <Enter index={10}>
        <Card style={s.block}>
          <View style={s.gridHead}><View style={{ flex: 1.4 }} />{a.dates.map((d) => <Text key={d} style={[type.small, s.gridCell, { color: colors.secondary }]}>{dayLetter(d)}</Text>)}</View>
          {a.history.map((h) => (
            <View key={h.id} style={s.gridRow}>
              <Text style={[type.small, { flex: 1.4, color: colors.text }]} numberOfLines={2}>{h.name}</Text>
              {h.days.map((st, i) => {
                const closed = a.closedDays.includes(a.dates[i]);
                const color = st ? DAY_COLOR[st] : undefined;
                return <View key={i} style={s.gridCell}><View style={[s.gridDot, color ? { backgroundColor: color } : null]}>{st === 'present' ? <Icon name="checkmark" size={12} color={colors.white} /> : st === 'absent' ? <Icon name="close" size={12} color={colors.white} /> : st ? <Icon name={closed ? 'storefront' : 'calendar'} size={11} color={colors.white} /> : null}</View></View>;
              })}
            </View>
          ))}
          <View style={s.legend}>
            {[['present', 'admin.ds_on_duty'], ['leave', 'admin.ds_leave'], ['paid_leave', 'admin.ds_paid_leave'], ['absent', 'admin.ds_absent']].map(([k, label]) => (
              <View key={k} style={s.legendItem}><View style={[s.legendDot, { backgroundColor: DAY_COLOR[k] }]} /><Text style={[type.small, { color: colors.secondary }]}>{t(label)}</Text></View>
            ))}
          </View>
        </Card>
      </Enter>
    </Screen>
  );
}

// Terms and conditions shown to customers in the app.
export function TermsScreen({ navigation }: NativeStackScreenProps<AdminStackParamList, 'Terms'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.terms());
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useErrorPopup(err);
  useEffect(() => { if (data && text === null) setText(data.text); }, [data, text]);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const save = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.saveTerms(text ?? ''); tick('success'); await notice(t('admin.termsSaved'), t('admin.termsSavedMsg'), t('common.ok')); navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter><Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.termsHelp')}</Text></Enter>
      <Enter index={1}><TextField label={t('admin.termsLabel')} value={text ?? ''} onChangeText={(v) => setText(v.slice(0, 30000))} multiline placeholder={t('admin.termsPlaceholder')} /></Enter>
      <Text style={[type.small, { color: colors.muted }]}>{(text ?? '').length} / 30000{data?.updatedAt ? `  ·  ${t('admin.termsUpdated', { date: formatDate(data.updatedAt) })}` : ''}</Text>
      {err ? <Text style={[type.small, { color: colors.red, marginTop: 8 }]}>{err}</Text> : null}
    </Screen>
  );
}

// Choose the pincodes a delivery partner can cover (empty = no restriction).
export function PartnerAreasScreen({ navigation, route }: NativeStackScreenProps<AdminStackParamList, 'PartnerAreas'>) {
  const { t } = useTranslation();
  const { partnerId } = route.params;
  const pins = useLoad(() => endpoints.admin.pincodes());
  const partners = useLoad(() => endpoints.admin.partners());
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  useEffect(() => {
    if (selected || !partners.data) return;
    setSelected(new Set(partners.data.partners.find((p) => p.id === partnerId)?.pincodes ?? []));
  }, [partners.data, selected, partnerId]);
  const active = useMemo(() => (pins.data?.pincodes ?? []).filter((p) => p.active), [pins.data]);
  const shown = active.filter((p) => !q.trim() || p.pincode.includes(q.trim()) || (p.area ?? '').toLowerCase().includes(q.trim().toLowerCase()));
  if ((pins.loading || partners.loading) && !selected) return <ListSkeleton />;
  if (pins.error || partners.error) return <ErrorView message={(pins.error ?? partners.error)!} onRetry={() => { void pins.reload(); void partners.reload(); }} retryLabel={t('common.retry')} />;
  const sel = selected ?? new Set<string>();
  const toggle = (p: string) => { tick(); const n = new Set(sel); if (n.has(p)) n.delete(p); else n.add(p); setSelected(n); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.setPartnerPincodes(partnerId, [...sel]); tick('success'); navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('admin.saveAreas')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter><Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.areasHelp', { name: route.params.name })}</Text></Enter>
      <Enter index={1}>
        <View style={[s.search, { marginHorizontal: 0 }]}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} keyboardType="number-pad" placeholder={t('admin.searchPincode')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.searchPincode')} style={[type.body, s.searchInput]} /></View>
        <ButtonRow style={{ marginBottom: spacing.md, marginTop: 0 }}>
          <Button title={t('admin.selectAll')} variant="outline" onPress={() => setSelected(new Set(active.map((p) => p.pincode)))} style={{ flex: 1 }} />
          <Button title={t('admin.clear')} variant="outline" onPress={() => setSelected(new Set())} style={{ flex: 1 }} />
        </ButtonRow>
        <Text style={[type.smallMedium, { color: sel.size ? colors.primary : colors.green, marginBottom: spacing.sm }]}>{sel.size ? t('admin.areasCount', { count: sel.size }) : t('admin.areasAll')}</Text>
      </Enter>
      <View style={s.chipWrap}>
        {shown.map((p) => {
          const on = sel.has(p.pincode);
          return <Tap key={p.pincode} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(p.pincode)} scaleTo={0.92} style={[s.pinChip, on && s.pinChipOn]}><Text style={[type.smallMedium, { color: on ? colors.white : colors.navy }]}>{p.pincode}</Text></Tap>;
        })}
      </View>
      {err ? <Text style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Text> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- Delivery pincodes
export function PincodesScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.pincodes());
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const parsed = useMemo(() => [...new Set(input.split(/[^0-9]+/).filter(Boolean))], [input]);
  const invalid = parsed.filter((p) => !/^\d{6}$/.test(p));
  const list = (data?.pincodes ?? []).filter((p) => !q.trim() || p.pincode.includes(q.trim()));
  const activeCount = data?.pincodes.filter((p) => p.active).length ?? 0;

  const add = async () => {
    if (!parsed.length || invalid.length) { setErr(t('admin.pincodeInvalid')); tick('error'); return; }
    setBusy(true); setErr('');
    try { await endpoints.admin.addPincodes(parsed); setInput(''); tick('success'); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = async (pin: string, active: boolean) => { try { await endpoints.admin.setPincodeActive(pin, active); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } };
  const remove = async (pin: string) => {
    const ok = await showDialog({ title: t('admin.deletePincodeTitle', { pincode: pin }), message: t('admin.deletePincodeMsg'), icon: 'trash', tone: 'danger', confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    try { await endpoints.admin.deletePincode(pin); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  return (
    <Screen>
      <Enter>
        <Card style={s.block}>
          <Text style={[type.h3, { color: colors.text }]}>{t('admin.addPincodes')}</Text>
          <Text style={[type.small, { color: colors.secondary, marginVertical: spacing.sm }]}>{t('admin.pincodesHelp')}</Text>
          <TextField value={input} onChangeText={(v) => { setInput(v); setErr(''); }} keyboardType="numbers-and-punctuation" placeholder="302020, 302021" error={err || (invalid.length ? t('admin.pincodeInvalid') : undefined)} valid={parsed.length > 0 && !invalid.length} onSubmitEditing={add} />
          <Button title={parsed.length > 1 ? t('admin.addN', { count: parsed.length }) : t('admin.addPincode')} icon="add" onPress={add} loading={busy} disabled={!parsed.length || invalid.length > 0} />
        </Card>
      </Enter>
      <Enter index={1}>
        <View style={s.rowBetween}><Text style={[type.h3, { color: colors.text }]}>{t('admin.deliveryArea')}</Text><Text style={[type.smallMedium, { color: colors.green }]}>{t('admin.activeCount', { active: activeCount, total: data!.pincodes.length })}</Text></View>
        <View style={[s.search, { marginHorizontal: 0, marginTop: spacing.sm }]}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} keyboardType="number-pad" placeholder={t('admin.searchPincode')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.searchPincode')} style={[type.body, s.searchInput]} /></View>
      </Enter>
      {list.map((p) => (
        <Animated.View key={p.pincode} layout={LinearTransition.springify().damping(18)} exiting={FadeOutLeft.duration(200)}>
          <View style={s.pinRow}>
            <View style={[s.pinIcon, !p.active && { backgroundColor: colors.border }]}><Icon name="location" size={18} color={p.active ? colors.primary : colors.muted} /></View>
            <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: p.active ? colors.text : colors.muted }]}>{p.pincode}</Text>{p.area ? <Text style={[type.small, { color: colors.secondary }]}>{p.area}</Text> : null}</View>
            <Toggle accessibilityLabel={`${p.pincode} ${t('admin.active')}`} value={p.active} onValueChange={(v) => toggle(p.pincode, v)} />
            <Tap accessibilityRole="button" accessibilityLabel={t('common.delete')} onPress={() => remove(p.pincode)} hitSlop={8} haptic={false} style={{ padding: 6 }}><Icon name="trash-outline" size={20} color={colors.red} /></Tap>
          </View>
        </Animated.View>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------- More / Customers / Reports / Settings
export function MoreScreen(_p: BottomTabScreenProps<AdminTabParamList, 'More'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { user, logout } = useSession();
  let idx = 1;
  const row = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Enter index={idx++}><Tap accessibilityRole="button" onPress={onPress} scaleTo={0.98} style={s.moreRow}>
      <View style={[s.moreIcon, danger && { backgroundColor: colors.redBg }]}><Icon name={icon} size={22} color={danger ? colors.red : colors.navy} /></View>
      <Text style={[type.bodyMedium, { flex: 1, color: danger ? colors.red : colors.text }]}>{label}</Text>
      {!danger ? <Icon name="chevron-forward" size={20} color={colors.muted} /> : null}
    </Tap></Enter>
  );
  const signOut = async () => {
    const ok = await showDialog({ title: t('profile.logout'), message: t('profile.logoutMsg'), icon: 'log-out', confirmLabel: t('profile.logout'), cancelLabel: t('common.cancel') });
    if (ok) await logout();
  };
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.more')} />
      <ScrollView contentContainerStyle={[s.pad, useContentStyle()]} showsVerticalScrollIndicator={false}>
        <Enter index={0}><View style={s.me}><Avatar name={user?.name} size={56} /><View><Text style={[type.h3, { color: colors.text }]}>{user?.name}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {user?.phone}</Text></View></View></Enter>
        {row('notifications-outline', t('admin.notifications'), () => nav.navigate('Notifications'))}
        {row('chatbubbles-outline', t('admin.chats'), () => nav.navigate('AdminChats'))}
        {row('star-outline', t('admin.reviews'), () => nav.navigate('AdminReviews'))}
        {row('bar-chart-outline', t('admin.revenue'), () => nav.navigate('Revenue'))}
        {row('storefront-outline', t('shop.adminTitle'), () => nav.navigate('ShopDetails'))}
        {row('wallet-outline', t('cash.title'), () => nav.navigate('Cash'))}
        {row('download-outline', t('admin.exports'), () => nav.navigate('Exports'))}
        {row('megaphone-outline', t('ann.title'), () => nav.navigate('Announcements'))}
        {row('megaphone-outline', t('admin.broadcast'), () => nav.navigate('Broadcast'))}
        {row('card-outline', t('admin.paymentDetails'), () => nav.navigate('PaymentDetails'))}
        {row('calendar-outline', t('admin.attendance'), () => nav.navigate('Attendance'))}
        {row('document-text-outline', t('admin.terms'), () => nav.navigate('Terms'))}
        {row('location-outline', t('admin.pincodes'), () => nav.navigate('Pincodes'))}
        {row('people-outline', t('admin.customers'), () => nav.navigate('Customers'))}
        {row('person-remove-outline', t('cust.requests'), () => nav.navigate('AccountRequests'))}
        {row('bar-chart-outline', t('admin.reports'), () => nav.navigate('Reports'))}
        {row('settings-outline', t('admin.settings'), () => nav.navigate('StoreSettings'))}
        {row('chatbox-ellipses-outline', t('sms.title'), () => nav.navigate('SmsSettings'))}
        <NotificationsRow />
        {row('language-outline', t('profile.language'), () => nav.navigate('Language'))}
        {row('log-out-outline', t('profile.logout'), signOut, true)}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ReportsScreen() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.reports(days));
  useEffect(() => { void reload(); }, [days, reload]);
  return (
    <Screen>
      <View style={s.filtersRow}>{[7, 30, 90].map((d) => <Tap key={d} accessibilityRole="button" onPress={() => setDays(d)} scaleTo={0.93} style={[s.chip, days === d && s.chipOn]}><Text style={[type.smallMedium, { color: days === d ? colors.white : colors.navy }]}>{t('admin.lastDays', { count: d })}</Text></Tap>)}</View>
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : <>
        <Enter index={0}><Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{t('admin.paymentSplit')}</Text>
          {data!.paymentSplit.length ? data!.paymentSplit.map((p) => <View key={p.method ?? 'x'} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{p.method ? t(`pay.${p.method}`) : '—'}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{p.orders} · {formatMoney(p.sales)}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        </Card></Enter>
        <Enter index={1}><Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{t('admin.perPartner')}</Text>
          {data!.perPartner.length ? data!.perPartner.map((p) => <View key={p.name} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{p.name}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{p.orders}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        </Card></Enter>
        <Enter index={2}><Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{t('admin.dailySales')}</Text>
          {data!.daily.length ? data!.daily.map((d) => <View key={d.day} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{formatDate(d.day)}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{d.orders} · {formatMoney(d.sales)}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        </Card></Enter>
      </>}
    </Screen>
  );
}

export function StoreSettingsScreen({ navigation }: NativeStackScreenProps<AdminStackParamList, 'StoreSettings'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.settings());
  const [f, setF] = useState<{ isOpen: boolean; openingTime: string; closingTime: string; address: string; phone: string; email: string; latitude: string; longitude: string; geofenceM: string; orderCutoffTime: string; customerAcceptRequired: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useErrorPopup(err); const [gps, setGps] = useState(false);
  useEffect(() => { if (data && !f) setF({ isOpen: data.isOpen, openingTime: data.openingTime, closingTime: data.closingTime, address: data.address ?? '', phone: data.phone ?? '', email: data.email ?? '', latitude: data.latitude != null ? String(data.latitude) : '', longitude: data.longitude != null ? String(data.longitude) : '', geofenceM: String(data.geofenceM ?? 150), orderCutoffTime: data.orderCutoffTime ?? '18:00', customerAcceptRequired: data.customerAcceptRequired !== false }); }, [data, f]);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!f) return <ListSkeleton />;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const lat = f.latitude.trim() === '' ? null : Number(f.latitude), lng = f.longitude.trim() === '' ? null : Number(f.longitude);
  const locationOk = (lat === null && lng === null) || (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  const useHere = async () => {
    setGps(true); setErr('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setErr(t('admin.gpsDenied')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setF({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) });
      tick('success');
    } catch { setErr(t('address.gpsFailed')); } finally { setGps(false); }
  };
  const save = async () => {
    if (!locationOk) { setErr(t('admin.locationInvalid')); tick('error'); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.orderCutoffTime)) { setErr(t('admin.cutoffInvalid')); tick('error'); return; }
    if (data?.isOpen && !f.isOpen) {
      const ok = await showDialog({ title: t('admin.closeStoreTitle'), message: t('admin.closeStoreMsg'), icon: 'storefront', tone: 'danger', confirmLabel: t('admin.closeStore'), cancelLabel: t('common.cancel') });
      if (!ok) return;
    }
    setBusy(true); setErr('');
    try {
      await endpoints.admin.saveSettings({ isOpen: f.isOpen, openingTime: f.openingTime, closingTime: f.closingTime, latitude: lat, longitude: lng, geofenceM: Number(f.geofenceM) || 150, orderCutoffTime: f.orderCutoffTime, customerAcceptRequired: f.customerAcceptRequired });
      tick('success'); navigation.goBack();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter><Card style={[s.block, s.personRow]}><View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.storeOpen')}</Text><Text style={[type.small, { color: f.isOpen ? colors.green : colors.red }]}>{f.isOpen ? t('admin.storeOpenOn') : t('admin.storeOpenOff')}</Text></View><Toggle accessibilityLabel={t('admin.storeOpen')} value={f.isOpen} onValueChange={(v) => setF({ ...f, isOpen: v })} /></Card></Enter>
      <Enter index={1}><TextField label={t('admin.opening')} value={f.openingTime} onChangeText={set('openingTime')} placeholder="09:00" /></Enter>
      <Enter index={2}><TextField label={t('admin.closing')} value={f.closingTime} onChangeText={set('closingTime')} placeholder="21:00" /></Enter>
      <Enter index={2}><TextField label={t('admin.cutoff')} value={f.orderCutoffTime} onChangeText={set('orderCutoffTime')} placeholder="18:00" hint={t('admin.cutoffHint')} /></Enter>
      <Enter index={2}><Card style={[s.block, s.personRow]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.acceptPage')}</Text>
          <Text style={[type.small, { color: colors.secondary }]}>{f.customerAcceptRequired ? t('admin.acceptPageOn') : t('admin.acceptPageOff')}</Text>
        </View>
        <Toggle accessibilityLabel={t('admin.acceptPage')} value={f.customerAcceptRequired} onValueChange={(v) => setF({ ...f, customerAcceptRequired: v })} />
      </Card></Enter>
      <Enter index={3}><Button title={t('shop.editDetails')} icon="storefront" variant="outline" onPress={() => navigation.navigate('ShopDetails')} style={{ marginBottom: spacing.md }} /></Enter>
      <Enter index={6}>
        <Card style={s.block}>
          <View style={s.personRow}><Icon name="storefront" size={22} /><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('admin.shopLocation')}</Text></View>
          <Text style={[type.small, { color: colors.secondary, marginVertical: spacing.sm }]}>{t('admin.shopLocationHelp')}</Text>
          <Button title={gps ? t('address.gpsBusy') : t('admin.useHere')} variant="outline" icon="locate" onPress={useHere} loading={gps} style={{ marginBottom: spacing.md }} />
          <ButtonRow>
            <View style={{ flex: 1 }}><TextField label={t('admin.latitude')} value={f.latitude} onChangeText={set('latitude')} keyboardType="numbers-and-punctuation" valid={lat !== null && locationOk} /></View>
            <View style={{ flex: 1 }}><TextField label={t('admin.longitude')} value={f.longitude} onChangeText={set('longitude')} keyboardType="numbers-and-punctuation" valid={lng !== null && locationOk} /></View>
          </ButtonRow>
          <TextField label={t('admin.geofence')} value={f.geofenceM} onChangeText={(v) => set('geofenceM')(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" hint={t('admin.geofenceHint')} />
        </Card>
      </Enter>
      {err ? <Text style={[type.small, { color: colors.red }]}>{err}</Text> : null}
    </Screen>
  );
}

/** UPI ID, QR and bank details the delivery partner shows on cash-on-delivery orders. */
export function PaymentDetailsScreen({ navigation }: NativeStackScreenProps<AdminStackParamList, 'PaymentDetails'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.paymentDetails());
  const [f, setF] = useState<{ upiId: string; upiName: string; bankName: string; bankAccountName: string; bankAccountNumber: string; bankIfsc: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useErrorPopup(err);
  useEffect(() => { if (data && !f) setF({ upiId: data.upiId ?? '', upiName: data.upiName ?? '', bankName: data.bankName ?? '', bankAccountName: data.bankAccountName ?? '', bankAccountNumber: data.bankAccountNumber ?? '', bankIfsc: data.bankIfsc ?? '' }); }, [data, f]);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!f) return <ListSkeleton />;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const upiOk = /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(f.upiId.trim());
  const ifscOk = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.bankIfsc.trim());
  const accOk = /^\d{6,20}$/.test(f.bankAccountNumber.trim());
  const uri = upiOk ? `upi://pay?pa=${encodeURIComponent(f.upiId.trim())}&pn=${encodeURIComponent(f.upiName.trim() || 'Kamal Medical Hall')}&cu=INR` : null;
  const save = async () => {
    if ((f.upiId && !upiOk) || (f.bankIfsc && !ifscOk) || (f.bankAccountNumber && !accOk)) { setErr(t('admin.paymentInvalid')); tick('error'); return; }
    setBusy(true); setErr('');
    try {
      await endpoints.admin.savePaymentDetails({ upiId: f.upiId.trim() || null, upiName: f.upiName.trim() || null, bankName: f.bankName.trim() || null, bankAccountName: f.bankAccountName.trim() || null, bankAccountNumber: f.bankAccountNumber.trim() || null, bankIfsc: f.bankIfsc.trim().toUpperCase() || null });
      tick('success'); await notice(t('admin.paymentSaved'), t('admin.paymentSavedMsg'), t('common.ok')); navigation.goBack();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter><Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.paymentHelp')}</Text></Enter>
      <Enter index={1}>
        <Card style={s.block}>
          <View style={s.personRow}><Icon name="qr-code" size={22} /><Text style={[type.h3, { color: colors.text }]}>UPI</Text></View>
          <TextField label={t('pay.upiId')} value={f.upiId} onChangeText={set('upiId')} autoCapitalize="none" placeholder="shop@upi" valid={upiOk} error={f.upiId && !upiOk ? t('admin.upiInvalid') : undefined} />
          <TextField label={t('pay.payeeName')} value={f.upiName} onChangeText={set('upiName')} autoCapitalize="words" />
          {uri ? <View style={s.qrPreview}><QRCode value={uri} size={150} color={colors.navy} backgroundColor={colors.white} /><Text style={[type.small, { color: colors.secondary, marginTop: 8, textAlign: 'center' }]}>{t('admin.qrPreview')}</Text></View> : null}
        </Card>
      </Enter>
      <Enter index={2}>
        <Card style={s.block}>
          <View style={s.personRow}><Icon name="business" size={22} /><Text style={[type.h3, { color: colors.text }]}>{t('pay.bankTransfer')}</Text></View>
          <TextField label={t('pay.bankName')} value={f.bankName} onChangeText={set('bankName')} autoCapitalize="words" />
          <TextField label={t('pay.accountName')} value={f.bankAccountName} onChangeText={set('bankAccountName')} autoCapitalize="words" />
          <TextField label={t('pay.accountNumber')} value={f.bankAccountNumber} onChangeText={(v) => set('bankAccountNumber')(v.replace(/\D/g, '').slice(0, 20))} keyboardType="number-pad" valid={accOk} />
          <TextField label={t('pay.ifsc')} value={f.bankIfsc} onChangeText={(v) => set('bankIfsc')(v.toUpperCase().slice(0, 11))} autoCapitalize="characters" valid={ifscOk} error={f.bankIfsc && !ifscOk ? t('admin.ifscInvalid') : undefined} />
        </Card>
      </Enter>
      {err ? <Text style={[type.small, { color: colors.red }]}>{err}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  headRight: { position: 'absolute', right: spacing.lg },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  tileCard: { gap: 4, marginBottom: 12, backgroundColor: colors.white, boxShadow: '0px 6px 16px rgba(15,33,71,0.08)' },
  tileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  teamCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.md, backgroundColor: colors.white },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  block: { marginBottom: spacing.md, backgroundColor: colors.white, boxShadow: '0px 4px 14px rgba(15,33,71,0.07)' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: spacing.md },
  pillRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  rxRow: { flexDirection: 'row', gap: 10, marginTop: spacing.sm },
  rx: { width: 72, height: 90, borderRadius: radius.sm, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  partnerRow: { gap: 10, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, backgroundColor: colors.white },
  partnerReady: { borderColor: colors.green, backgroundColor: '#F5FCF7' },
  assignBtn: { minWidth: 92 },
  partnerActions: { gap: 8, alignItems: 'flex-end' },
  annRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  reasonText: { width: '100%', color: colors.secondary },
  stats: { flexDirection: 'row', gap: 12, marginTop: spacing.md },
  stat: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, color: colors.text, outlineStyle: 'none' } as object,
  filters: { gap: 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row' },
  filtersRow: { gap: 8, paddingBottom: spacing.md, flexDirection: 'row' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pinChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  pinChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pinIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  me: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: spacing.md, marginBottom: spacing.sm },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  manageCard: { alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 92, padding: spacing.md, marginBottom: 12, backgroundColor: colors.white },
  storeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.md },
  billOptions: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  billPick: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.card },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  attendance: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, marginBottom: spacing.md },
  attHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  attRow: { flexDirection: 'row', gap: 8 },
  attCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.white },
  gridHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6 },
  gridRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  gridCell: { flex: 1, textAlign: 'center', alignItems: 'center' },
  gridDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  gridDotOn: { backgroundColor: colors.green },
  qrPreview: { alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint, marginTop: spacing.sm },
  moreIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
