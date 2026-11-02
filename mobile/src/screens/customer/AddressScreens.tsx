import { useErrorPopup } from '../../hooks';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOutLeft, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { endpoints } from '../../api/endpoints';
import type { Address } from '../../api/types';
import { Enter, Skeleton, Tap, tick } from '../../components/motion';
import { Button, Card, CheckoutSteps, ErrorView, Icon, Message, Screen, TextField, type IconName } from '../../components/ui';
import { usePincodes } from '../../store/pincodes';
import { confirmAsync } from '../../dialog';
import { useLoad } from '../../hooks';
import { goTo } from '../../navigation/helpers';
import type { CustomerStackParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';

const LABEL_ICON: Record<Address['label'], IconName> = { home: 'home', office: 'briefcase', other: 'location' };
const line = (a: Address) => [a.line1, a.line2, a.landmark].filter(Boolean).join(', ');

export function AddressesScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Addresses'>) {
  const { t } = useTranslation();
  const select = route.params?.select ?? false;
  const selected = useCart((st) => st.checkout.id);
  const setAddress = useCart((st) => st.setAddress);
  const { data, error, loading, reload } = useLoad(() => endpoints.addresses());
  const list = data?.addresses ?? [];

  useEffect(() => {
    if (select && list.length && !list.some((a) => a.id === selected)) setAddress(list[0].id);
  }, [select, list, selected, setAddress]);

  const remove = async (a: Address) => {
    if (!(await confirmAsync(t('address.deleteTitle'), t('address.deleteMsg'), t('common.delete'), t('common.cancel'), true))) return;
    try { await endpoints.deleteAddress(a.id); tick(); void reload(); } catch (e) { await confirmAsync(t('common.error'), (e as Error).message, t('common.ok'), t('common.cancel')); }
  };

  if (loading && !data) return <View style={{ padding: spacing.lg, gap: 14 }}><Skeleton h={90} r={16} /><Skeleton h={90} r={16} /></View>;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  return (
    <Screen footer={select ? <Button title={t('address.chooseTime')} icon="arrow-forward" disabled={!list.length || !selected} onPress={() => goTo(navigation, 'DeliveryTime')} /> : undefined}>
      {error ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : null}
      {select ? <Enter><CheckoutSteps step={0} labels={[t('steps.address'), t('steps.time'), t('steps.review')]} /></Enter> : null}
      {!list.length ? <View style={{ height: 260 }}><Message icon="location-outline" title={t('address.emptyTitle')} text={t('address.empty')} /></View> : null}
      {list.map((a, i) => {
        const on = select && selected === a.id;
        return (
          <Animated.View key={a.id} entering={FadeInDown.delay(i * 70).duration(420).springify().damping(18)} exiting={FadeOutLeft.duration(250)} layout={LinearTransition.springify().damping(18)}>
            <Card style={[s.card, on && s.cardOn]}>
              <Tap accessibilityRole="button" onPress={select ? () => setAddress(a.id) : () => navigation.navigate('AddressForm', { addressId: a.id })} scaleTo={0.98} style={s.cardMain}>
                <View style={[s.labelIcon, on && { backgroundColor: colors.primary }]}><Icon name={LABEL_ICON[a.label]} size={22} color={on ? colors.white : colors.navy} /></View>
                <View style={{ flex: 1, marginHorizontal: spacing.md }}>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>{t(`address.labels.${a.label}`)} · {a.recipientName}</Text>
                  <Text style={[type.small, { color: colors.secondary }]}>{line(a)}</Text>
                  <Text style={[type.small, { color: colors.secondary }]}>{a.city} - {a.pincode}</Text>
                </View>
                {select ? (on ? <Animated.View entering={ZoomIn.duration(220)}><Icon name="checkmark-circle" size={28} color={colors.primary} /></Animated.View> : <Icon name="ellipse-outline" size={28} color={colors.muted} />) : null}
              </Tap>
              <View style={s.actions}>
                <Tap accessibilityRole="button" onPress={() => navigation.navigate('AddressForm', { addressId: a.id })} hitSlop={8} haptic={false} style={s.link}><Icon name="create-outline" size={16} /><Text style={[type.smallMedium, { color: colors.primary }]}>{t('common.edit')}</Text></Tap>
                <Tap accessibilityRole="button" onPress={() => remove(a)} hitSlop={8} haptic={false} style={s.link}><Icon name="trash-outline" size={16} color={colors.red} /><Text style={[type.smallMedium, { color: colors.red }]}>{t('common.delete')}</Text></Tap>
              </View>
            </Card>
          </Animated.View>
        );
      })}
      <Enter index={list.length + 1}>
        <Tap accessibilityRole="button" onPress={() => navigation.navigate('AddressForm')} style={s.add}><View style={s.addIcon}><Icon name="add" size={22} color={colors.white} /></View><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('address.addNew')}</Text></Tap>
        <Text style={[type.small, { color: colors.secondary, marginTop: spacing.md }]}>{t('address.areaNotice')}</Text>
      </Enter>
    </Screen>
  );
}

