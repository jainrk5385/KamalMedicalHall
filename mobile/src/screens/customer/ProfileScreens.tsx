import { useErrorPopup } from '../../hooks';
import type { Gender } from '../../api/types';
import { DobField, GenderChips } from '../../components/forms';
import { clearOrderCache } from '../../cache';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { endpoints } from '../../api/endpoints';
import { uploadPrescription } from '../../api/upload';
import { Avatar } from '../../components/CallButton';
import { guessMime } from '../../fileKinds';
import { SourceOptions } from '../../components/SourceOptions';
import { NotificationsRow } from '../../components/NotificationsRow';
import { Enter, Tap } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Loading, Message, Screen, TextField, type IconName } from '../../components/ui';
import { formatDate } from '../../utils';
import { ApiError } from '../../api/client';
import { notice, showDialog } from '../../dialog';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

export function ProfileScreen(_p: BottomTabScreenProps<CustomerTabParamList, 'Profile'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { user, logout } = useSession();
  const deleteAccountApi = useSession((st) => st.deleteAccount);
  const logOut = async () => {
    const ok = await showDialog({ title: t('profile.logout'), message: t('profile.logoutMsg'), icon: 'log-out', tone: 'primary', confirmLabel: t('profile.logout'), cancelLabel: t('common.cancel') });
    if (ok) { await clearOrderCache(); await logout(); }
  };
  const deleteAccount = async () => {
    const ok = await showDialog({ title: t('profile.deleteTitle'), message: t('profile.deleteMsg'), icon: 'trash', tone: 'danger', confirmLabel: t('profile.deleteConfirm'), cancelLabel: t('common.cancel'), acknowledge: t('profile.deleteAck') });
    if (!ok) return;
    try { await clearOrderCache(); await deleteAccountApi(); } catch (e) { await notice(t('profile.deleteFailed'), e instanceof ApiError && e.code === 'active_orders' ? t('profile.deleteActive') : (e as Error).message, t('common.ok')); }
  };
  let rowIndex = 1;
  const row = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Enter index={rowIndex++}><Tap accessibilityRole="button" onPress={onPress} scaleTo={0.98} style={s.row}>
      <Icon name={icon} size={24} color={danger ? colors.red : colors.navy} />
      <Text style={[type.bodyMedium, { flex: 1, color: danger ? colors.red : colors.text }]}>{label}</Text>
      {!danger ? <Icon name="chevron-forward" size={20} color={colors.muted} /> : null}
    </Tap></Enter>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <Screen>
        <Enter index={0}><View style={s.avatarRow}>
          <Tap accessibilityRole="button" accessibilityLabel={t('profile.changePhoto')} onPress={() => nav.navigate('EditProfile')} haptic={false}><Avatar name={user?.name} uri={user?.avatarUrl} size={72} /></Tap>
          <View style={{ flex: 1 }}><Text style={[type.h3, { color: colors.text }]}>{user?.name}</Text><Text style={[type.body, { color: colors.secondary }]}>+91 {user?.phone}</Text></View>
        </View></Enter>
        {row('create-outline', t('profile.edit'), () => nav.navigate('EditProfile'))}
        {row('location-outline', t('profile.addresses'), () => nav.navigate('Addresses'))}
        {row('star-outline', t('reviews.title'), () => nav.navigate('MyReviews'))}
        {row('chatbubbles-outline', t('chat.title'), () => nav.navigate('Chat'))}
        {row('notifications-outline', t('home.notifications'), () => nav.navigate('Notifications'))}
        <NotificationsRow />
        {row('language-outline', t('profile.language'), () => nav.navigate('Language'))}
        {row('storefront-outline', t('shop.title'), () => nav.navigate('Shop'))}
        {row('help-circle-outline', t('profile.help'), () => nav.navigate('Help'))}
        {row('document-text-outline', t('profile.legal'), () => nav.navigate('Legal'))}
        {row('person-remove-outline', t('account.title'), () => nav.navigate('Account'))}
        {row('log-out-outline', t('profile.logout'), logOut, true)}
        {row('trash-outline', t('profile.deleteAccount'), deleteAccount, true)}
      </Screen>
    </SafeAreaView>
  );
}

