import { useErrorPopup } from '../../hooks';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Image, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { Order, OrderStatus, OrderSummary, PaymentMethod } from '../../api/types';
import { openFile } from '../../components/FileViewer';
import { OrderCard } from '../../components/OrderCard';
import { CountUp, Enter, Ripples, Skeleton, Tap, tick, useShake } from '../../components/motion';
import { Avatar, CallButton } from '../../components/CallButton';
import { StarRating } from '../../components/ReviewParts';
import { ButtonRow, Button, Card, ErrorView, Icon, Message, Pill, ResponsiveGrid, Screen, type IconName } from '../../components/ui';
import { fileBadge, isImageMime } from '../../fileKinds';
import { notice, showDialog } from '../../dialog';
import { useContentStyle } from '../../layout';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, istDate, statusTone, formatDelivery } from '../../utils';
import { DateField } from '../../components/Calendar';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

const ListSkeleton = () => <View style={{ gap: 14, padding: spacing.lg }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={118} r={16} />)}</View>;

type OrdersTab = 'active' | 'completed' | 'cancelled';
type Preset = 'all' | 'today' | '7d' | '30d' | 'custom';
const PRESETS: Preset[] = ['all', 'today', '7d', '30d', 'custom'];

export function OrdersScreen(_p: BottomTabScreenProps<CustomerTabParamList, 'Orders'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle(true);
  const [tab, setTab] = useState<OrdersTab>('active');
  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const customBad = preset === 'custom' && !!from && !!to && from > to;
  const range = preset === 'today' ? { from: istDate(), to: istDate() } : preset === '7d' ? { from: istDate(-6) } : preset === '30d' ? { from: istDate(-29) } : preset === 'custom' && !customBad ? { from: from ?? undefined, to: to ?? undefined } : undefined;
  const key = `${tab}|${range?.from ?? ''}|${range?.to ?? ''}`;
  const requestKey = key;
  const { data: loadedData, error, loading, reload } = useLoad(async () => ({ ...(await endpoints.orders(tab, 0, range)), requestKey }), ['order:update']);
  const data = loadedData?.requestKey === key ? loadedData : null;
  const [olderOrders, setOlderOrders] = useState<OrderSummary[]>([]);
  const [hasMoreAfterPage, setHasMoreAfterPage] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderError, setOlderError] = useState('');
  const pageGeneration = useRef(0);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    pageGeneration.current += 1;
    setOlderOrders([]);
    setHasMoreAfterPage(null);
    setOlderError('');
  }, [data, key]);

  const orders = [...(data?.orders ?? []), ...olderOrders];
  const hasMore = hasMoreAfterPage ?? Boolean(data?.hasMore);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const generation = pageGeneration.current;
    setLoadingMore(true);
    setOlderError('');

    try {
      const page = await endpoints.orders(tab, orders.length, range);
      if (generation !== pageGeneration.current) return;

      setOlderOrders((current) => {
        const known = new Set([...(data?.orders ?? []), ...current].map((o) => o.id));
        return [...current, ...page.orders.filter((o) => !known.has(o.id))];
      });

      setHasMoreAfterPage(page.hasMore);
    } catch (e) {
      if (generation === pageGeneration.current) {
        setOlderError((e as Error).message);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = !key.endsWith('||');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <Enter>
        <Text style={[type.h2, s.heading]}>{t('orders.title')}</Text>
      </Enter>

      <View style={[s.segWrap, content]}>
        {(['active', 'completed', 'cancelled'] as const).map((k) => (
          <Tap
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
            onPress={() => setTab(k)}
            scaleTo={0.97}
            style={[s.seg, tab === k && s.segOn]}
          >
            <Icon
              name={k === 'active' ? 'time' : k === 'completed' ? 'checkmark-done' : 'close-circle'}
              size={18}
              color={tab === k ? colors.white : colors.navy}
            />
            <Text style={[type.smallMedium, { color: tab === k ? colors.white : colors.navy }]}>
              {t(`orders.tab_${k}`)}
            </Text>
          </Tap>
        ))}
      </View>

      <View style={content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <View style={s.calIcon}>
            <Icon name="calendar" size={18} color={colors.primary} />
          </View>

          {PRESETS.map((p) => (
            <Tap
              key={p}
              accessibilityRole="button"
              accessibilityState={{ selected: preset === p }}
              onPress={() => setPreset(p)}
              scaleTo={0.94}
              style={[s.chip, preset === p && s.chipOn]}
            >
              <Text style={[type.smallMedium, { color: preset === p ? colors.white : colors.navy }]}>
                {t(`orders.filter_${p}`)}
              </Text>
            </Tap>
          ))}
        </ScrollView>

        {preset === 'custom' ? (
          <View style={s.dateRow}>
            <DateField
              compact
              clearable
              value={from}
              onChange={setFrom}
              max={to ?? istDate()}
              placeholder={t('orders.fromDate')}
              title={t('orders.fromDate')}
              accessibilityLabel={t('orders.fromDate')}
            />
            <Icon name="arrow-forward" size={16} color={colors.muted} />
            <DateField
              compact
              clearable
              value={to}
              onChange={setTo}
              min={from ?? undefined}
              max={istDate()}
              placeholder={t('orders.toDate')}
              title={t('orders.toDate')}
              accessibilityLabel={t('orders.toDate')}
            />
          </View>
        ) : null}

        {customBad ? (
          <Text style={[type.small, { color: colors.red, paddingHorizontal: spacing.lg }]}>
            {t('orders.dateInvalid')}
          </Text>
        ) : null}
      </View>

      {loading && !data?.orders.length ? (
        <ListSkeleton />
      ) : error && !data ? (
        <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />
      ) : error && !orders.length ? (
        <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />
      ) : !orders.length ? (
        <Message
          icon={tab === 'active' ? 'time-outline' : tab === 'completed' ? 'receipt-outline' : 'close-circle-outline'}
          title={filtered ? t('orders.noMatchTitle') : t(`orders.empty_${tab}`)}
          text={filtered ? t('orders.noMatch') : t(`orders.emptyHelp_${tab}`)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[{ padding: spacing.lg, paddingBottom: spacing.xxxl }, content]}
          refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : null}

          <ResponsiveGrid>
            {orders.map((o, i) => (
              <OrderCard
                key={o.id}
                order={o}
                index={i}
                onPress={() => nav.navigate('OrderDetail', { orderId: o.id })}
              />
            ))}
          </ResponsiveGrid>

          {olderError ? (
            <ErrorView
              message={olderError}
              onRetry={() => { void loadMore(); }}
              retryLabel={t('common.retry')}
            />
          ) : null}

          {hasMore ? (
            <Button
              title={loadingMore ? t('orders.loadingMore') : t('orders.loadMore')}
              variant="outline"
              onPress={() => { void loadMore(); }}
              loading={loadingMore}
              disabled={loadingMore}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const STEPS: OrderStatus[] = ['requested', 'quoted', 'ready_to_dispatch', 'out_for_delivery', 'delivered'];
const STEP_ICON = ['paper-plane', 'pricetag', 'checkmark-circle', 'bicycle', 'home'] as const;

const stepIndex = (st: OrderStatus) => ({
  requested: 0,
  quoted: 1,
  accepted: 2,
  awaiting_payment: 1,
  ready_to_dispatch: 2,
  out_for_delivery: 3,
  delivered: 4,
  rejected: -1,
  cancelled: -1,
})[st];

function TimelineStep({ i, idx, label }: { i: number; idx: number; label: string }) {
  const done = i < idx;
  const on = i === idx;
  const pop = useSharedValue(0);

  useEffect(() => {
    pop.value = withDelay(250 + i * 140, withSpring(1, { damping: 9, stiffness: 160 }));
  }, [i, pop]);

  const a = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pop.value, [0, 1], [0.3, 1]) }],
    opacity: pop.value,
  }));

  return (
    <View style={s.step}>
      <Animated.View style={[s.dotWrap, a]}>
        {on ? <Ripples size={34} count={2} /> : null}
        <View style={[s.dot, (done || on) && s.dotOn, idx === 4 && i === 4 && { backgroundColor: colors.green }]}>
          {done || (on && idx === 4) ? (
            <Icon name="checkmark" size={15} color={colors.white} />
          ) : (
            <Icon name={STEP_ICON[i]} size={14} color={on ? colors.white : colors.muted} />
          )}
        </View>
      </Animated.View>
      <Text style={[type.small, s.stepLabel, { color: i <= idx ? colors.text : colors.muted }]}>
        {label}
      </Text>
    </View>
  );
}

