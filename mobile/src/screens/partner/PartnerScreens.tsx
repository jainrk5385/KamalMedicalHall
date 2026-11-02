import { useErrorPopup } from '../../hooks';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { uploadPrescription } from '../../api/upload';
import type { DutyStatus, Order, OrderSummary, PartnerState } from '../../api/types';
import { Avatar, CallButton } from '../../components/CallButton';
import { OrderCard } from '../../components/OrderCard';
import { PaymentSheet, type PaymentInfo } from '../../components/PaymentSheet';
import { SourceOptions } from '../../components/SourceOptions';
import { NotificationsRow } from '../../components/NotificationsRow';
import { CountUp, Enter, Skeleton, Tap, tick } from '../../components/motion';
import { ButtonRow, Button, Card, ErrorView, Icon, Message, Pill, Screen, type IconName } from '../../components/ui';
import { extractTransactionId } from '../../core/txnId';
import { notice, showDialog } from '../../dialog';
import { useLoad } from '../../hooks';
import { useContentStyle } from '../../layout';
import type { PartnerStackParamList, PartnerTabParamList } from '../../navigation/types';
import { distanceMeters, formatDistance, usePartnerLocation } from '../../partnerLocation';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone , formatDelivery } from '../../utils';

type Nav = NativeStackNavigationProp<PartnerStackParamList>;
const LIVE = ['partner:update', 'order:update', 'notification'];

const STATE_UI: Record<PartnerState, { icon: IconName; fg: string; bg: [string, string]; title: string; help: string }> = {
  off: { icon: 'moon', fg: colors.secondary, bg: [colors.white, colors.card], title: 'partner.stOff', help: 'partner.stOffHelp' },
  available: { icon: 'checkmark-circle', fg: colors.green, bg: [colors.white, colors.greenBg], title: 'partner.stAvailable', help: 'partner.stAvailableHelp' },
  reserved: { icon: 'notifications', fg: colors.amber, bg: [colors.white, colors.amberBg], title: 'partner.stReserved', help: 'partner.stReservedHelp' },
  busy: { icon: 'bicycle', fg: colors.primary, bg: [colors.white, colors.card], title: 'partner.stBusy', help: 'partner.stBusyHelp' },
  returning: { icon: 'storefront', fg: colors.primary, bg: [colors.white, colors.card], title: 'partner.stReturning', help: 'partner.stReturningHelp' },
  break: { icon: 'cafe', fg: colors.amber, bg: [colors.white, colors.amberBg], title: 'partner.stBreak', help: 'partner.stBreakHelp' },
};
const LEAVE_UI = { icon: 'calendar' as IconName, fg: colors.amber, bg: [colors.white, colors.amberBg] as [string, string], title: 'partner.stLeave', help: 'partner.stLeaveHelp' };
const PAID_LEAVE_UI = { ...LEAVE_UI, icon: 'storefront' as IconName, title: 'partner.stPaidLeave', help: 'partner.stPaidLeaveHelp' };

const DUTY_OPTIONS: { key: DutyStatus; icon: IconName; label: string }[] = [
  { key: 'on_duty', icon: 'checkmark-circle', label: 'partner.optOnDuty' },
  { key: 'on_break', icon: 'cafe', label: 'partner.optOnBreak' },
  { key: 'off_duty', icon: 'moon', label: 'partner.optOffDuty' },
  { key: 'leave', icon: 'calendar', label: 'partner.optLeave' },
];

const ListSkeleton = () => <View style={{ padding: spacing.lg, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={110} r={16} />)}</View>;