export function AddressFormScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'AddressForm'>) {
  const { t } = useTranslation();
  const id = route.params?.addressId;
  const user = useSession((st) => st.user);
  const setAddress = useCart((st) => st.setAddress);
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState('');
  const [addressMissing, setAddressMissing] = useState(false);
  const [f, setF] = useState({ label: 'home' as Address['label'], recipientName: user?.name ?? '', phone: user?.phone ?? '', line1: '', line2: '', landmark: '', pincode: '' });
  const [coords, setCoords] = useState<{ latitude?: number; longitude?: number }>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useErrorPopup(Object.values(errors)[0]);
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const isServiceable = usePincodes((st) => st.isServiceable);
  useEffect(() => { void usePincodes.getState().load(); }, []);
  const phoneRef = useRef<TextInput>(null);
  const line1Ref = useRef<TextInput>(null);
  const line2Ref = useRef<TextInput>(null);
  const landmarkRef = useRef<TextInput>(null);
  const pinRef = useRef<TextInput>(null);
  const set = (k: keyof typeof f) => (v: string) => { setF((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };

  const loadAddress = useCallback(async () => {
    if (!id) return;
    setLoaded(false); setLoadError(''); setAddressMissing(false);
    try {
      const { addresses } = await endpoints.addresses();
      const a = addresses.find((x) => x.id === id);
      if (!a) { setAddressMissing(true); setLoadError(t('address.loadMissing')); return; }
      setF({ label: a.label, recipientName: a.recipientName, phone: a.phone, line1: a.line1, line2: a.line2 ?? '', landmark: a.landmark ?? '', pincode: a.pincode });
      setCoords({ latitude: a.latitude ?? undefined, longitude: a.longitude ?? undefined });
    } catch (e) {
      setLoadError((e as Error).message || t('address.loadFailed'));
    } finally { setLoaded(true); }
  }, [id, t]);

  useEffect(() => { void loadAddress(); }, [loadAddress]);

  const useGps = async () => {
    setGpsBusy(true); setGpsError('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return setGpsError(t('address.gpsDenied'));
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      const [p] = await Location.reverseGeocodeAsync(pos.coords);
      if (!p) return setGpsError(t('address.gpsFailed'));
      setF((c) => ({ ...c, line1: c.line1 || [p.streetNumber, p.street].filter(Boolean).join(' ') || p.name || '', line2: c.line2 || p.district || p.subregion || '', pincode: p.postalCode ?? c.pincode }));
      tick('success');
    } catch { setGpsError(t('address.gpsFailed')); } finally { setGpsBusy(false); }
  };

  const pinState = f.pincode.length === 6 ? (isServiceable(f.pincode) ? 'ok' : 'bad') : 'none';
  const save = async () => {
    const e: Record<string, string> = {};
    if (f.recipientName.trim().length < 2) e.recipientName = t('validation.name');
    if (!/^[6-9]\d{9}$/.test(f.phone)) e.phone = t('auth.invalidPhone');
    if (f.line1.trim().length < 3) e.line1 = t('validation.address');
    if (!/^\d{6}$/.test(f.pincode)) e.pincode = t('validation.pincode');
    else if (!isServiceable(f.pincode)) e.pincode = t('validation.unsupportedPincode');
    setErrors(e);
    if (Object.keys(e).length) { tick('error'); return; }
    setBusy(true);
    const body = { label: f.label, recipientName: f.recipientName.trim(), phone: f.phone, line1: f.line1.trim(), line2: f.line2.trim() || undefined, landmark: f.landmark.trim() || undefined, pincode: f.pincode, ...coords };
    try {
      const { address } = id ? await endpoints.updateAddress(id, body) : await endpoints.addAddress(body);
      setAddress(address.id);
      tick('success');
      navigation.goBack();
    } catch (err) { setErrors({ api: (err as Error).message }); tick('error'); } finally { setBusy(false); }
  };

  if (!loaded) return <View style={{ padding: spacing.lg, gap: 14 }}><Skeleton h={44} /><Skeleton h={52} r={12} /><Skeleton h={52} r={12} /><Skeleton h={52} r={12} /></View>;
  if (id && loadError) return <ErrorView message={loadError} onRetry={() => { if (addressMissing) navigation.goBack(); else void loadAddress(); }} retryLabel={addressMissing ? t('common.back') : t('common.retry')} />;
  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter index={0}>
        <View style={s.chips}>
          {(['home', 'office', 'other'] as const).map((l) => (
            <Tap key={l} accessibilityRole="button" accessibilityState={{ selected: f.label === l }} onPress={() => setF((c) => ({ ...c, label: l }))} scaleTo={0.93} style={[s.chip, f.label === l && s.chipOn]}>
              <Icon name={LABEL_ICON[l]} size={18} color={f.label === l ? colors.white : colors.navy} /><Text style={[type.smallMedium, { color: f.label === l ? colors.white : colors.navy }]}>{t(`address.labels.${l}`)}</Text>
            </Tap>
          ))}
        </View>
      </Enter>
      <Enter index={1}>
        <Button title={gpsBusy ? t('address.gpsBusy') : t('address.useGps')} variant="outline" icon="locate" onPress={useGps} loading={gpsBusy} style={{ marginBottom: spacing.sm }} />
        {gpsError ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginBottom: spacing.sm }]}>{gpsError}</Animated.Text> : null}
      </Enter>
      <Enter index={2}><TextField label={t('address.recipient')} value={f.recipientName} onChangeText={set('recipientName')} error={errors.recipientName} valid={f.recipientName.trim().length >= 2} autoCapitalize="words" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => phoneRef.current?.focus()} /></Enter>
      <Enter index={3}><TextField ref={phoneRef} label={t('address.phone')} value={f.phone} onChangeText={(v) => set('phone')(v.replace(/\D/g, '').slice(0, 10))} error={errors.phone} valid={/^[6-9]\d{9}$/.test(f.phone)} keyboardType="number-pad" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => line1Ref.current?.focus()} /></Enter>
      <Enter index={4}><TextField ref={line1Ref} label={t('address.line1')} value={f.line1} onChangeText={set('line1')} error={errors.line1} valid={f.line1.trim().length >= 3} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => line2Ref.current?.focus()} /></Enter>
      <Enter index={5}><TextField ref={line2Ref} label={t('address.line2')} value={f.line2} onChangeText={set('line2')} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => landmarkRef.current?.focus()} /></Enter>
      <Enter index={6}><TextField ref={landmarkRef} label={t('address.landmark')} value={f.landmark} onChangeText={set('landmark')} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => pinRef.current?.focus()} /></Enter>
      <Enter index={7}>
        <TextField ref={pinRef} label={t('address.pincode')} value={f.pincode} onChangeText={(v) => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} error={errors.pincode || (pinState === 'bad' ? t('validation.unsupportedPincode') : undefined)} valid={pinState === 'ok'}
          keyboardType="number-pad" returnKeyType="done" onSubmitEditing={save} hint={pinState === 'ok' ? t('address.deliverHere') : t('address.cityNote')} />
      </Enter>
      {errors.api ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: spacing.sm }]}>{errors.api}</Animated.Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  cardMain: { flexDirection: 'row', alignItems: 'center' },
  card: { marginBottom: spacing.md, backgroundColor: colors.white, boxShadow: '0px 4px 14px rgba(15,33,71,0.07)' },
  cardOn: { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1.5 },
  labelIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 22, marginTop: 10, marginLeft: 56 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: radius.lg, backgroundColor: colors.tint },
  addIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