function Timeline({ idx }: { idx: number }) {
  const { t } = useTranslation();
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withDelay(300, withTiming(idx / 4, { duration: 900 }));
  }, [idx, fill]);

  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={s.timeline}>
      <View style={s.line}>
        <Animated.View style={[s.lineFill, bar]} />
      </View>
      {STEPS.map((st, i) => (
        <TimelineStep key={st} i={i} idx={idx} label={t(`track.${st}`)} />
      ))}
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: 14 }}>
      <Skeleton h={28} w="50%" />
      <Skeleton h={70} r={16} />
      <Skeleton h={120} r={16} />
      <Skeleton h={90} r={16} />
    </View>
  );
}

const HERO_ICON: Record<OrderStatus, IconName> = {
  requested: 'hourglass',
  quoted: 'pricetag',
  accepted: 'checkmark-circle',
  awaiting_payment: 'card',
  ready_to_dispatch: 'cube',
  out_for_delivery: 'bicycle',
  delivered: 'checkmark-done-circle',
  rejected: 'close-circle',
  cancelled: 'close-circle',
};

function Section({
  icon,
  title,
  open: initial = false,
  children,
}: {
  icon: IconName;
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initial);

  return (
    <View style={s.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={s.sectionHead}
      >
        <View style={s.sectionIcon}>
          <Icon name={icon} size={20} color={colors.primary} />
        </View>
        <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]}>{title}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
      </Pressable>

      {open ? <View style={s.sectionBody}>{children}</View> : null}
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  tone = 'blue',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'blue' | 'green' | 'amber';
}) {
  const fg = tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : colors.primary;
  const bg = tone === 'green' ? colors.greenBg : tone === 'amber' ? colors.amberBg : colors.card;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.quick}>
      <View style={[s.quickIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={22} color={fg} />
      </View>
      <Text numberOfLines={2} style={[type.small, { color: colors.text, textAlign: 'center' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function OrderDetailScreen({
  navigation,
  route,
}: NativeStackScreenProps<CustomerStackParamList, 'OrderDetail'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.order(route.params.orderId), ['order:update']);
  const config = useLoad(() => endpoints.config());
  const shop = useLoad(() => endpoints.shop());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [billBusy, setBillBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const [errCount, setErrCount] = useState(0);

  if (loading && !data) return <DetailSkeleton />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;

  const o = data!.order;
  const idx = stepIndex(o.status);
  const canCancel = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status);
  const hasInvoice = ['ready_to_dispatch', 'out_for_delivery', 'delivered'].includes(o.status) && o.quotedAmount !== null;
  const live = o.status === 'ready_to_dispatch' || o.status === 'out_for_delivery';

  // The shop's number: the profile the admin filled in first, then the older settings.
  const storePhone = shop.data?.phones?.find((p) => p.number)?.number
    ?? shop.data?.legacy.phone
    ?? config.data?.store.phone
    ?? o.store.phone;

  const downloadBill = async () => {
  const bill = o.bill;
  if (!bill?.downloadUrl || billBusy) return;

  setBillBusy(true);
  setErr('');

  try {
    if (!FileSystem.cacheDirectory) {
      throw new Error('File storage is unavailable.');
    }

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('File sharing is not available on this device.');
    }

    const safeName = (bill.name || `Bill-${o.orderNumber}.pdf`)
      .replace(/[^\w.-]/g, '_');

    const fileUri = `${FileSystem.cacheDirectory}${Date.now()}-${safeName}`;

    const result = await FileSystem.downloadAsync(
      bill.downloadUrl,
      fileUri,
    );

    if (result.status !== 200) {
      throw new Error(`Bill download failed (HTTP ${result.status}).`);
    }

    await Sharing.shareAsync(result.uri, {
      mimeType: bill.mimeType || 'application/pdf',
      dialogTitle: bill.name || 'Download Bill',
      UTI: 'com.adobe.pdf',
    });
  } catch (e) {
    setErr((e as Error).message || 'Unable to download bill.');
    setErrCount((c) => c + 1);
  } finally {
    setBillBusy(false);
  }
};

  const callShop = () => {
    if (storePhone) {
      void Linking.openURL(`tel:${storePhone}`);
    } else {
      void notice(t('shop.noPhoneTitle'), t('shop.noPhoneMsg'), t('common.ok'));
    }
  };

  const addressLine = `${[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}, ${o.address.city} - ${o.address.pincode}`;

  const cancel = async () => {
    if (reason.trim().length < 5) {
      setErr(t('order.reasonShort'));
      setErrCount((c) => c + 1);
      return;
    }

    setBusy(true);
    setErr('');

    try {
      await endpoints.cancelOrder(o.id, reason.trim());
      setCancelOpen(false);
      setReason('');
      await reload();
    } catch (e) {
      setErr((e as Error).message);
      setErrCount((c) => c + 1);
    } finally {
      setBusy(false);
    }
  };

  const invoice = async () => {
    try {
      const l = await endpoints.invoiceLink(o.id);
      await Linking.openURL(l.url);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const copyAddress = async () => {
    try {
      await Clipboard.setStringAsync(`${o.address.recipientName}, ${addressLine}`);
      tick('success');
      await notice(t('order.copied'), undefined, t('common.ok'));
    } catch {
      // Clipboard unavailable.
    }
  };

  const openMap = () => {
    const q = encodeURIComponent(addressLine);
    void Linking.openURL(
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?q=${q}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`,
    );
  };

  const primary = o.status === 'quoted'
    ? <Button title={t('order.acceptPay')} icon="arrow-forward" onPress={() => navigation.navigate('Payment', { orderId: o.id })} />
    : o.status === 'awaiting_payment'
      ? <Button title={t('order.completePayment')} icon="card" onPress={() => navigation.navigate('Payment', { orderId: o.id })} />
      : live
        ? <Button title={t('live.trackBtn')} icon="navigate" onPress={() => navigation.navigate('Track', { orderId: o.id })} />
        : o.status === 'delivered' && !o.review
          ? <Button title={t('reviews.rateBtn')} icon="star" onPress={() => navigation.navigate('WriteReview', { orderId: o.id, orderNumber: o.orderNumber })} />
          : undefined;

  return (
    <>
      <Screen footer={primary}>
        <LinearGradient
          colors={
            o.status === 'cancelled' || o.status === 'rejected'
              ? [colors.white, colors.redBg]
              : o.status === 'delivered'
                ? [colors.white, colors.greenBg]
                : [colors.white, colors.card]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.hero}
        >
          <View style={s.heroTop}>
            <View
              style={[
                s.heroIcon,
                o.status === 'delivered' && { backgroundColor: colors.green },
                (o.status === 'cancelled' || o.status === 'rejected') && { backgroundColor: colors.red },
              ]}
            >
              <Icon name={HERO_ICON[o.status]} size={30} color={colors.white} />
            </View>

            <View style={{ flex: 1, minWidth: 130 }}>
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  await Clipboard.setStringAsync(o.orderNumber).catch(() => undefined);
                  tick();
                }}
              >
                <Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text>
              </Pressable>
              <Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(o.createdAt)}</Text>
            </View>

            <Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} />
          </View>

          <Text style={[type.body, { color: colors.text, marginTop: spacing.md }]}>
            {o.status === 'rejected'
              ? o.rejectionReason
              : o.status === 'cancelled'
                ? o.cancelReason
                : t(`order.hint_${o.status}`)}
          </Text>

          {o.quotedAmount !== null ? (
            <View style={s.amountRow}>
              <View>
                <Text style={[type.small, { color: colors.secondary }]}>{t('order.amount')}</Text>
                <Text style={[type.h1, { color: colors.text }]}>{formatMoney(o.quotedAmount)}</Text>
              </View>
              {o.paymentMethod ? <Pill text={t(`pay.${o.paymentMethod}`)} tone="blue" /> : null}
            </View>
          ) : null}

          {o.status === 'quoted' && o.quoteExpiresAt ? (
            <Text style={[type.small, { color: colors.amber, marginTop: 4 }]}>
              {t('order.validTill', { time: formatDateTime(o.quoteExpiresAt) })}
            </Text>
          ) : null}

          {hasInvoice ? (
            <Button
              title={t('order.invoice')}
              variant="outline"
              icon="receipt"
              onPress={invoice}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
        </LinearGradient>

        <View style={s.quickRow}>
          {live ? (
            <QuickAction
              icon="navigate"
              label={t('live.trackBtn')}
              onPress={() => navigation.navigate('Track', { orderId: o.id })}
              tone="green"
            />
          ) : null}

          <QuickAction icon="call" label={t('order.callStore')} onPress={callShop} tone="green" />
          <QuickAction icon="chatbubbles" label={t('order.chatAbout')} onPress={() => navigation.navigate('Chat', { orderId: o.id })} />

          {o.bill?.viewUrl ? (
            <QuickAction
              icon="document-text"
              label={t('order.viewBill')}
              onPress={() => openFile({
                title: o.bill!.name,
                urls: o.bill!.previewUrls ?? [],
                fallbackUrl: o.bill!.viewUrl,
                downloadUrl: o.bill!.downloadUrl,
              })}
              tone="amber"
            />
          ) : null}
        </View>

        {idx >= 0 ? <Timeline idx={idx} /> : null}

        <Section icon="medkit" title={`${t('order.items')} (${o.items.length + o.prescriptions.length})`} open>
          {o.items.map((i) => (
            <View key={i.id} style={s.itemRow}>
              <View style={s.itemDot} />
              <Text style={[type.body, { color: colors.text, flex: 1 }]}>{i.name}</Text>
              <Text style={[type.bodyMedium, { color: colors.primary }]}>× {i.quantity}</Text>
            </View>
          ))}

          {o.prescriptions.length > 0 ? (
            <View style={s.rxRow}>
              {o.prescriptions.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={t('order.viewPhoto')}
                  onPress={() => {
                    if (p.url || p.previewUrls?.length) {
                      openFile({
                        title: `${t('order.items')} · #${o.orderNumber}`,
                        urls: p.previewUrls ?? [],
                        fallbackUrl: p.url,
                      });
                    }
                  }}
                  style={s.rx}
                >
                  {!isImageMime(p.mimeType) || !p.url ? (
                    <Icon name="document-text" size={28} />
                  ) : (
                    <Image source={{ uri: p.url }} style={{ flex: 1, width: '100%', borderRadius: radius.sm }} />
                  )}
                </Pressable>
              ))}
            </View>
          ) : null}

          {o.note ? (
            <Text style={[type.small, { color: colors.secondary, marginTop: 8 }]}>
              {t('review.note')}: {o.note}
            </Text>
          ) : null}
        </Section>

        <Section
          icon="location"
          title={t('order.deliveryTo')}
          open={!['delivered', 'cancelled', 'rejected'].includes(o.status)}
        >
          <Text style={[type.bodyMedium, { color: colors.text }]}>
            {o.address.recipientName}{o.address.phone ? ` · ${o.address.phone}` : ''}
          </Text>

          <Text style={[type.body, { color: colors.secondary, marginTop: 2 }]}>{addressLine}</Text>

          <Text style={[type.bodyMedium, { color: colors.text, marginTop: 6 }]}>
            {formatDelivery(o.deliveryDate, o.deliverySlot)}
          </Text>

          <ButtonRow>
            <Button small variant="outline" icon="map" title={t('order.openMap')} onPress={openMap} style={{ flex: 1 }} />
            <Button small variant="outline" icon="copy" title={t('order.copyAddress')} onPress={() => { void copyAddress(); }} style={{ flex: 1 }} />
          </ButtonRow>
        </Section>

        <Section icon="people" title={t('order.sectionPeople')}>
          <View style={s.stack}>
            <View style={s.infoRow}>
              <Icon name="storefront" size={22} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{o.store.name}</Text>
                {o.store.address ? (
                  <Text style={[type.small, { color: colors.secondary }]}>{o.store.address}</Text>
                ) : null}
              </View>
              {storePhone ? <CallButton phone={storePhone} compact label={t('order.callStore')} /> : null}
            </View>

            {o.partner?.name ? (
              <View style={s.infoRow}>
                <Avatar name={o.partner.name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.small, { color: colors.secondary }]}>{t('order.deliveryPartner')}</Text>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>{o.partner.name}</Text>
                </View>
              </View>
            ) : (
              <Text style={[type.small, { color: colors.secondary }]}>{t('order.partnerPending')}</Text>
            )}
          </View>
        </Section>

        {o.quotedAmount !== null || o.bill ? (
          <Section icon="card" title={t('order.sectionPayment')}>
            <View style={s.stack}>
              {o.quotedAmount !== null ? (
                <View style={s.infoRow}>
                  <Icon name="cash" size={22} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyMedium, { color: colors.text }]}>
                      {formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)}` : ''}
                    </Text>
                    {o.paymentStatus ? (
                      <Text style={[type.small, { color: colors.secondary }]}>
                        {t('order.paymentStatus', { status: o.paymentStatus.replace(/_/g, ' ') })}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {o.bill ? (
                <>
                  <View style={s.billCard}>
                    <Icon name="document-text" size={28} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={2}>
                        {o.bill.name}
                      </Text>
                      <Text style={[type.small, { color: colors.secondary }]}>
                        {fileBadge(o.bill.name, o.bill.mimeType)}
                        {o.bill.uploadedAt ? ` · ${formatDateTime(o.bill.uploadedAt)}` : ''}
                      </Text>
                    </View>
                  </View>

                  <ButtonRow>
                    <Button
                      small
                      variant="outline"
                      title={t('order.viewBill')}
                      icon="eye"
                      onPress={() => openFile({
                        title: o.bill!.name,
                        urls: o.bill!.previewUrls ?? [],
                        fallbackUrl: o.bill!.viewUrl,
                        downloadUrl: o.bill!.downloadUrl,
                      })}
                      disabled={!o.bill.viewUrl && !o.bill.previewUrls?.length}
                      style={{ flex: 1 }}
                    />
                    <Button
  small
  title={billBusy ? 'Downloading...' : t('order.downloadBill')}
  icon="download"
  onPress={() => void downloadBill()}
  disabled={!o.bill?.downloadUrl || billBusy}
  style={{ flex: 1 }}
/>
                  </ButtonRow>
                </>
              ) : null}
            </View>
          </Section>
        ) : null}

        {o.review ? (
          <Section icon="star" title={t('reviews.yourReview')} open>
            <StarRating value={o.review.rating} />
            <Text style={[type.small, { color: colors.secondary, marginTop: 4 }]}>
              {t(`reviews.hint_${o.review.status}`)}
            </Text>
          </Section>
        ) : null}

        {o.history.length > 0 ? (
          <Section icon="time" title={t('order.activity')}>
            {o.deliveredAt ? (
              <Text style={[type.bodyMedium, { color: colors.green, marginBottom: 6 }]}>
                {t('order.deliveredOn', { time: formatDateTime(o.deliveredAt) })}
              </Text>
            ) : null}

            {o.history.map((h, i) => (
              <View key={i} style={s.actRow}>
                <View style={s.actDot} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: colors.text }]}>{t(`status.${h.status}`)}</Text>
                  <Text style={[type.small, { color: colors.secondary }]}>
                    {formatDateTime(h.created_at)}{h.reason ? ` · ${h.reason}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </Section>
        ) : null}

        {canCancel ? (
          <Button
            title={t('order.cancel')}
            variant="danger"
            onPress={() => {
              setErr('');
              setCancelOpen(true);
            }}
            style={{ marginTop: spacing.lg }}
          />
        ) : null}

        {o.status === 'ready_to_dispatch' || o.status === 'awaiting_payment' ? (
          <Text style={[type.small, { color: colors.secondary, marginTop: spacing.sm }]}>
            {t('order.cancelNote')}
          </Text>
        ) : null}
      </Screen>

      <Modal transparent visible={cancelOpen} animationType="none" onRequestClose={() => setCancelOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.dialog}>
            <Text style={[type.h3, { color: colors.text }]}>{t('order.cancelTitle')}</Text>
            <Text style={[type.small, { color: colors.secondary, marginVertical: spacing.sm }]}>
              {t('order.cancelReasonHelp')}
            </Text>

            <View>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={300}
                placeholder={t('order.reasonPlaceholder')}
                placeholderTextColor={colors.muted}
                accessibilityLabel={t('order.reasonPlaceholder')}
                style={[type.body, s.reason]}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: spacing.lg }}>
              <Button title={t('common.back')} variant="outline" onPress={() => setCancelOpen(false)} style={{ flex: 1 }} />
              <Button title={t('order.confirmCancel')} variant="danger" onPress={cancel} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function PayOption({
  selected,
  icon,
  title,
  sub,
  onPress,
}: {
  selected: boolean;
  icon: 'card' | 'cash';
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const sel = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    sel.value = withTiming(selected ? 1 : 0, { duration: 220 });
  }, [selected, sel]);

  const a = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(sel.value, [0, 1], [1, 1.02]) }],
    backgroundColor: sel.value > 0.5 ? colors.card : colors.white,
    borderColor: sel.value > 0.5 ? colors.primary : colors.border,
  }));

  return (
    <Tap
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      scaleTo={0.98}
      style={{ marginBottom: spacing.md }}
    >
      <Animated.View style={[s.opt, a]}>
        <View style={s.optIcon}>
          <Icon name={icon === 'card' ? 'card' : 'cash'} size={28} color={colors.navy} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>{title}</Text>
          <Text style={[type.small, { color: colors.secondary }]}>{sub}</Text>
        </View>
        <Icon
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={26}
          color={selected ? colors.primary : colors.muted}
        />
      </Animated.View>
    </Tap>
  );
}

