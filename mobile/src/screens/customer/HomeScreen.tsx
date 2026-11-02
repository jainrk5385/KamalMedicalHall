import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { AnnouncementSlider } from '../../components/AnnouncementSlider';
import { OrderCard } from '../../components/OrderCard';
import { Skeleton, Tap } from '../../components/motion';
import { ErrorView, Icon, ResponsiveGrid } from '../../components/ui';
import { useContentStyle } from '../../layout';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';

function Bell({ unread, onPress, label }: { unread: number; onPress: () => void; label: string }) {
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={s.bell}>
      <Icon name="notifications" size={26} color={colors.navy} />
      {unread > 0 ? <View style={s.badge}><Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}
    </Tap>
  );
}

export function HomeScreen(_props: BottomTabScreenProps<CustomerTabParamList, 'Home'>) {
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const content = useContentStyle(true);
  const user = useSession((st) => st.user);
  const active = useLoad(() => endpoints.orders('active'), ['order:update']);
  const unread = useLoad(async () => (await endpoints.notifications()).notifications.filter((n) => !n.read).length, ['notification']);
  const shop = useLoad(() => endpoints.shop());
  const ann = useLoad(() => endpoints.announcements(), ['announcement:update']);
  const [refreshing, setRefreshing] = useState(false);
  const slides = (ann.data?.announcements ?? []).filter((a) => a.hasImages);
  const shopPhone = shop.data?.phones?.find((p) => p.number)?.number ?? shop.data?.legacy.phone ?? null;
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([active.reload(), unread.reload(), shop.reload(), ann.reload()]); }
    finally { setRefreshing(false); }
  };

  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <ScrollView contentContainerStyle={[s.body, content]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <View style={s.loc}><Text numberOfLines={2} style={[type.h2, { color: colors.navy }]}>{t('brand.name')}</Text></View>
          <View style={s.topActions}>
            {shopPhone ? <Tap accessibilityRole="button" accessibilityLabel={t('shop.callShop')} onPress={() => { void Linking.openURL(`tel:${shopPhone}`); }} hitSlop={10} style={s.callIcon}><Icon name="call" size={22} color={colors.green} /></Tap> : null}
            <Bell unread={unread.data ?? 0} onPress={() => nav.navigate('Notifications')} label={t('home.notifications')} />
          </View>
        </View>
        <Text style={[type.h2, { marginTop: spacing.lg, color: colors.text }]}>{user?.name ? t('home.greetingName', { name: user.name.split(' ')[0] }) : t('home.greeting')}</Text>
        <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.lg }]}>{t('home.help')}</Text>

        {shop.error ? <ErrorView message={shop.error} onRetry={shop.reload} retryLabel={t('common.retry')} /> : null}
        {ann.error ? <ErrorView message={ann.error} onRetry={ann.reload} retryLabel={t('common.retry')} /> : null}
        {unread.error ? <ErrorView message={unread.error} onRetry={unread.reload} retryLabel={t('common.retry')} /> : null}

        <AnnouncementSlider items={slides} onOpen={(a) => nav.navigate('Announcement', { id: a.id })} />

        <Tap onPress={() => nav.navigate('Upload')} style={s.actionShadow} accessibilityRole="button" accessibilityLabel={t('home.uploadTitle')}>
          <LinearGradient colors={[colors.card, '#DCEBFB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.action}>
            <View style={s.iconPuck}><Icon name="camera" size={30} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, { color: colors.text }]}>{t('home.uploadTitle')}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{t('home.uploadSubtitle')}</Text>
            </View>
            <View style={s.chev}><Icon name="chevron-forward" size={20} color={colors.white} /></View>
          </LinearGradient>
        </Tap>

        {active.error && active.data ? <ErrorView message={active.error} onRetry={active.reload} retryLabel={t('common.retry')} /> : null}
        {!active.data && active.loading ? <View style={{ gap: 12, marginTop: spacing.xl }}><Skeleton h={22} w="45%" /><Skeleton h={104} r={16} /></View> : active.error && !active.data ? <ErrorView message={active.error} onRetry={active.reload} retryLabel={t('common.retry')} /> : (active.data?.orders.length ?? 0) > 0 ? <>
          <Text style={[type.h3, s.section]}>{t('home.activeOrders')}</Text>
          <ResponsiveGrid>{active.data!.orders.map((o, i) => <OrderCard key={o.id} order={o} index={i} onPress={() => (o.status === 'out_for_delivery' ? nav.navigate('Track', { orderId: o.id }) : nav.navigate('OrderDetail', { orderId: o.id }))} />)}</ResponsiveGrid>
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loc: { flex: 1, marginRight: spacing.md },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  callIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenBg, alignItems: 'center', justifyContent: 'center' },
  bell: { padding: 4 },
  badge: { position: 'absolute', right: -2, top: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 10, lineHeight: 14, fontFamily: 'NotoSansDevanagari_700Bold' },
  actionShadow: { marginBottom: spacing.md, borderRadius: radius.lg, boxShadow: '0px 8px 20px rgba(11,95,219,0.12)' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 112, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder },
  iconPuck: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 4px 10px rgba(15,33,71,0.10)' },
  chev: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  section: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
});
