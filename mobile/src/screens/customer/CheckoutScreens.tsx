import { useErrorPopup } from '../../hooks';
import { clearOrderCache } from '../../cache';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, ZoomIn, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { endpoints } from '../../api/endpoints';
import { uploadPrescription, type UploadedFile } from '../../api/upload';
import { Enter, Ripples, Skeleton, Tap, tick, useShake } from '../../components/motion';
import { Button, Card, CheckoutSteps, ErrorView, Icon, Screen } from '../../components/ui';
import { useLoad } from '../../hooks';
import { goTo } from '../../navigation/helpers';
import type { CustomerStackParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDayChip } from '../../utils';

function CheckoutSkeleton() {
  return <View style={{ padding: spacing.lg, gap: 14 }}><Skeleton h={50} r={25} /><Skeleton h={56} r={14} /><Skeleton h={56} r={14} /><Skeleton h={56} r={14} /></View>;
}

function SlotRow({ label, on, available, unavailableText, onPress, index }: { label: string; on: boolean; available: boolean; unavailableText: string; onPress: () => void; index: number }) {
  const sel = useSharedValue(on ? 1 : 0);
  useEffect(() => { sel.value = withTiming(on ? 1 : 0, { duration: 220 }); }, [on, sel]);
  const a = useAnimatedStyle(() => ({ backgroundColor: sel.value > 0.5 ? colors.card : colors.white, transform: [{ scale: interpolate(sel.value, [0, 1], [1, 1.015]) }] }));
  return (
    <Enter index={index}>
      <Tap accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !available }} disabled={!available} onPress={onPress} scaleTo={0.98} style={{ opacity: available ? 1 : 0.4 }}>
        <Animated.View style={[s.slot, a]}>
          <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={24} color={on ? colors.primary : colors.muted} />
          <Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{label}</Text>
          {!available ? <Text style={[type.small, { color: colors.secondary }]}>{unavailableText}</Text> : on ? <Animated.View entering={ZoomIn.duration(200)}><Icon name="checkmark-circle" size={22} color={colors.primary} /></Animated.View> : null}
        </Animated.View>
      </Tap>
    </Enter>
  );
}