/* -------------------------------------------------------------------------- */
/* Razorpay Web Checkout                                                       */
/* -------------------------------------------------------------------------- */

type RazorpayPaymentResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayWebError = {
  error?: {
    description?: string;
    reason?: string;
  };
};

type RazorpayWebOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill?: {
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayPaymentResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
};

type RazorpayWebInstance = {
  open: () => void;
  on: (event: string, callback: (response: RazorpayWebError) => void) => void;
};

type RazorpayWebConstructor = new (options: RazorpayWebOptions) => RazorpayWebInstance;

type RazorpayBrowserWindow = {
  Razorpay?: RazorpayWebConstructor;
};

/**
 * Loads Razorpay Checkout.js only on web.
 * The public Key ID comes from the backend payment-order response.
 * The Razorpay Key Secret is never used in frontend code.
 */
function loadRazorpayCheckout(): Promise<RazorpayWebConstructor> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('Razorpay checkout is only available in a browser.'));
      return;
    }

    const browserWindow = window as unknown as RazorpayBrowserWindow;

    if (browserWindow.Razorpay) {
      resolve(browserWindow.Razorpay);
      return;
    }

    const scriptSelector = 'script[data-razorpay-checkout]';
    let script = document.querySelector<HTMLScriptElement>(scriptSelector);

    const handleLoad = () => {
      const Razorpay = browserWindow.Razorpay;

      if (Razorpay) {
        resolve(Razorpay);
      } else {
        reject(new Error('Razorpay Checkout could not be initialized. Please refresh and try again.'));
      }
    };

    const handleError = () => {
      reject(new Error('Unable to load Razorpay Checkout. Please check your internet connection and try again.'));
    };

    if (!script) {
      script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.setAttribute('data-razorpay-checkout', 'true');
    }

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!script.isConnected) {
      document.head.appendChild(script);
    }
  });
}

