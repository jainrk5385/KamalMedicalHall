import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { endpoints } from '../../api/endpoints';
import type { OrderStatus } from '../../api/types';
import { Avatar } from '../../components/CallButton';
import { LiveMap } from '../../components/LiveMap';
import { CountUp, Enter, Ripples, Skeleton } from '../../components/motion';
import { Button, ErrorView, Icon, type IconName } from '../../components/ui';
import { useLoad } from '../../hooks';
import { useLayout } from '../../layout';
import type { CustomerStackParamList } from '../../navigation/types';
import { onRealtime } from '../../realtime';
import { colors, radius, spacing, type } from '../../theme';

const STEPS: { key: string; icon: IconName; label: string; sub: string }[] = [
  { key: 'confirmed', icon: 'checkmark-circle', label: 'live.stepConfirmed', sub: 'live.stepConfirmedSub' },
  { key: 'packed', icon: 'cube', label: 'live.stepPacked', sub: 'live.stepPackedSub' },
  { key: 'ride', icon: 'bicycle', label: 'live.stepRide', sub: 'live.stepRideSub' },
  { key: 'done', icon: 'home', label: 'live.stepDone', sub: 'live.stepDoneSub' },
];
const stageOf = (status: OrderStatus, accepted: boolean) => (status === 'delivered' ? 3 : status === 'out_for_delivery' ? 2 : accepted ? 1 : 0);

function Step({ i, stage, label, sub, icon }: { i: number; stage: number; label: string; sub: string; icon: IconName }) {
  const done = i < stage, on = i === stage, last = i === STEPS.length - 1;
  const fill = useSharedValue(0);
  useEffect(() => { fill.value = withDelay(i * 120, withTiming(done ? 1 : 0, { duration: 500 })); }, [done, i, fill]);
  const line = useAnimatedStyle(() => ({ height: `${fill.value * 100}%` }));
  return (
    <View style={s.stepRow}>
      <View style={s.railCol}>
        <View style={[s.dot, (done || on) && s.dotOn, on && { backgroundColor: colors.amber, borderColor: colors.amber }]}>
          {on ? <Ripples size={36} color={colors.amber} count={2} /> : null}
          <Icon name={done ? 'checkmark' : icon} size={16} color={done || on ? colors.white : colors.muted} />
        </View>
        {!last ? <View style={s.rail}><Animated.View style={[s.railFill, line]} /></View> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : spacing.lg }}>
        <Text style={[type.bodyMedium, { color: done || on ? colors.text : colors.muted }]}>{label}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{sub}</Text>
      </View>
    </View>
  );
}