// ---------------------------------------------------------------- Home
export function PartnerHomeScreen(_p: BottomTabScreenProps<PartnerTabParamList, 'Home'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle();
  const { user, logout } = useSession();
  const me = useLoad(() => endpoints.partner.me(), LIVE);
  const jobs = useLoad(() => endpoints.partner.orders('active'), LIVE);
  const delivered = useLoad(() => endpoints.partner.orders('delivered'), ['order:update']);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const state = me.data?.state ?? 'off';
  const { coords, denied } = usePartnerLocation(state === 'busy' || state === 'returning', () => { void me.reload(); });

  if (me.loading && !me.data) return <ListSkeleton />;
  if (me.error && !me.data) return <ErrorView message={me.error} onRetry={me.reload} retryLabel={t('common.retry')} />;
  const dutyStatus = me.data!.dutyStatus;
  const paidLeave = me.data!.paidLeave;
  const ui = paidLeave ? PAID_LEAVE_UI : dutyStatus === 'leave' ? LEAVE_UI : STATE_UI[state];
  const all = jobs.data?.orders ?? [];
  const pending = all.filter((o) => !o.partnerAccepted && o.status === 'ready_to_dispatch');
  const active = all.filter((o) => !pending.includes(o));
  const cash = active.filter((o) => o.paymentMethod === 'cod').reduce((sum, o) => sum + (o.quotedAmount ?? 0), 0);
  const toShop = me.data!.store && coords ? distanceMeters(coords, me.data!.store) : null;
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([me.reload(), jobs.reload(), delivered.reload()]); }
    finally { setRefreshing(false); }
  };

  const choose = async (status: DutyStatus) => {
    setErr('');
    if (status === 'leave') {
      const ok = await showDialog({ title: t('partner.leaveTitle'), message: t('partner.leaveMsg'), icon: 'calendar', confirmLabel: t('partner.optLeave'), cancelLabel: t('common.cancel') });
      if (!ok) return;
    }
    try { await endpoints.partner.setStatus(status); tick('success'); await me.reload(); } catch (e) { setErr((e as Error).message); tick('error'); await me.reload(); }
  };
  const accept = async (o: OrderSummary) => {
    setBusy(o.id);
    try { await endpoints.partner.accept(o.id); tick('success'); await Promise.all([jobs.reload(), me.reload()]); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } finally { setBusy(null); }
  };
  const reject = async (o: OrderSummary) => {
    const ok = await showDialog({ title: t('partner.rejectTitle'), message: t('partner.rejectMsg', { order: o.orderNumber }), icon: 'close-circle', tone: 'danger', confirmLabel: t('partner.reject'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    setBusy(o.id);
    try { await endpoints.partner.reject(o.id, 'Rejected by partner'); await Promise.all([jobs.reload(), me.reload(), delivered.reload()]); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } finally { setBusy(null); }
  };
  const signOut = async () => {
    const ok = await showDialog({ title: t('profile.logout'), message: t('profile.logoutMsg'), icon: 'log-out', confirmLabel: t('profile.logout'), cancelLabel: t('common.cancel') });
    if (ok) await logout();
  };
  const imBack = async () => {
    try { await endpoints.partner.arrived(); await me.reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };

  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <ScrollView contentContainerStyle={[s.pad, content]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
        <Enter index={0}>
          <View style={s.greet}>
            <Avatar name={user?.name} size={48} />
            <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{t('partner.title')}</Text><Text style={[type.h2, { color: colors.text }]}>{t('home.greetingName', { name: (user?.name ?? '').split(' ')[0] })}</Text></View>
          </View>
        </Enter>

        <Enter index={1}>
          <LinearGradient colors={ui.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.status}>
            <View style={[s.statusIcon, { backgroundColor: ui.fg }]}><Icon name={ui.icon} size={26} color={colors.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, { color: colors.text }]}>{t(ui.title)}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{t(ui.help)}</Text>
            </View>
          </LinearGradient>
          {me.error ? <ErrorView message={me.error} onRetry={me.reload} retryLabel={t('common.retry')} /> : null}
          {me.data!.storeOpen === false ? <View style={s.closedBanner}><Icon name="storefront" size={18} color={colors.amber} /><Text style={[type.small, { color: colors.text, flex: 1 }]}>{t('partner.storeClosedBanner')}</Text></View> : null}
          <View style={s.dutyCard}>
            <View style={s.dutyHead}>
              <Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{t('partner.attendanceToday')}</Text>
              <Tap accessibilityRole="button" onPress={() => nav.navigate('MyAttendance')} haptic={false}><Text style={[type.smallMedium, { color: colors.primary }]}>{t('partner.myAttendance')}</Text></Tap>
            </View>
            <View style={s.optRow}>
              {DUTY_OPTIONS.map((o) => {
                const on = !paidLeave && dutyStatus === o.key;
                const locked = paidLeave || state === 'reserved' || state === 'busy';
                return (
                  <Tap key={o.key} accessibilityRole="button" accessibilityState={{ selected: on, disabled: locked }} onPress={() => { if (!on && !locked) void choose(o.key); }} scaleTo={0.95} style={[s.opt, on && s.optOn, locked && !on && { opacity: 0.45 }]}>
                    <Icon name={o.icon} size={18} color={on ? colors.white : colors.navy} />
                    <Text style={[type.smallMedium, { color: on ? colors.white : colors.navy }]} numberOfLines={2}>{t(o.label)}</Text>
                  </Tap>
                );
              })}
            </View>
            <Text style={[type.small, { color: colors.secondary, marginTop: 8 }]}>{state === 'reserved' || state === 'busy' ? t('partner.dutyLocked') : t('partner.absentNote')}</Text>
          </View>
          {err ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: 6 }]}>{err}</Animated.Text> : null}
        </Enter>

        {state === 'returning' ? (
          <Enter index={2}>
            <Card style={s.returning}>
              <Icon name="navigate" size={22} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{toShop != null ? t('partner.toShop', { distance: formatDistance(toShop) }) : t('partner.headBack')}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{denied ? t('partner.locationDenied') : me.data!.store ? t('partner.autoAvailable') : t('partner.noShopLocation')}</Text>
              </View>
              {!me.data!.store ? <Button small title={t('partner.imBack')} onPress={imBack} /> : null}
            </Card>
          </Enter>
        ) : null}

        <Enter index={3}>
          <View style={s.stats}>
            <View style={s.stat}><CountUp value={all.length} style={[type.h2, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.assigned')}</Text></View>
            <View style={s.stat}><CountUp value={delivered.data?.orders.length ?? 0} style={[type.h2, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.delivered')}</Text></View>
            <View style={s.stat}><CountUp value={cash} prefix="₹" style={[type.h2, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.cashToCollect')}</Text></View>
          </View>
        </Enter>
        {delivered.error ? <ErrorView message={delivered.error} onRetry={delivered.reload} retryLabel={t('common.retry')} /> : null}

        {pending.length > 0 ? <>
          <Enter index={4}><Text style={[type.h3, s.sec]}>{t('partner.newRequests')}</Text></Enter>
          {pending.map((o, i) => (
            <Enter key={o.id} index={5 + i}>
              <Card style={s.request}>
                <Tap accessibilityRole="button" onPress={() => nav.navigate('Job', { orderId: o.id })} scaleTo={0.98}>
                  <View style={s.reqHead}><Text style={[type.h3, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t('partner.respondNow')} tone="amber" /></View>
                  <Text style={[type.small, { color: colors.secondary }]}>{o.deliveryDate ? formatDelivery(o.deliveryDate, o.deliverySlot) : ''}</Text>
                  <Text style={[type.small, { color: colors.secondary }]}>{o.pincode ? `${t('address.pincode')} ${o.pincode}` : ''}{o.quotedAmount != null && o.paymentMethod === 'cod' ? ` · ${t('pay.cod')} ${formatMoney(o.quotedAmount)}` : ''}</Text>
                </Tap>
                <View style={s.reqBtns}>
                  <Button title={t('partner.reject')} variant="outline" onPress={() => reject(o)} disabled={busy === o.id} style={{ flex: 1 }} />
                  <Button title={t('partner.accept')} icon="checkmark" onPress={() => accept(o)} loading={busy === o.id} style={{ flex: 1 }} />
                </View>
              </Card>
            </Enter>
          ))}
        </> : null}

        <Enter index={6}><Text style={[type.h3, s.sec]}>{t('partner.activeDeliveries')}</Text></Enter>
        {jobs.error ? <ErrorView message={jobs.error} onRetry={jobs.reload} retryLabel={t('common.retry')} /> : null}
        {jobs.data && !jobs.error && !active.length ? <Enter index={7}><Card style={s.empty}><Icon name="cube-outline" size={30} color={colors.muted} /><Text style={[type.body, { color: colors.secondary, flex: 1 }]}>{t('partner.noJobs')}</Text></Card></Enter> : null}
        {active.map((o, i) => <OrderCard key={o.id} order={o} index={i + 7} onPress={() => nav.navigate('Job', { orderId: o.id })} subtitle={`${o.customerName ?? ''}${o.deliverySlot ? ` · ${o.deliverySlot}` : ''}`} />)}

        <Enter index={12}>
          <NotificationsRow />
          <Tap accessibilityRole="button" onPress={() => nav.navigate('Language')} scaleTo={0.98} style={s.menuRow}><View style={s.menuIcon}><Icon name="language-outline" size={22} color={colors.navy} /></View><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{t('profile.language')}</Text><Icon name="chevron-forward" size={20} color={colors.muted} /></Tap>
          <Tap accessibilityRole="button" onPress={signOut} scaleTo={0.98} style={s.menuRow}><View style={[s.menuIcon, { backgroundColor: colors.redBg }]}><Icon name="log-out-outline" size={22} color={colors.red} /></View><Text style={[type.bodyMedium, { color: colors.red, flex: 1 }]}>{t('profile.logout')}</Text></Tap>
        </Enter>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- Orders (delivered / rejected)
export function PartnerOrdersScreen(_p: BottomTabScreenProps<PartnerTabParamList, 'Orders'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle();
  const [tab, setTab] = useState<'delivered' | 'rejected'>('delivered');
  const { data: loadedData, error, loading, reload } = useLoad(async () => ({ ...(await endpoints.partner.orders(tab)), requestTab: tab }), ['order:update']);
  const data = loadedData?.requestTab === tab ? loadedData : null;
  useEffect(() => { void reload(); }, [tab, reload]);
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Text style={[type.h2, s.heading]}>{t('tabs.orders')}</Text>
      <View style={[s.segWrap, content]}>
        {(['delivered', 'rejected'] as const).map((k) => (
          <Tap key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} scaleTo={0.97} style={[s.seg, tab === k && s.segOn]}>
            <Icon name={k === 'delivered' ? 'checkmark-done' : 'close-circle'} size={18} color={tab === k ? colors.white : colors.navy} />
            <Text style={[type.smallMedium, { color: tab === k ? colors.white : colors.navy }]}>{t(`partner.tab_${k}`)}</Text>
          </Tap>
        ))}
      </View>
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : error && !data?.orders.length ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.orders.length ? (
        <Message icon={tab === 'delivered' ? 'checkmark-done-circle-outline' : 'close-circle-outline'} title={t(`partner.empty_${tab}`)} text={t(`partner.emptyHelp_${tab}`)} />
      ) : (
        <ScrollView contentContainerStyle={[s.pad, content]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          {error ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : null}
          {data.orders.map((o, i) => tab === 'delivered'
            ? <OrderCard key={o.id} order={o} index={i} onPress={() => nav.navigate('Job', { orderId: o.id })} subtitle={`${o.customerName ?? ''}${o.paymentMethod === 'cod' && o.quotedAmount != null ? ` · ${t('pay.cod')} ${formatMoney(o.quotedAmount)}` : ''}`} />
            : (
              <Enter key={`${o.id}-${o.respondedAt}`} index={i}>
                <Card style={s.rejected}>
                  <View style={s.reqHead}><Text style={[type.h3, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t('partner.rejectedPill')} tone="red" /></View>
                  <Text style={[type.small, { color: colors.secondary }]}>{o.customerName ? `${o.customerName} · ` : ''}{o.respondedAt ? formatDateTime(o.respondedAt) : ''}</Text>
                  {o.rejectedReason ? <Text style={[type.small, { color: colors.red, marginTop: 4 }]}>{o.rejectedReason}</Text> : null}
                </Card>
              </Enter>
            ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- Delivery
const HOW: { key: 'cash' | 'upi' | 'bank'; icon: IconName; label: string }[] = [
  { key: 'cash', icon: 'cash', label: 'partner.viaCash' },
  { key: 'upi', icon: 'qr-code', label: 'partner.viaUpi' },
  { key: 'bank', icon: 'business', label: 'partner.viaBank' },
];

export function JobScreen({ navigation, route }: NativeStackScreenProps<PartnerStackParamList, 'Job'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.order(route.params.orderId), ['order:update']);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const [via, setVia] = useState<'cash' | 'upi' | 'bank' | null>(null);
  const [ref, setRef] = useState('');
  const [received, setReceived] = useState(false);
  const [sheet, setSheet] = useState<PaymentInfo | null>(null);
  const [proof, setProof] = useState<{ uri: string; name: string; mimeType: string; sizeBytes?: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<'' | 'read' | 'missing'>('');
  if (loading && !data) return <ListSkeleton />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o: Order = data!.order;
  const cod = o.paymentMethod === 'cod';
  const a = o.address;
  const query = encodeURIComponent([a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', '));
  const mapUrl = a.latitude != null && a.longitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
  const assigned = ['quoted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status); // given to this partner, not out yet
  const pendingRequest = assigned && !o.partnerAccepted;
  const waitingCustomer = assigned && o.status !== 'ready_to_dispatch' && o.partnerAccepted; // accepted, the customer has yet to confirm
  const readyToRide = o.status === 'ready_to_dispatch' && o.partnerAccepted;
  const riding = o.status === 'out_for_delivery';

  const run = async (key: string, fn: () => Promise<{ order: Order } | { ok: boolean }>, after?: () => void) => {
    setBusy(key); setErr('');
    try { const r = await fn(); if ('order' in r) setData({ order: r.order }); tick('success'); after?.(); } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };
  const showPayment = async () => {
    try { setSheet(await endpoints.partner.paymentDetails(o.id)); } catch (e) { setErr((e as Error).message); }
  };
  /** Screenshot of the customer's payment: the transaction id is read from it on the phone, and the partner can correct it. */
  const pickProof = async (source: 'camera' | 'gallery') => {
    setErr(''); setReadNote('');
    try {
      if (source === 'camera') { const perm = await ImagePicker.requestCameraPermissionsAsync(); if (!perm.granted) { setErr(t('upload.permission')); return; } }
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setProof({ uri: a.uri, name: a.fileName ?? `payment-${o.orderNumber}.jpg`, mimeType: a.mimeType ?? 'image/jpeg', sizeBytes: a.fileSize });
      setRef(''); // A transaction ID from the previous screenshot must never be submitted with this one.
      setReading(true);
      try {
        const TextRecognition = (require('@react-native-ml-kit/text-recognition') as { default: { recognize(uri: string): Promise<{ text: string }> } }).default;
        const found = extractTransactionId((await TextRecognition.recognize(a.uri)).text);
        if (found) { setRef(found); setReadNote('read'); } else setReadNote('missing');
      } catch { setReadNote('missing'); } finally { setReading(false); }
    } catch { setErr(t('admin.billPickFailed')); }
  };
  const deliver = async () => {
    const ok = await showDialog({ title: t('partner.deliverTitle'), message: cod ? t('partner.deliverMsgCod', { amount: formatMoney(o.quotedAmount ?? 0), via: t(HOW.find((h) => h.key === via)?.label ?? 'partner.viaCash') }) : t('partner.deliverMsg'), icon: 'checkmark-done-circle', confirmLabel: t('partner.markDelivered'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    await run('deliver', async () => {
      if (!cod) return endpoints.partner.delivered(o.id, {});
      if (via === 'cash') return endpoints.partner.delivered(o.id, { collectedVia: 'cash' });
      const sig = await endpoints.signUpload('proof');
      const up = await uploadPrescription({ id: 'proof', ...proof! }, sig);
      return endpoints.partner.delivered(o.id, { collectedVia: via!, reference: ref.trim(), proof: { publicId: up.publicId, mimeType: up.mimeType, resourceType: up.resourceType, sizeBytes: up.sizeBytes } });
    }, () => navigation.goBack());
  };
  const reject = async () => {
    const ok = await showDialog({ title: t('partner.rejectTitle'), message: t('partner.rejectMsg', { order: o.orderNumber }), icon: 'close-circle', tone: 'danger', confirmLabel: t('partner.reject'), cancelLabel: t('common.cancel') });
    if (ok) await run('reject', () => endpoints.partner.reject(o.id, 'Rejected by partner'), () => navigation.goBack());
  };

  const proofOk = via === 'cash' || (!!proof && ref.trim().length >= 6);
  const canDeliver = riding && (!cod || (via !== null && received && proofOk));
  const footer = pendingRequest ? (
    <ButtonRow>
      <Button title={t('partner.reject')} variant="outline" onPress={reject} disabled={!!busy} style={{ flex: 1 }} />
      <Button title={t('partner.accept')} icon="checkmark" onPress={() => run('accept', () => endpoints.partner.accept(o.id))} loading={busy === 'accept'} style={{ flex: 1 }} />
    </ButtonRow>
  ) : waitingCustomer ? (
    <View style={{ gap: 8 }}>
      <View style={s.waitBox}><Icon name="hourglass-outline" size={20} color={colors.amber} /><Text style={[type.small, { color: colors.text, flex: 1 }]}>{t('partner.waitingCustomerHelp')}</Text></View>
      <Button title={t('partner.reject')} variant="ghost" onPress={reject} disabled={!!busy} />
    </View>
  ) : readyToRide ? (
    <View style={{ gap: 8 }}>
      <Button title={t('partner.startRide')} icon="bicycle" onPress={() => run('ride', () => endpoints.partner.outForDelivery(o.id))} loading={busy === 'ride'} />
      <Button title={t('partner.reject')} variant="ghost" onPress={reject} disabled={!!busy} />
    </View>
  ) : riding ? (
    <Button title={t('partner.markDelivered')} icon="checkmark-done" onPress={deliver} loading={busy === 'deliver'} disabled={!canDeliver} />
  ) : undefined;

  return (
    <>
      <Screen footer={footer}>
        <Enter index={0}>
          <View style={s.reqHead}><Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={pendingRequest ? t('partner.respondNow') : t(`status.${o.status}`)} tone={pendingRequest ? 'amber' : statusTone(o.status)} /></View>
          <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{formatDelivery(o.deliveryDate, o.deliverySlot)}</Text>
        </Enter>

        {pendingRequest ? <Enter index={1}><Card style={[s.block, { backgroundColor: colors.amberBg, borderColor: colors.amberBg }]}><Text style={[type.bodyMedium, { color: colors.amber }]}>{t('partner.newRequestBanner')}</Text><Text style={[type.small, { color: colors.text }]}>{t('partner.newRequestHelp')}</Text></Card></Enter> : null}

        <Enter index={2}>
          <Card style={s.block}>
            <View style={s.person}>
              <Avatar name={o.customer?.name} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={[type.h3, { color: colors.text }]}>{o.customer?.name ?? '—'}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{o.customer?.phone ? `+91 ${o.customer.phone}` : o.canCallCustomer ? t('partner.phoneAfterAccept') : t('partner.callDisabled')}</Text>
              </View>
            </View>
            <Text style={[type.body, { color: colors.text, marginTop: spacing.md }]}>{[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}, {a.city} - {a.pincode}</Text>
            <ButtonRow>
              <Button title={t('partner.map')} icon="navigate" variant="outline" onPress={() => Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${query}` : mapUrl)} style={{ flex: 1 }} />
              {o.canCallCustomer && o.customer?.phone ? <View style={{ flex: 1 }}><CallButton phone={o.customer.phone} label={t('partner.call')} /></View> : null}
            </ButtonRow>
            {!o.canCallCustomer ? <View style={s.noCall}><Icon name="call-outline" size={18} color={colors.secondary} /><Text style={[type.small, { color: colors.secondary, flex: 1 }]}>{t('partner.callDisabledHelp')}</Text></View> : null}
          </Card>
        </Enter>

        {cod ? (
          <Enter index={3}>
            <Card style={s.block}>
              <Text style={[type.small, { color: colors.secondary }]}>{t('partner.collectCash')}</Text>
              <Text style={[type.h1, { color: colors.text }]}>{formatMoney(o.quotedAmount ?? 0)}</Text>
              {riding ? <>
                <Button title={t('partner.showPayment')} icon="qr-code" variant="outline" onPress={showPayment} style={{ marginTop: spacing.md }} />
                <Text style={[type.h3, s.sec]}>{t('partner.howPaid')}</Text>
                <View style={s.howRow}>
                  {HOW.map((h) => (
                    <Tap key={h.key} accessibilityRole="radio" accessibilityState={{ selected: via === h.key }} onPress={() => setVia(h.key)} scaleTo={0.95} style={[s.how, via === h.key && s.howOn]}>
                      <Icon name={h.icon} size={22} color={via === h.key ? colors.white : colors.navy} />
                      <Text style={[type.smallMedium, { color: via === h.key ? colors.white : colors.navy }]}>{t(h.label)}</Text>
                    </Tap>
                  ))}
                </View>
                {via && via !== 'cash' ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={[type.bodyMedium, { color: colors.text }]}>{t('partner.proofTitle')}</Text>
                    <Text style={[type.small, { color: colors.secondary }]}>{t('partner.proofHelp')}</Text>
                    {proof ? <Image source={{ uri: proof.uri }} style={s.proofImg} resizeMode="contain" accessibilityLabel={t('partner.proofTitle')} /> : null}
                    <SourceOptions options={[{ icon: 'images', label: proof ? t('partner.proofChange') : t('upload.gallery'), onPress: () => { void pickProof('gallery'); } }, { icon: 'camera', label: t('upload.camera'), onPress: () => { void pickProof('camera'); } }]} />
                    {reading ? <View style={s.reading}><ActivityIndicator color={colors.primary} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.reading')}</Text></View> : null}
                    <Text style={[type.smallMedium, { color: colors.text, marginTop: spacing.md }]}>{t('partner.txnLabel')} *</Text>
                    <TextInput value={ref} onChangeText={(v) => setRef(v.replace(/[^A-Za-z0-9._\-/]/g, ''))} maxLength={40} autoCapitalize="characters" placeholder={t('partner.refPlaceholder')} placeholderTextColor={colors.muted} accessibilityLabel={t('partner.txnLabel')} style={[type.body, s.refInput, { marginTop: 6 }]} />
                    {readNote ? <Text style={[type.small, { color: readNote === 'read' ? colors.green : colors.amber, marginTop: 4 }]}>{readNote === 'read' ? t('partner.idRead') : t('partner.idNotFound')}</Text> : null}
                  </View>
                ) : null}
                <Tap accessibilityRole="checkbox" accessibilityState={{ checked: received }} onPress={() => setReceived((v) => !v)} scaleTo={0.98} style={s.ack}>
                  <Icon name={received ? 'checkbox' : 'square-outline'} size={26} color={received ? colors.green : colors.muted} />
                  <Text style={[type.small, { color: colors.text, flex: 1 }]}>{t('partner.receivedAck', { amount: formatMoney(o.quotedAmount ?? 0) })}</Text>
                </Tap>
                <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('partner.mustComplete')}</Text>
              </> : null}
            </Card>
          </Enter>
        ) : (
          <Enter index={3}><Card style={s.block}><View style={s.person}><Icon name="shield-checkmark" size={24} color={colors.green} /><Text style={[type.body, { color: colors.text, flex: 1 }]}>{t('partner.prepaid')} · {t('partner.noCash')}</Text></View></Card></Enter>
        )}

        <Enter index={4}>
          <Card style={s.block}>
            <Text style={[type.h3, { color: colors.text, marginBottom: 4 }]}>{t('order.items')}</Text>
            {o.items.length ? o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>) : <Text style={[type.body, { color: colors.secondary }]}>{t('partner.packed')}</Text>}
          </Card>
        </Enter>
        {err ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Animated.Text> : null}
      </Screen>
      <PaymentSheet visible={!!sheet} info={sheet} onClose={() => setSheet(null)} />
    </>
  );
}

// ---------------------------------------------------------------- My attendance
const DAY_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue'> = { present: 'green', leave: 'amber', paid_leave: 'blue', absent: 'red' };
export function MyAttendanceScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.partner.attendance(14), ['partner:update', 'notification']);
  if (loading && !data) return <ListSkeleton />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const a = data!;
  const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
  const tiles = [
    { l: t('partner.dayPresent'), v: a.summary.present, c: colors.green },
    { l: t('partner.dayLeave'), v: a.summary.leave, c: colors.amber },
    { l: t('partner.dayPaidLeave'), v: a.summary.paidLeave, c: colors.primary },
    { l: t('partner.dayAbsent'), v: a.summary.absent, c: colors.red },
  ];
  return (
    <Screen wide>
      <Enter><View style={s.stats}>{tiles.map((x) => <View key={x.l} style={s.stat}><CountUp value={x.v} style={[type.h2, { color: x.c }]} /><Text style={[type.small, { color: colors.secondary, textAlign: 'center' }]} numberOfLines={2}>{x.l}</Text></View>)}</View></Enter>
      <Enter index={1}><Text style={[type.small, { color: colors.secondary, marginVertical: spacing.md }]}>{t('partner.last14')}</Text></Enter>
      {!a.days.length ? <View style={{ height: 240 }}><Message icon="calendar-outline" title={t('partner.noAttendance')} /></View> : a.days.map((d, i) => (
        <Enter key={d.day} index={i + 2}>
          <View style={s.attRow}>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>{formatDate(d.day)}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>
                {d.checkedInAt ? `${clock(d.checkedInAt)}${d.checkedOutAt ? ` – ${clock(d.checkedOutAt)}` : ''}` : d.status === 'paid_leave' ? t('partner.storeWasClosed') : d.status === 'absent' ? t('partner.noCheckIn') : ''}
                {d.breakMinutes > 0 ? `  ·  ${t('partner.breakMin', { count: d.breakMinutes })}` : ''}
              </Text>
            </View>
            <Pill text={t(`partner.day_${d.status}`)} tone={DAY_TONE[d.status]} />
          </View>
        </Enter>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  attRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  fill: { flex: 1, backgroundColor: colors.white },
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  pad: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  greet: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder },
  statusIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.amberBg },
  dutyCard: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  dutyHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  optRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opt: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  optOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  returning: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.md, backgroundColor: colors.white },
  stats: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  stat: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  request: { marginBottom: spacing.md, backgroundColor: colors.white, borderColor: colors.amberBg, borderWidth: 1.5, boxShadow: '0px 6px 18px rgba(181,71,8,0.12)' },
  reqHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reqBtns: { flexDirection: 'row', gap: 12, marginTop: spacing.md },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white },
  segWrap: { flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  seg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rejected: { marginBottom: spacing.md, backgroundColor: colors.white, borderLeftWidth: 5, borderLeftColor: colors.red },
  block: { marginBottom: spacing.md, backgroundColor: colors.white, boxShadow: '0px 4px 14px rgba(15,33,71,0.07)' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: spacing.md },
  noCall: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.tint },
  howRow: { flexDirection: 'row', gap: 10 },
  how: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  howOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  proofImg: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.card, marginTop: spacing.sm },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  waitBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.amberBg },
  refInput: { marginTop: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  ack: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  footerRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  menuIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