export function DeliveryTimeScreen({ navigation }: NativeStackScreenProps<CustomerStackParamList, 'DeliveryTime'>) {
  const { t } = useTranslation();
  const date = useCart((st) => st.checkout.date);
  const setDate = useCart((st) => st.setDate);
  const { data, error, loading, reload } = useLoad(() => endpoints.config());
  const dates = data?.deliveryDates ?? data?.deliveryDays.map((d) => d.date) ?? [];

  // A date chosen earlier may have dropped off the list (the cut-off time passed): clear it.
  useEffect(() => { if (dates.length && date && !dates.includes(date)) useCart.setState((st) => ({ checkout: { ...st.checkout, date: null }, idempotencyKey: null })); }, [dates, date]);

  if (loading && !data) return <CheckoutSkeleton />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const cutoff = data?.orderCutoffTime ? new Date(`2000-01-01T${data.orderCutoffTime}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <Screen footer={<Button title={t('time.review')} icon="arrow-forward" disabled={!date || !dates.includes(date)} onPress={() => goTo(navigation, 'Review')} />}>
      <Enter><CheckoutSteps step={1} labels={[t('steps.address'), t('steps.time'), t('steps.review')]} /></Enter>
      {data && !data.store.isOpen ? <Text style={[type.small, { color: colors.red, marginBottom: spacing.md }]}>{t('time.storeClosed')}</Text> : null}
      <Text style={[type.h3, { color: colors.text }]}>{t('time.chooseDate')}</Text>
      {cutoff ? <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('time.cutoffHint', { time: cutoff })}</Text> : null}
      {dates.map((d, i) => { const l = formatDayChip(d); return <SlotRow key={d} index={i} label={`${l.top}, ${l.bottom}`} on={date === d} available unavailableText="" onPress={() => setDate(d)} />; })}
      <Enter index={8}><View style={s.free}><Icon name="bicycle" size={18} color={colors.green} /><Text style={[type.small, { color: colors.green, flex: 1 }]}>{t('cart.freeDelivery')}</Text></View></Enter>
    </Screen>
  );
}

// Uploaded prescription files are remembered per local file so a retry after a failed order submit does not re-upload.
const uploaded = new Map<string, UploadedFile>();

export function ReviewScreen({ navigation }: NativeStackScreenProps<CustomerStackParamList, 'Review'>) {
  const { t } = useTranslation();
  const cart = useCart();
  const { checkout, medicines, prescriptions, note } = cart;
  const addresses = useLoad(() => endpoints.addresses());
  const config = useLoad(() => endpoints.config());
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  useErrorPopup(error);
  const [errCount, setErrCount] = useState(0);
  const shake = useShake(errCount);
  const address = addresses.data?.addresses.find((a) => a.id === checkout.id);

  if ((addresses.loading && !addresses.data) || (config.loading && !config.data)) return <CheckoutSkeleton />;
  if (addresses.error || config.error) return <ErrorView message={(addresses.error ?? config.error)!} onRetry={() => { void addresses.reload(); void config.reload(); }} retryLabel={t('common.retry')} />;

  const ready = !!address && !!checkout.date;
  const submit = async () => {
    if (!ready || !address) { setError(t('review.incomplete')); setErrCount((c) => c + 1); return; }
    if (!prescriptions.length) { setError(t('cart.rxRequired')); setErrCount((c) => c + 1); return; }
    setBusy(true); setError('');
    try {
      const files: UploadedFile[] = [];
      setStep(t('review.uploading'));
      const sig = await endpoints.signUpload();
      // all files at once; ones already uploaded by an earlier attempt are reused
      files.push(...await Promise.all(prescriptions.map(async (f) => {
        let u = uploaded.get(f.id);
        if (!u) { u = await uploadPrescription(f, sig); uploaded.set(f.id, u); }
        return u;
      })));
      setStep(t('review.sending'));
      const { order } = await endpoints.createOrder({
        kind: 'prescription', items: medicines.map((m) => ({ name: m.name, quantity: m.quantity })),
        prescriptions: files, note: note || undefined, addressId: address.id, deliveryDate: checkout.date!, idempotencyKey: cart.ensureKey(),
      });
      tick('success');
      uploaded.clear();
      await clearOrderCache(); // cart, upload bookkeeping and the picker's temporary copies
      navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'Success', params: { orderId: order.id, orderNumber: order.orderNumber } }] });
    } catch (e) {
      setError((e as Error).message); setErrCount((c) => c + 1);
    } finally { setBusy(false); setStep(''); }
  };

  const section = (i: number, icon: 'receipt' | 'location' | 'time', label: string, change: () => void, children: React.ReactNode) => (
    <Enter index={i}>
      <Card style={s.reviewCard}>
        <View style={s.rowHead}>
          <View style={s.headLeft}><View style={s.headIcon}><Icon name={icon} size={18} /></View><Text style={[type.h3, { color: colors.text }]}>{label}</Text></View>
          <Tap accessibilityRole="button" onPress={change} haptic={false}><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('common.change')}</Text></Tap>
        </View>
        {children}
      </Card>
    </Enter>
  );
  const count = prescriptions.length || medicines.length;
  return (
    <Screen footer={<Button title={busy && step ? step : t('review.send')} icon="paper-plane" onPress={submit} loading={busy} disabled={!ready} />}>
      <Enter><CheckoutSteps step={2} labels={[t('steps.address'), t('steps.time'), t('steps.review')]} /></Enter>
      {section(1, 'receipt', t('review.items', { count }), () => goTo(navigation, 'Tabs', { screen: 'Cart' }), <>
        {prescriptions.map((f, i) => <Text key={f.id} style={[type.body, { color: colors.text }]}>• {t('cart.prescription')} {i + 1} <Text style={{ color: colors.secondary }}>({f.name})</Text></Text>)}
        {medicines.map((m) => <Text key={m.id} style={[type.body, { color: colors.text }]}>• {m.name} × {m.quantity}</Text>)}
        {note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {note}</Text> : null}
      </>)}
      {section(2, 'location', t('review.address'), () => goTo(navigation, 'Addresses', { select: true }), address ? <>
        <Text style={[type.bodyMedium, { color: colors.text }]}>{address.recipientName} · {address.phone}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>{[address.line1, address.line2, address.landmark].filter(Boolean).join(', ')}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>{address.city} - {address.pincode}</Text></> : <Text style={[type.body, { color: colors.red }]}>{t('review.noAddress')}</Text>)}
      {section(3, 'time', t('review.time'), () => goTo(navigation, 'DeliveryTime'), checkout.date ? <Text style={[type.body, { color: colors.text }]}>{formatDate(checkout.date)}</Text> : <Text style={[type.body, { color: colors.red }]}>{t('review.noTime')}</Text>)}
      <Enter index={4}><View style={s.info}><Icon name="information-circle" size={22} /><Text style={[type.small, { flex: 1, color: colors.text }]}>{t('review.info')}</Text></View></Enter>
      <Animated.View style={shake}>{error ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{error}</Animated.Text> : null}</Animated.View>
    </Screen>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const R = 52, CIRC = 2 * Math.PI * R;

/** Ring draws itself, the disc fills, then the check pops in with a spring. */
function DrawnCheck() {
  const ring = useSharedValue(CIRC);
  const fill = useSharedValue(0);
  const pop = useSharedValue(0);
  useEffect(() => {
    ring.value = withTiming(0, { duration: 650, easing: Easing.out(Easing.cubic) });
    fill.value = withDelay(450, withTiming(1, { duration: 300 }));
    pop.value = withDelay(620, withSpring(1, { damping: 7, stiffness: 180 }));
  }, [ring, fill, pop]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: ring.value }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: interpolate(fill.value, [0, 1], [0.6, 1]) }] }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 1.5), transform: [{ scale: interpolate(pop.value, [0, 1], [0.2, 1]) }, { rotate: `${interpolate(pop.value, [0, 1], [-25, 0])}deg` }] }));
  return (
    <View style={s.checkWrap}>
      <Ripples size={150} color={colors.green} count={3} />
      <Animated.View style={[s.checkFill, fillStyle]} />
      <Svg width={140} height={140} viewBox="0 0 140 140" style={{ position: 'absolute' }}>
        <AnimatedCircle cx={70} cy={70} r={R} stroke={colors.green} strokeWidth={6} strokeLinecap="round" fill="none" strokeDasharray={CIRC} animatedProps={ringProps} />
      </Svg>
      <Animated.View style={checkStyle}><Icon name="checkmark" size={64} color={colors.green} /></Animated.View>
    </View>
  );
}

const CONFETTI = [colors.primary, colors.green, '#F5A623', colors.red, '#7C5CFF', '#00B8D9'];
function Piece({ i }: { i: number }) {
  const cfg = useMemo(() => {
    const angle = (i / 28) * Math.PI * 2 + (i % 3) * 0.2;
    const dist = 110 + ((i * 37) % 90);
    return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist - 40, rot: ((i * 53) % 540) - 270, color: CONFETTI[i % CONFETTI.length], w: 6 + (i % 3) * 3, h: 9 + (i % 4) * 3, round: i % 4 === 0 };
  }, [i]);
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(520 + (i % 6) * 25, withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) })); }, [p, i]);
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.1, 0.75, 1], [0, 1, 1, 0]),
    transform: [{ translateX: cfg.dx * p.value }, { translateY: cfg.dy * p.value + 120 * p.value * p.value }, { rotate: `${cfg.rot * p.value}deg` }, { scale: interpolate(p.value, [0, 0.2, 1], [0.2, 1, 0.8]) }],
  }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: cfg.w, height: cfg.h, backgroundColor: cfg.color, borderRadius: cfg.round ? 6 : 2 }, a]} />;
}

export function SuccessScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Success'>) {
  const { t } = useTranslation();
  const { orderId, orderNumber } = route.params;
  const [copied, setCopied] = useState(false);
  useEffect(() => { const id = setTimeout(() => tick('success'), 600); return () => clearTimeout(id); }, []);
  const next = [
    { icon: 'search' as const, text: t('success.next1') },
    { icon: 'pricetag' as const, text: t('success.next2') },
    { icon: 'bicycle' as const, text: t('success.next3') },
  ];
  return (
    <SafeAreaView style={s.successFill}>
      <View style={s.confettiOrigin} pointerEvents="none">{Array.from({ length: 28 }, (_, i) => <Piece key={i} i={i} />)}</View>
      <DrawnCheck />
      <Animated.Text entering={FadeInDown.delay(900).duration(500).springify().damping(14)} style={[type.h1, { color: colors.text, textAlign: 'center', marginTop: spacing.md }]}>{t('success.title')}</Animated.Text>
      <Animated.Text entering={FadeInDown.delay(1000).duration(500)} style={[type.body, { color: colors.secondary, textAlign: 'center', marginTop: spacing.sm }]}>{t('success.sub')}</Animated.Text>

      <Animated.View entering={ZoomIn.delay(1100).duration(450).springify().damping(12)} style={{ alignSelf: 'stretch' }}>
        <Tap accessibilityRole="button" accessibilityLabel={t('success.copy')} onPress={async () => { await Clipboard.setStringAsync(orderNumber); setCopied(true); }} style={s.orderBoxShadow}>
          <LinearGradient colors={[colors.white, colors.card]} style={s.orderBox}>
            <Icon name="receipt-outline" size={24} color={colors.navy} />
            <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{t('success.orderNo')}</Text><Text style={[type.h3, { color: colors.text }]}>#{orderNumber}</Text></View>
            <Icon name={copied ? 'checkmark-circle' : 'copy-outline'} size={22} color={copied ? colors.green : colors.primary} />
          </LinearGradient>
        </Tap>
      </Animated.View>

      <View style={s.next}>
        {next.map((n, i) => (
          <Animated.View key={n.text} entering={FadeInDown.delay(1300 + i * 160).duration(450)} style={s.nextRow}>
            <View style={s.nextIcon}><Icon name={n.icon} size={18} /></View>
            <Text style={[type.small, { color: colors.text, flex: 1 }]}>{n.text}</Text>
          </Animated.View>
        ))}
      </View>

      <Animated.View entering={FadeIn.delay(1800).duration(500)} style={{ alignSelf: 'stretch' }}>
        <Button title={t('success.track')} icon="navigate" onPress={() => navigation.replace('OrderDetail', { orderId })} />
        <Button title={t('success.home')} variant="outline" onPress={() => navigation.navigate('Tabs', { screen: 'Home' })} style={{ marginTop: spacing.md }} />
      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  days: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
  day: { alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, borderWidth: 1 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  free: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#EFFAF3' },
  reviewCard: { marginBottom: spacing.md, backgroundColor: colors.white, boxShadow: '0px 4px 14px rgba(15,33,71,0.07)' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  info: { flexDirection: 'row', gap: 10, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#E7F5EC', alignItems: 'center' },
  successFill: { flex: 1, backgroundColor: colors.white, padding: spacing.xl, justifyContent: 'center', alignItems: 'center' },
  confettiOrigin: { position: 'absolute', top: '24%', left: '50%', width: 1, height: 1 },
  checkWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  checkFill: { position: 'absolute', width: 104, height: 104, borderRadius: 52, backgroundColor: colors.greenBg },
  orderBoxShadow: { marginTop: spacing.xl, borderRadius: radius.lg, boxShadow: '0px 8px 20px rgba(11,95,219,0.12)' },
  orderBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder },
  next: { alignSelf: 'stretch', gap: 10, marginVertical: spacing.xl },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