export function EditProfileScreen({ navigation }: { navigation: Nav }) {
  const { t } = useTranslation();
  const { user, updateProfile, setAvatar } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [gender, setGender] = useState<Gender | null>(user?.gender ?? null);
  const [dob, setDob] = useState(user?.dateOfBirth ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [errors, setErrors] = useState<{ name?: string; email?: string; dob?: string; api?: string }>({});
  useErrorPopup(errors.api);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const changePhoto = async (source: 'camera' | 'gallery') => {
    setErrors({});
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setErrors({ api: t('upload.permission') });
      }
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      setPhotoBusy(true);
      const sig = await endpoints.signUpload('avatar');
      const up = await uploadPrescription({ id: 'avatar', uri: a.uri, name: a.fileName ?? 'profile.jpg', mimeType: guessMime(a.fileName ?? a.uri, a.mimeType ?? 'image/jpeg'), sizeBytes: a.fileSize }, sig);
      await setAvatar(up.publicId);
    } catch (e) { setErrors({ api: (e as Error).message }); } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    setPhotoBusy(true);
    try { await setAvatar(null); } catch (e) { setErrors({ api: (e as Error).message }); } finally { setPhotoBusy(false); }
  };
  const save = async () => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = t('validation.name');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = t('validation.email');
    setErrors(e);
    if (e.name || e.email || e.dob) return;
    setBusy(true);
    try { await updateProfile({ name: name.trim(), email: email.trim(), gender, dateOfBirth: dob || null, city: city.trim() }); navigation.goBack(); } catch (err) { setErrors({ api: (err as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} onPress={save} loading={busy} />}>
      <View style={s.photoBlock}>
        <Avatar name={user?.name} uri={user?.avatarUrl} size={110} />
        <View style={{ alignSelf: 'stretch' }}><SourceOptions disabled={photoBusy} options={[
          { icon: 'camera', label: t('upload.camera'), onPress: () => { void changePhoto('camera'); } },
          { icon: 'images', label: t('upload.gallery'), onPress: () => { void changePhoto('gallery'); } },
        ]} /></View>
        {user?.avatarUrl ? <Button small variant="ghost" icon="trash-outline" title={t('profile.removePhoto')} onPress={() => { void removePhoto(); }} disabled={photoBusy} /> : null}
      </View>
      <TextField label={t('signup.name')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />
      <TextField label={t('signup.email')} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <GenderChips value={gender} onChange={setGender} />
      <DobField value={dob} onChange={setDob} error={errors.dob} />
      <TextField label={t('register.city')} value={city} onChangeText={setCity} autoCapitalize="words" />
      <TextField label={t('profile.phone')} value={`+91 ${user?.phone ?? ''}`} editable={false} style={{ backgroundColor: colors.tint }} />
      {errors.api ? <Text style={[type.small, { color: colors.red }]}>{errors.api}</Text> : null}
    </Screen>
  );
}

/** Shared by every role. */
export function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const update = useSession((st) => st.updateProfile);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const choose = async (language: 'en' | 'hi') => {
    try { await update({ language }); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Screen>
      {(['hi', 'en'] as const).map((l) => (
        <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: i18n.language === l }} onPress={() => choose(l)} style={[s.lang, i18n.language === l && { borderColor: colors.primary, backgroundColor: colors.card }]}>
          <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]}>{l === 'hi' ? 'हिन्दी' : 'English'}</Text>
          <Icon name={i18n.language === l ? 'radio-button-on' : 'radio-button-off'} size={24} color={i18n.language === l ? colors.primary : colors.muted} />
        </Pressable>
      ))}
      {err ? <Text style={[type.small, { color: colors.red }]}>{t('common.error')}: {err}</Text> : null}
    </Screen>
  );
}

export function HelpScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.config());
  if (loading && !data) return <Loading />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const st = data?.store;
  return (
    <Screen>
      <Text style={[type.h3, { color: colors.text }]}>{t('brand.name')}</Text>
      <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.lg }]}>{st?.address ?? t('home.location')}</Text>
      {st?.phone ? <Button title={`${t('order.callStore')} · ${st.phone}`} icon="call" onPress={() => Linking.openURL(`tel:${st.phone}`)} style={{ marginBottom: spacing.md }} /> : null}
      {st?.email ? <Button title={st.email} variant="outline" icon="mail" onPress={() => Linking.openURL(`mailto:${st.email}`)} /> : null}
      {!st?.phone && !st?.email ? <Card><Text style={[type.body, { color: colors.secondary }]}>{t('help.pending')}</Text></Card> : null}
      <Text style={[type.small, { color: colors.secondary, marginTop: spacing.lg }]}>{st ? `${t('help.hours')}: ${st.openingTime} - ${st.closingTime}` : ''}</Text>
    </Screen>
  );
}

export function LegalScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.terms());
  if (loading && !data) return <Loading />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!data?.text) return <Message icon="document-text-outline" title={t('legal.title')} text={t('legal.pending')} />;
  return (
    <Screen>
      <Enter><Text style={[type.body, { color: colors.text, lineHeight: 24 }]} selectable>{data.text}</Text></Enter>
      {data.updatedAt ? <Text style={[type.small, { color: colors.muted, marginTop: spacing.lg }]}>{t('legal.updated', { date: formatDate(data.updatedAt) })}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  photoBlock: { alignItems: 'center', gap: 12, marginBottom: spacing.lg },
  photoBtns: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.border },
  lang: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginBottom: spacing.md },
});