/**
 * Opens Razorpay's hosted checkout on the website.
 * Resolves only after Checkout.js returns the payment identifiers/signature.
 */
async function openWebRazorpay(
  options: Omit<RazorpayWebOptions, 'handler'>,
  cancelledMessage: string,
  failedMessage: (reason: string) => string,
): Promise<RazorpayPaymentResponse> {
  const Razorpay = await loadRazorpayCheckout();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const checkout = new Razorpay({
      ...options,

      handler: (response) => {
        finish(() => resolve(response));
      },

      modal: {
        ondismiss: () => {
          finish(() => reject(new Error(cancelledMessage)));
        },
      },
    });

    checkout.on('payment.failed', (response) => {
      const reason = response.error?.description
        ?? response.error?.reason
        ?? 'Payment could not be completed.';

      finish(() => reject(new Error(failedMessage(reason))));
    });

    try {
      checkout.open();
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('Unable to open Razorpay Checkout.')));
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Payment Screen                                                              */
/* -------------------------------------------------------------------------- */

export function PaymentScreen({
  navigation,
  route,
}: NativeStackScreenProps<CustomerStackParamList, 'Payment'>) {
  const { t } = useTranslation();
  const phone = useSession((st) => st.user?.phone);

  const { data, error, loading, reload } = useLoad(() => endpoints.order(route.params.orderId));

  // Razorpay is the default payment option on web, Android and iOS.
  const [method, setMethod] = useState<PaymentMethod>('razorpay');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useErrorPopup(err);

  if (loading && !data) return <DetailSkeleton />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;

  const o: Order = data!.order;

  const pay = async () => {
    if (busy) return;

    setBusy(true);
    setErr('');

    try {
      // Create or retrieve the payment order from our backend first.
      // The backend returns the Razorpay Order ID and public Key ID.
      const res = await endpoints.acceptQuote(o.id, method);

      if (method === 'razorpay') {
        if (!res.razorpay) {
          throw new Error('Payment could not be initialized. Please try again.');
        }

        let result: RazorpayPaymentResponse;

        if (Platform.OS === 'web') {
          // Website checkout using Razorpay Checkout.js.
          result = await openWebRazorpay(
            {
              key: res.razorpay.keyId,
              amount: res.razorpay.amount,
              currency: res.razorpay.currency,
              order_id: res.razorpay.orderId,
              name: 'Kamal Medical Hall',
              description: `Order #${o.orderNumber}`,
              prefill: {
                contact: phone ?? undefined,
              },
              theme: {
                color: colors.primary,
              },
            },
            t('pay.cancelledByUser'),
            (reason) => t('pay.failedWith', { reason }),
          );
        } else {
          // Existing native Razorpay SDK for Android and iOS.
          const Razorpay = (
            require('react-native-razorpay') as {
              default: {
                open: (options: object) => Promise<RazorpayPaymentResponse>;
              };
            }
          ).default;

          try {
            result = await Razorpay.open({
              key: res.razorpay.keyId,
              amount: res.razorpay.amount,
              currency: res.razorpay.currency,
              order_id: res.razorpay.orderId,
              name: 'Kamal Medical Hall',
              description: `#${o.orderNumber}`,
              prefill: {
                contact: phone,
              },
              theme: {
                color: colors.primary,
              },
            });
          } catch (e) {
            const f = e as {
              code?: number;
              description?: string;
              error?: {
                description?: string;
              };
            };

            const detail = f.description ?? f.error?.description;

            throw new Error(
              f.code === 2 || !detail
                ? t('pay.cancelledByUser')
                : t('pay.failedWith', { reason: detail }),
            );
          }
        }

        // Verify payment signature on our backend.
        // Never verify payment only on the client.
        try {
          await endpoints.verifyPayment(o.id, {
            razorpayOrderId: result.razorpay_order_id,
            razorpayPaymentId: result.razorpay_payment_id,
            razorpaySignature: result.razorpay_signature,
          });
        } catch {
          // Payment may already have been captured.
          // The backend webhook can confirm it if the verification request
          // temporarily fails because of a network issue.
          await notice(
            t('pay.confirmingTitle'),
            t('pay.confirmingMsg'),
            t('common.ok'),
          );
        }
      }

      // COD and verified Razorpay both return to the order details screen.
      tick('success');
      navigation.replace('OrderDetail', { orderId: o.id });
    } catch (e) {
      setErr((e as Error).message);
      tick('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          title={
            method === 'cod'
              ? t('pay.confirmCod')
              : t('pay.payNow', { amount: formatMoney(o.quotedAmount ?? 0) })
          }
          icon={method === 'cod' ? 'checkmark' : 'lock-closed'}
          onPress={pay}
          loading={busy}
          disabled={busy}
        />
      }
    >
      <Enter index={0}>
        <LinearGradient
          colors={[colors.card, '#D5E7FB']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.amountCard}
        >
          <Text style={[type.small, { color: colors.secondary }]}>
            {t('order.amount')} · #{o.orderNumber}
          </Text>

          <CountUp
            value={o.quotedAmount ?? 0}
            prefix="₹"
            style={[type.h1, { color: colors.text, fontSize: 40, lineHeight: 54 }]}
          />

          <View style={s.row}>
            <Icon name="bicycle" size={16} color={colors.green} />
            <Text style={[type.small, { color: colors.green }]}>{t('cart.freeDelivery')}</Text>
          </View>
        </LinearGradient>
      </Enter>

      {/* Razorpay is now available on web, Android and iOS. */}
      <Enter index={1}>
        <PayOption
          selected={method === 'razorpay'}
          icon="card"
          title={t('pay.razorpay')}
          sub={t('pay.razorpaySub')}
          onPress={() => setMethod('razorpay')}
        />
      </Enter>

      {/* COD remains available on all platforms. */}
      <Enter index={2}>
        <PayOption
          selected={method === 'cod'}
          icon="cash"
          title={t('pay.cod')}
          sub={t('pay.codSub')}
          onPress={() => setMethod('cod')}
        />
      </Enter>

      {err ? (
        <Animated.Text
          entering={FadeIn.duration(250)}
          style={[type.small, { color: colors.red, marginTop: spacing.md }]}
        >
          {err}
        </Animated.Text>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  segWrap: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  seg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chips: {
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  calIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  dateInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  billBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.sm,
  },
  stack: {
    gap: spacing.md,
  },
  billCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  actRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 5,
  },
  actDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  heading: {
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alert: {
    marginTop: spacing.md,
  },
  quote: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.amberBg,
    gap: 2,
  },
  timeline: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  line: {
    position: 'absolute',
    top: 16,
    left: '10%',
    right: '10%',
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  lineFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  stepLabel: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
    alignSelf: 'stretch',
  },
  dotWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: {
    backgroundColor: colors.primary,
  },
  sec: {
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: 4,
  },
  rxRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.sm,
  },
  rx: {
    width: 64,
    height: 80,
    borderRadius: radius.sm,
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  reason: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    textAlignVertical: 'top',
    color: colors.text,
  },
  amountCard: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderRadius: radius.lg,
  },
  optIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
  },
  noteMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: spacing.md,
  },
  noteTrash: {
    padding: spacing.md,
  },
  noteActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.md,
  },
  hero: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.md,
  },
  quick: {
    width: 76,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  btnPair: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: spacing.md,
  },
  photoBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFull: {
    width: '100%',
    height: '85%',
  },
  photoClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
});

void withRepeat;