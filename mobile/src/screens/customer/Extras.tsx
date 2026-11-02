import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { ChatMessage, ChatQueue } from '../../api/types';
import { uploadPrescription } from '../../api/upload';
import { StarRating, ReviewCard } from '../../components/ReviewParts';
import { SourceOptions } from '../../components/SourceOptions';
import { tick } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Loading, Message, Screen, TextField } from '../../components/ui';
import { notice, showDialog } from '../../dialog';
import { guessMime } from '../../fileKinds';
import { useErrorPopup, useLoad } from '../../hooks';
import type { CustomerStackParamList } from '../../navigation/types';
import { colors, radius, spacing, type } from '../../theme';
import { formatDateTime } from '../../utils';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------- Live chat with the shopkeeper
function QueueBanner({ queue, closed }: { queue: ChatQueue | null; closed: boolean }) {
  const { t } = useTranslation();
  if (closed) return <View style={[s.banner, { backgroundColor: colors.card }]}><Icon name="checkmark-done-circle" size={22} color={colors.primary} /><Text style={[type.small, s.bannerText]}>{t('chat.closedBanner')}</Text></View>;
  if (!queue) return <View style={[s.banner, { backgroundColor: colors.card }]}><Icon name="chatbubbles" size={22} color={colors.primary} /><Text style={[type.small, s.bannerText]}>{t('chat.intro')}</Text></View>;
  if (queue.state === 'active') return <View style={[s.banner, { backgroundColor: colors.greenBg }]}><Icon name="chatbubble-ellipses" size={22} color={colors.green} /><Text style={[type.small, s.bannerText]}>{t('chat.activeBanner')}</Text></View>;
  return (
    <View style={[s.banner, { backgroundColor: colors.amberBg }]}>
      <Icon name="time" size={22} color={colors.amber} />
      <Text style={[type.small, s.bannerText]}>
        {queue.adminBusy ? t('chat.waitBusy', { position: queue.position, minutes: Math.max(queue.estimatedMinutes, 1) }) : t('chat.waitFree')}
      </Text>
    </View>
  );
}