export function TrackScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Track'>) {
  const { t } = useTranslation();
  const { orderId } = route.params;
  const { isDesktop, height } = useLayout();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.tracking(orderId), ['order:update']);
  const order = useLoad(() => endpoints.order(orderId), ['order:update']);
  const store = useLoad(() => endpoints.config());
  const [now, setNow] = useState(Date.now());

  useEffect(() => onRealtime('partner:location', (p: { orderId: string; lat: number; lng: number; etaMinutes: number | null; at: string }) => {
    if (p.orderId !== orderId) return;
    setData((prev) => (prev ? { ...prev, rider: { lat: p.lat, lng: p.lng, updatedAt: p.at }, etaMinutes: p.etaMinutes ?? prev.etaMinutes } : prev));
  }), [orderId, setData]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(id); }, []);

  const mapData = useMemo(() => ({ store: data?.store ?? null, destination: data?.destination ?? null, rider: data?.rider ?? null }), [data]);
  const mapHeight = isDesktop ? undefined : Math.max(240, Math.min(420, Math.round(height * 0.42)));

  if (loading && !data) return <View style={{ padding: spacing.lg, gap: 14 }}><Skeleton h={260} r={16} /><Skeleton h={30} w="60%" /><Skeleton h={90} r={16} /></View>;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const tr = data!;
  const accepted = order.data?.order.partnerAccepted ?? Boolean(tr.partner);
  const stage = stageOf(tr.status, accepted);
  const name = tr.partner?.name ?? t('live.yourPartner');
  const headline = tr.status === 'delivered' ? t('live.delivered')
    : tr.status === 'out_for_delivery' ? (tr.etaMinutes != null ? t('live.arriving', { min: tr.etaMinutes }) : t('live.onTheWay'))
    : accepted ? t('live.assigned', { name }) : t('live.packing');
  const sub = tr.status === 'delivered' ? t('live.deliveredSub') : tr.status === 'out_for_delivery' ? t('live.onTheWaySub', { name }) : accepted ? t('live.assignedSub') : t('live.packingSub');
  const seconds = tr.rider ? Math.max(0, Math.round((now - new Date(tr.rider.updatedAt).getTime()) / 1000)) : null;
  const hasMap = Boolean(tr.store || tr.destination);
  const phone = store.data?.store.phone;

  const sheet = (
    <ScrollView style={[s.sheet, isDesktop && s.sheetDesktop]} contentContainerStyle={s.sheetBody} showsVerticalScrollIndicator={false}>
      <View style={s.grab} />
      {order.error ? <ErrorView message={order.error} onRetry={order.reload} retryLabel={t('common.retry')} /> : null}
      {store.error ? <ErrorView message={store.error} onRetry={store.reload} retryLabel={t('common.retry')} /> : null}
      <Enter index={0}>
        <View style={s.headRow}>
          <View style={{ flex: 1 }}>
            {tr.status === 'out_for_delivery' && tr.etaMinutes != null ? (
              <View style={s.etaRow}><Text style={[type.h1, { color: colors.text }]}>{t('live.arrivingIn')} </Text><CountUp value={tr.etaMinutes} style={[type.h1, { color: colors.primary }]} duration={600} /><Text style={[type.h1, { color: colors.primary }]}> {t('live.min')}</Text></View>
            ) : <Text style={[type.h1, { color: colors.text }]}>{headline}</Text>}
            <Text style={[type.body, { color: colors.secondary }]}>{sub}</Text>
          </View>
          <View style={[s.badge, tr.status === 'delivered' && { backgroundColor: colors.greenBg }]}><Icon name={tr.status === 'delivered' ? 'checkmark-done' : tr.status === 'out_for_delivery' ? 'bicycle' : 'cube'} size={26} color={tr.status === 'delivered' ? colors.green : colors.primary} /></View>
        </View>
      </Enter>

      {accepted && tr.partner ? (
        <Enter index={1}>
          <View style={s.rider}>
            <Avatar name={tr.partner.name} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>{t('live.riderHeading', { name: tr.partner.name })}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{seconds != null ? t('live.updated', { when: seconds < 10 ? t('live.justNow') : seconds < 90 ? t('live.secondsAgo', { n: seconds }) : t('live.minutesAgo', { n: Math.round(seconds / 60) }) }) : t('live.waitingRide')}</Text>
            </View>
          </View>
        </Enter>
      ) : null}

      <Enter index={2}>
        <Text style={[type.h3, s.sec]}>{t('live.progress')}</Text>
        {STEPS.map((st, i) => <Step key={st.key} i={i} stage={stage} icon={st.icon} label={t(st.label)} sub={t(st.sub)} />)}
      </Enter>

      {order.data ? (
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={s.summary}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>#{order.data.order.orderNumber}</Text>
          <Text style={[type.small, { color: colors.secondary }]}>{[order.data.order.address.line1, order.data.order.address.landmark].filter(Boolean).join(', ')} · {order.data.order.address.pincode}</Text>
        </Animated.View>
      ) : null}
      {phone ? <Button title={t('order.callStore')} variant="outline" icon="call" onPress={() => Linking.openURL(`tel:${phone}`)} style={{ marginTop: spacing.md }} /> : null}
      <Button title={t('live.viewOrder')} variant="ghost" onPress={() => navigation.navigate('OrderDetail', { orderId })} />
    </ScrollView>
  );

  return (
    <View style={[s.root, isDesktop && { flexDirection: 'row' }]}>
      <View style={[hasMap ? undefined : s.noMap, isDesktop ? { flex: 1 } : { height: mapHeight }]}>
        {hasMap ? <LiveMap data={mapData} style={{ flex: 1 }} /> : <View style={s.noMapInner}><Icon name="map-outline" size={40} color={colors.muted} /><Text style={[type.body, { color: colors.secondary, textAlign: 'center' }]}>{t('live.noMap')}</Text></View>}
      </View>
      {sheet}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  noMap: { backgroundColor: colors.card },
  noMapInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: spacing.xl },
  sheet: { flex: 1, marginTop: -22, backgroundColor: colors.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, boxShadow: '0px -8px 24px rgba(15,33,71,0.14)' },
  sheetDesktop: { marginTop: 0, maxWidth: 440, borderRadius: 0, flexGrow: 0, flexBasis: 440 },
  sheetBody: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  badge: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  rider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  stepRow: { flexDirection: 'row', gap: 14 },
  railCol: { alignItems: 'center', width: 34 },
  dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  dotOn: { backgroundColor: colors.green, borderColor: colors.green },
  rail: { position: 'absolute', top: 34, bottom: -4, width: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  railFill: { width: 4, backgroundColor: colors.green },
  summary: { marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card },
});
void withSpring;
