import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import type { ShopBranch, ShopPublic } from '../../api/types';
import { Skeleton, Tap } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Pill } from '../../components/ui';
import { useLoad } from '../../hooks';
import { useContentStyle } from '../../layout';
import { colors, radius, spacing, type } from '../../theme';

const open = (url: string) => { void Linking.openURL(url); };
const mapsFor = (q: string, lat?: number | null, lng?: number | null) => (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`);
const waLink = (n: string) => { const d = n.replace(/\D/g, ''); return `https://wa.me/${d.length === 10 ? `91${d}` : d}`; };
const show = (n: string) => n.replace(/^(\+91)?(\d{5})(\d{5})$/, (_m, c, a, b) => `${c ? '+91 ' : ''}${a} ${b}`);

/** "About the shop": address, ways to reach it (one tap to call), licences and branches. Everything the admin left blank is simply not shown. */
export function ShopScreen() {
  const { t } = useTranslation();
  const content = useContentStyle(true);
  const { data, error, loading, reload } = useLoad(() => endpoints.shop(), ['store:update']);
  if (loading && !data) return <View style={{ padding: spacing.lg, gap: 12 }}><Skeleton h={150} r={24} /><Skeleton h={96} r={16} /><Skeleton h={120} r={16} /><Skeleton h={120} r={16} /></View>;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const d: ShopPublic = data!;
  const a = d.address ?? {};
  const addressText = [a.line1, a.line2, a.area, a.landmark ? `${t('shop.near')} ${a.landmark}` : '', [a.city, a.state].filter(Boolean).join(', '), a.pincode].filter(Boolean).join('\n') || d.legacy.address || '';
  const mapQuery = [a.line1, a.area, a.city, a.pincode].filter(Boolean).join(', ') || d.legacy.address || '';
  const phones = d.phones?.filter((p) => p.number) ?? (d.legacy.phone ? [{ label: '', number: d.legacy.phone }] : []);
  const mainPhone = phones[0]?.number ?? d.legacy.phone ?? undefined;
  const email = d.email ?? d.legacy.email ?? undefined;
  const lat = d.latitude ?? d.legacy.latitude, lng = d.longitude ?? d.legacy.longitude;
  const l = d.licence ?? {};
  const licenceRows: [string, string | undefined][] = [
    [t('shop.dl1'), l.drugLicense1], [t('shop.dl2'), l.drugLicense2], [t('shop.dlValid'), l.drugLicenseValidTill],
    [t('shop.pharmacist'), l.pharmacistName], [t('shop.pharmacistReg'), l.pharmacistRegNo], [t('shop.gstin'), l.gstin], [t('shop.fssai'), l.fssai],
  ];
  const shownLicences = licenceRows.filter(([, v]) => v);
  const hasDirections = Boolean(mapQuery || (lat != null && lng != null));

  return (
    <ScrollView contentContainerStyle={[s.body, content]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
      {error ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : null}
      <LinearGradient colors={[colors.navy, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <Text style={[type.h2, { color: colors.white }]}>{d.name ?? t('brand.name')}</Text>
        {d.tagline ? <Text style={[type.body, { color: 'rgba(255,255,255,0.85)' }]}>{d.tagline}</Text> : null}
        <View style={s.heroMeta}>
          <Pill text={d.isOpen ? t('shop.openNow') : t('shop.closedNow')} tone={d.isOpen ? 'green' : 'red'} />
          <Text style={[type.small, { color: 'rgba(255,255,255,0.85)', flexShrink: 1 }]}>{d.openingTime} – {d.closingTime}</Text>
        </View>
        {d.hoursNote ? <Text style={[type.small, { color: 'rgba(255,255,255,0.8)' }]}>{d.hoursNote}</Text> : null}
        {mainPhone ? <Button title={t('shop.callShop')} icon="call" onPress={() => open(`tel:${mainPhone}`)} style={s.callBig} /> : null}
      </LinearGradient>

      {hasDirections || addressText ? (
        <Card style={s.card}>
          <View style={s.row}><View style={s.puck}><Icon name="location" size={20} color={colors.primary} /></View><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('shop.address')}</Text></View>
          <Text style={[type.body, { color: colors.text, marginTop: spacing.sm }]} selectable>{addressText}</Text>
          {hasDirections ? <Button title={t('shop.directions')} icon="navigate" variant="outline" onPress={() => open(d.mapsUrl || (Platform.OS === 'ios' ? `http://maps.apple.com/?q=${encodeURIComponent(mapQuery)}` : mapsFor(mapQuery, lat, lng)))} style={{ marginTop: spacing.md }} /> : null}
        </Card>
      ) : null}

      {phones.length || d.whatsapp || email || d.website || d.social?.facebook || d.social?.instagram ? (
        <Card style={s.card}>
          <View style={s.row}><View style={s.puck}><Icon name="call" size={20} color={colors.primary} /></View><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('shop.contact')}</Text></View>
          {phones.map((p, i) => <ContactRow key={`${p.number}${i}`} icon="call-outline" label={p.label || t('shop.phone')} value={show(p.number!)} onPress={() => open(`tel:${p.number}`)} action={t('shop.call')} />)}
          {d.whatsapp ? <ContactRow icon="logo-whatsapp" label="WhatsApp" value={show(d.whatsapp)} onPress={() => open(waLink(d.whatsapp!))} action={t('shop.chat')} /> : null}
          {email ? <ContactRow icon="mail-outline" label={t('shop.email')} value={email} onPress={() => open(`mailto:${email}`)} action={t('shop.write')} /> : null}
          {d.website ? <ContactRow icon="globe-outline" label={t('shop.website')} value={d.website.replace(/^https?:\/\//, '')} onPress={() => open(d.website!)} action={t('shop.visit')} /> : null}
          {d.social?.facebook ? <ContactRow icon="logo-facebook" label="Facebook" value={d.social.facebook.replace(/^https?:\/\/(www\.)?/, '')} onPress={() => open(d.social!.facebook!)} action={t('shop.visit')} /> : null}
          {d.social?.instagram ? <ContactRow icon="logo-instagram" label="Instagram" value={d.social.instagram.replace(/^https?:\/\/(www\.)?/, '')} onPress={() => open(d.social!.instagram!)} action={t('shop.visit')} /> : null}
        </Card>
      ) : null}

      {d.about || d.ownerName || d.establishedYear ? (
        <Card style={s.card}>
          <View style={s.row}><View style={s.puck}><Icon name="information-circle" size={20} color={colors.primary} /></View><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('shop.aboutUs')}</Text></View>
          {d.about ? <Text style={[type.body, { color: colors.text, marginTop: spacing.sm }]}>{d.about}</Text> : null}
          {d.ownerName ? <Text style={[type.small, { color: colors.secondary, marginTop: spacing.sm }]}>{t('shop.owner')}: {d.ownerName}</Text> : null}
          {d.establishedYear ? <Text style={[type.small, { color: colors.secondary }]}>{t('shop.since')}: {d.establishedYear}</Text> : null}
        </Card>
      ) : null}

      {d.services?.length || d.paymentModes?.length ? (
        <Card style={s.card}>
          <View style={s.row}><View style={s.puck}><Icon name="medkit" size={20} color={colors.primary} /></View><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('shop.secServices')}</Text></View>
          {d.services?.length ? <View style={s.chips}>{d.services.map((x) => <View key={x} style={s.chip}><Icon name="checkmark-circle" size={16} color={colors.green} /><Text style={[type.small, { color: colors.text, flexShrink: 1 }]}>{x}</Text></View>)}</View> : null}
          {d.paymentModes?.length ? <><Text style={[type.smallMedium, { color: colors.secondary, marginTop: spacing.md }]}>{t('shop.payments')}</Text><Text style={[type.body, { color: colors.text }]}>{d.paymentModes.join(' · ')}</Text></> : null}
        </Card>
      ) : null}

      {shownLicences.length ? (
        <Card style={s.card}>
          <View style={s.row}><View style={s.puck}><Icon name="shield-checkmark" size={20} color={colors.primary} /></View><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('shop.secLicence')}</Text></View>
          {shownLicences.map(([k, v]) => (
            <View key={k} style={s.kv}><Text style={[type.small, { color: colors.secondary }]}>{k}</Text><Text style={[type.bodyMedium, { color: colors.text }]} selectable>{v}</Text></View>
          ))}
        </Card>
      ) : null}

      {d.branches?.length ? (
        <>
          <Text style={[type.h3, s.sec]}>{t('shop.secBranches')}</Text>
          {d.branches.map((b, i) => <Branch key={`${b.name}${i}`} b={b} />)}
        </>
      ) : null}
    </ScrollView>
  );
}

function ContactRow({ icon, label, value, onPress, action }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string; onPress: () => void; action: string }) {
  return (
    <Tap accessibilityRole="button" accessibilityLabel={`${action} ${label} ${value}`} onPress={onPress} style={s.contactRow}>
      <Icon name={icon} size={22} color={colors.navy} />
      <View style={{ flex: 1 }}>
        <Text style={[type.small, { color: colors.secondary }]} numberOfLines={1}>{label}</Text>
        <Text style={[type.bodyMedium, { color: colors.text }]}>{value}</Text>
      </View>
      <Text style={[type.smallMedium, { color: colors.primary }]}>{action}</Text>
    </Tap>
  );
}

function Branch({ b }: { b: ShopBranch }) {
  const { t } = useTranslation();
  const q = [b.address, b.city, b.pincode].filter(Boolean).join(', ');
  return (
    <Card style={s.card}>
      <Text style={[type.h3, { color: colors.text }]}>{b.name || t('shop.branch')}</Text>
      {q ? <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{q}</Text> : null}
      {b.hours ? <Text style={[type.small, { color: colors.secondary, marginTop: 4 }]}>{b.hours}</Text> : null}
      <View style={s.branchBtns}>
        {b.phone ? <View style={s.branchBtn}><Button small title={t('shop.call')} icon="call" onPress={() => open(`tel:${b.phone}`)} /></View> : null}
        {q || b.mapsUrl ? <View style={s.branchBtn}><Button small variant="outline" title={t('shop.directions')} icon="navigate" onPress={() => open(b.mapsUrl || mapsFor(q, b.latitude, b.longitude))} /></View> : null}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  hero: { borderRadius: 24, padding: spacing.lg, gap: 8 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  callBig: { marginTop: spacing.sm, backgroundColor: colors.green },
  card: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, maxWidth: '100%' },
  kv: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 },
  sec: { color: colors.text, marginTop: spacing.sm },
  branchBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: spacing.md },
  branchBtn: { flexGrow: 1, flexBasis: 140 },
});