export function ChatScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Chat'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.chat.thread(), ['chat:message', 'chat:queue']);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const scroller = useRef<ScrollView>(null);
  const messages: ChatMessage[] = data?.messages ?? [];
  const closed = !data?.thread || data.thread.status === 'closed';

  // Opening the chat counts as reading it.
  useEffect(() => { if (data?.thread?.status === 'open') void endpoints.chat.read().catch(() => undefined); }, [data?.messages.length, data?.thread?.status]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr('');
    try { await endpoints.chat.send(body, route.params?.orderId); setText(''); tick(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  }, [text, sending, route.params?.orderId, reload]);

  const endChat = async () => {
    const ok = await showDialog({ title: t('chat.endTitle'), message: t('chat.endMsg'), icon: 'checkmark-done', confirmLabel: t('chat.end'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    try { await endpoints.chat.close(); await reload(); } catch (e) { setErr((e as Error).message); }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  return (
    <SafeAreaView style={s.fill} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <QueueBanner queue={data?.queue ?? null} closed={closed && messages.length > 0} />
        <ScrollView ref={scroller} style={s.fill} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
          {messages.length === 0 ? <Message icon="chatbubbles-outline" title={t('chat.emptyTitle')} text={t('chat.emptyText')} /> : null}
          {messages.map((m) => (
            <View key={m.id} style={[s.row, m.role === 'customer' ? s.rowMine : s.rowTheirs]}>
              <View style={[s.bubble, m.role === 'customer' ? s.mine : m.role === 'bot' ? s.bot : s.theirs]}>
                {m.role === 'bot' ? <Text style={[type.small, { color: colors.primary, marginBottom: 2 }]}>{t('chat.assistant')}</Text> : m.role === 'admin' ? <Text style={[type.small, { color: colors.secondary, marginBottom: 2 }]}>{t('chat.shopkeeper')}</Text> : null}
                <Text style={[type.body, { color: m.role === 'customer' ? colors.white : colors.text }]}>{m.body}</Text>
                <Text style={[type.small, { color: m.role === 'customer' ? '#DCE9FF' : colors.muted, alignSelf: 'flex-end', marginTop: 2, fontSize: 11 }]}>{clock(m.createdAt)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        {!closed ? <Pressable accessibilityRole="button" onPress={endChat} style={s.endBtn}><Text style={[type.smallMedium, { color: colors.secondary }]}>{t('chat.end')}</Text></Pressable> : null}
        <View style={s.composer}>
          <TextInput value={text} onChangeText={setText} placeholder={closed && messages.length ? t('chat.newPlaceholder') : t('chat.placeholder')} placeholderTextColor={colors.muted} multiline maxLength={1000} accessibilityLabel={t('chat.placeholder')} style={[type.body, s.input]} />
          <Pressable accessibilityRole="button" accessibilityLabel={t('chat.send')} disabled={sending || !text.trim()} onPress={send} style={[s.sendBtn, (sending || !text.trim()) && { opacity: 0.45 }]}>
            <Icon name="send" size={22} color={colors.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- Write a review
interface Photo { id: string; uri: string; name: string; mimeType: string; sizeBytes?: number }

export function WriteReviewScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'WriteReview'>) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);

  const addPhotos = async (source: 'camera' | 'gallery') => {
    if (photos.length >= 3) return setErr(t('reviews.photoLimit'));
    setErr('');
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setErr(t('upload.permission'));
      }
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3 - photos.length, quality: 0.7 });
      if (res.canceled) return;
      setPhotos((c) => [...c, ...res.assets.slice(0, 3 - c.length).map((a) => ({ id: uid(), uri: a.uri, name: a.fileName ?? 'photo.jpg', mimeType: guessMime(a.fileName ?? a.uri, a.mimeType ?? 'image/jpeg'), sizeBytes: a.fileSize }))]);
    } catch { setErr(t('upload.pickFailed')); }
  };

  const submit = async () => {
    if (rating < 1) return setErr(t('reviews.needRating'));
    setBusy(true); setErr('');
    try {
      const uploaded = [];
      if (photos.length) {
        const sig = await endpoints.signUpload('review');
        uploaded.push(...await Promise.all(photos.map((p) => uploadPrescription(p, sig))));
      }
      await endpoints.reviews.create({ orderId: route.params.orderId, rating, comment: comment.trim() || undefined, images: uploaded.map((u) => ({ publicId: u.publicId, mimeType: u.mimeType, sizeBytes: u.sizeBytes })) });
      tick('success');
      await notice(t('reviews.sentTitle'), t('reviews.sentMsg'), t('common.ok'));
      navigation.goBack();
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };

  return (
    <Screen footer={<Button title={t('reviews.submit')} icon="send" onPress={submit} loading={busy} />}>
      <Text style={[type.h3, { color: colors.text }]}>#{route.params.orderNumber}</Text>
      <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.md }]}>{t('reviews.howWas')}</Text>
      <View style={{ alignItems: 'center', marginVertical: spacing.md }}><StarRating value={rating} size={42} onChange={(n) => { setRating(n); tick(); }} /></View>
      <TextField label={t('reviews.comment')} value={comment} onChangeText={setComment} multiline maxLength={500} placeholder={t('reviews.commentPlaceholder')} />
      <Text style={[type.smallMedium, { color: colors.secondary, marginBottom: 6 }]}>{t('reviews.photos')}</Text>
      <View style={s.photoRow}>
        {photos.map((p) => (
          <View key={p.id} style={s.photo}>
            <Image source={{ uri: p.uri }} style={s.photoImg} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('upload.remove', { name: p.name })} hitSlop={8} onPress={() => setPhotos((c) => c.filter((x) => x.id !== p.id))} style={s.photoX}><Icon name="close" size={14} color={colors.white} /></Pressable>
          </View>
        ))}
      </View>
      {photos.length < 3 ? (
        <SourceOptions options={[
          { icon: 'camera', label: t('upload.camera'), onPress: () => { void addPhotos('camera'); } },
          { icon: 'images', label: t('upload.gallery'), onPress: () => { void addPhotos('gallery'); } },
        ]} />
      ) : null}
      <Text style={[type.small, { color: colors.secondary, marginTop: spacing.md }]}>{t('reviews.moderationNote')}</Text>
    </Screen>
  );
}

// ---------------------------------------------------------------- My reviews (approved ones are public on the profile)
export function MyReviewsScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.reviews.mine(), ['notification']);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const all = data?.reviews ?? [];
  const approved = all.filter((r) => r.status === 'approved');
  const waiting = all.filter((r) => r.status !== 'approved');
  if (!all.length) return <Message icon="star-outline" title={t('reviews.emptyTitle')} text={t('reviews.emptyText')} />;
  return (
    <Screen>
      {approved.length ? <Text style={[type.h3, { color: colors.text, marginBottom: spacing.sm }]}>{t('reviews.published')}</Text> : null}
      {approved.map((r) => <ReviewCard key={r.id} review={r} />)}
      {waiting.length ? <Text style={[type.h3, { color: colors.text, marginVertical: spacing.sm }]}>{t('reviews.waiting')}</Text> : null}
      {waiting.map((r) => <ReviewCard key={r.id} review={r} />)}
      <Card><Text style={[type.small, { color: colors.secondary }]}>{t('reviews.moderationNote')} {formatDateTime(all[0].createdAt)}</Text></Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: radius.md },
  bannerText: { flex: 1, color: colors.text },
  list: { padding: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
  row: { marginBottom: spacing.sm, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.lg },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  bot: { backgroundColor: colors.amberBg, borderBottomLeftRadius: 4 },
  endBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 14 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, color: colors.text },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.sm },
  photo: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.card },
  photoImg: { flex: 1, borderRadius: radius.md },
  photoX: { position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
