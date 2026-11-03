import { useErrorPopup } from '../../hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import { otpProvider } from '../../auth/provider';
import { Enter, Float, Ripples, tick, useShake } from '../../components/motion';
import { BackButton, Button, Icon, Screen, TextField } from '../../components/ui';
import { useAutoFocus } from '../../hooks';
import { endpoints } from '../../api/endpoints';
import { showDialog } from '../../dialog';
import type { AuthStackParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, fonts, radius, spacing, type } from '../../theme';

const logo = require('../../../assets/logo.png');

export function WelcomeScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, 'Welcome'>) {
  const { t } = useTranslation();
  const bootError = useSession((s) => s.bootError);
  return (
    <SafeAreaView style={s.fill}>
      <View style={s.welcomeTop}>
        <Animated.View entering={ZoomIn.duration(700).springify().damping(12)}><Image source={logo} style={s.welcomeLogo} resizeMode="contain" accessibilityLabel="Kamal Medical Hall" /></Animated.View>
        <Animated.Text entering={FadeInDown.delay(300).duration(600)} style={[type.h1, s.tagline]}>{t('brand.tagline')}</Animated.Text>
        {bootError ? <Text style={[type.small, { color: colors.red, textAlign: 'center', marginTop: 8 }]}>{bootError}</Text> : null}
      </View>
      <View style={s.art}>
        <Ripples size={190} count={3} />
        <Animated.View entering={ZoomIn.delay(250).duration(600).springify()} style={s.artCore}><Icon name="medkit" size={64} /></Animated.View>
        <Float style={[s.deco, { left: 36, top: 24 }]} amplitude={9} duration={2300} rotate={10}><MaterialCommunityIcons name="leaf" size={46} color="#8FD3A6" /></Float>
        <Float style={[s.deco, { right: 40, top: 50 }]} amplitude={7} duration={2700} delay={300} rotate={-14}><MaterialCommunityIcons name="pill" size={42} color={colors.primary} /></Float>
        <Float style={[s.deco, { left: 56, bottom: 28 }]} amplitude={8} duration={2500} delay={600} rotate={-8}><MaterialCommunityIcons name="plus-thick" size={30} color={colors.green} /></Float>
        <Float style={[s.deco, { right: 52, bottom: 20 }]} amplitude={10} duration={2900} delay={200} rotate={12}><MaterialCommunityIcons name="leaf" size={34} color="#B7E4C4" /></Float>
      </View>
      <Animated.View entering={FadeInUp.delay(600).duration(600).springify().damping(15)} style={{ padding: spacing.lg, width: '100%', maxWidth: 460, alignSelf: 'center' }}>
        <View style={{ gap: spacing.sm }}>
          <Button title={t('auth.login')} icon="log-in-outline" onPress={() => navigation.navigate('Login')} />
          <Button title={t('register.create')} variant="outline" icon="person-add-outline" onPress={() => navigation.navigate('Register')} />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const IndiaFlag = () => (
  <View style={s.flag}><View style={{ flex: 1, backgroundColor: '#FF9933' }} /><View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#000080' }} /></View><View style={{ flex: 1, backgroundColor: '#138808' }} /></View>
);

export function LoginScreen({ navigation, route }: NativeStackScreenProps<AuthStackParamList, 'Login'>) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState(route.params?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useErrorPopup(error);
  const [errCount, setErrCount] = useState(0);
  const valid = /^[6-9]\d{9}$/.test(phone);
  const focus = useSharedValue(0);
  const phoneRef = useRef<TextInput>(null);
  useAutoFocus(phoneRef);
  const shake = useShake(errCount);
  const box = useAnimatedStyle(() => ({
    borderColor: error ? colors.red : interpolateColor(focus.value, [0, 1], [valid ? colors.green : colors.border, colors.primary]),
    backgroundColor: interpolateColor(focus.value, [0, 1], [colors.white, colors.tint]),
  }));

  const fail = (m: string) => { setError(m); setErrCount((c) => c + 1); };
  // const submit = async () => {
  //   if (!valid) return fail(t('auth.invalidPhone'));
  //   setBusy(true); setError('');
  //   try {
  //     await otpProvider.sendOtp(phone, 'login');
  //     navigation.navigate('OTP', { phone, purpose: 'login' });
  //   } catch (e) {
  //     if (e instanceof ApiError && e.code === 'not_registered') {
  //       setBusy(false);
  //       const go = await showDialog({ title: t('register.notFoundTitle'), message: t('register.notFoundMsg'), icon: 'person-add', confirmLabel: t('register.create'), cancelLabel: t('common.cancel') });
  //       if (go) navigation.replace('Register', { phone });
  //       return;
  //     }
  //     fail(e instanceof ApiError ? e.message : t('auth.sendFailed'));
  //   } finally { setBusy(false); }
  // };


const submit = async () => {
  if (!valid) return fail(t('auth.invalidPhone'));

  setBusy(true);
  setError('');

  try {
    await otpProvider.sendOtp(phone, 'login');
    navigation.navigate('OTP', { phone, purpose: 'login' });
  } catch (e) {
    fail(e instanceof ApiError ? e.message : t('auth.sendFailed'));
  } finally {
    setBusy(false);
  }
};


  return (
    <SafeAreaView style={s.fill}>
      <BackButton />
      <Screen padded={false} footer={<Button title={t('auth.sendOtp')} onPress={submit} loading={busy} disabled={!valid} />}>
        <View style={s.authBody}>
          <Animated.View entering={ZoomIn.duration(500).springify().damping(13)}><Image source={logo} style={s.authLogo} resizeMode="contain" /></Animated.View>
          <Enter index={1}><Text style={[type.h2, s.center]}>{t('auth.loginTitle')}</Text></Enter>
          <Enter index={2}><Text style={[type.small, s.center, { color: colors.secondary, marginBottom: spacing.xl }]}>{t('auth.loginSubtitle')}</Text></Enter>
          <Enter index={3}>
            <Animated.View style={shake}>
              <Animated.View style={[s.phoneBox, box]}>
                <IndiaFlag /><Text style={[type.bodyMedium, { marginHorizontal: 10 }]}>+91</Text>
                <TextInput ref={phoneRef} value={phone} onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setError(''); }} keyboardType="number-pad" maxLength={10}
                  placeholder="98765 43210" placeholderTextColor={colors.muted} accessibilityLabel={t('auth.phoneLabel')} style={s.phoneInput} onSubmitEditing={submit}
                  onFocus={() => { focus.value = withTiming(1, { duration: 180 }); }} onBlur={() => { focus.value = withTiming(0, { duration: 220 }); }} />
                {valid ? <Animated.View entering={ZoomIn.duration(250)}><Icon name="checkmark-circle" size={24} color={colors.green} /></Animated.View> : null}
              </Animated.View>
            </Animated.View>
            {error ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: 6 }]}>{error}</Animated.Text> : null}
          </Enter>
          <Enter index={4}>
            <Text style={[type.small, s.center, { color: colors.secondary, marginTop: spacing.xxxl }]}>{t('auth.consent')}</Text>
            <Pressable onPress={() => navigation.navigate('Legal')}><Text style={[type.smallMedium, s.center, { color: colors.primary }]}>{t('auth.consentLink')}</Text></Pressable>
            <Text style={[type.small, s.center, { color: colors.secondary, marginTop: spacing.xl }]}>
              {t('register.newHere')} <Text style={{ color: colors.primary }} onPress={() => navigation.replace('Register', phone ? { phone } : undefined)}>{t('register.create')}</Text>
            </Text>
          </Enter>
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

function OtpBox({ char, active, error }: { char: string; active: boolean; error: boolean }) {
  const pop = useSharedValue(1);
  const act = useSharedValue(0);
  useEffect(() => { if (char) pop.value = withSequence(withTiming(1.18, { duration: 90 }), withSpring(1, { damping: 8, stiffness: 300 })); }, [char, pop]);
  useEffect(() => { act.value = withTiming(active ? 1 : 0, { duration: 160 }); }, [active, act]);
  const a = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value * interpolate(act.value, [0, 1], [1, 1.05]) }],
    borderColor: error ? colors.red : char ? colors.primary : interpolateColor(act.value, [0, 1], [colors.border, colors.primary]),
    backgroundColor: char ? colors.card : colors.white,
  }));
  return <Animated.View style={[s.otpBox, a]}><Text style={[type.h2, { color: colors.text }]}>{char}</Text></Animated.View>;
}

export function OtpScreen({ route, navigation }: NativeStackScreenProps<AuthStackParamList, 'OTP'>) {
  const { t } = useTranslation();
  const { phone, purpose, profile } = route.params;
  const login = useSession((st) => st.login);
  // const [testMode, setTestMode] = useState(false);
  // useEffect(() => { void endpoints.config().then((c) => setTestMode(Boolean(c.otpTestMode))).catch(() => undefined); }, []);
  const [testMode] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useErrorPopup(error);
  const [errCount, setErrCount] = useState(0);
  const [left, setLeft] = useState(RESEND_SECONDS);
  const input = useRef<TextInput>(null);
  useAutoFocus(input);
  const shake = useShake(errCount);
  const bar = useSharedValue(1);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  useEffect(() => { bar.value = withTiming(left / RESEND_SECONDS, { duration: 1000 }); }, [left, bar]);

  const verify = async (value = code) => {
    if (value.length !== OTP_LENGTH || busy) return;
    setBusy(true); setError('');
    try {
//      const token = await otpProvider.confirmOtp(value);
      const token = await otpProvider.confirmOtp(value, profile);
      tick('success');
      await login(token, { purpose, profile }); // routing to the right app happens from the server-assigned role
    } catch (e) {
  console.error('OTP LOGIN ERROR:', e);

  const message =
    e instanceof Error ? e.message : String(e);

  setError(message);
  setErrCount((c) => c + 1);
} 
    finally { setBusy(false); }
  };

  const resend = async () => {
    setError('');
    try { await otpProvider.sendOtp(phone, purpose); setLeft(RESEND_SECONDS); } catch (e) { setError(e instanceof ApiError ? e.message : t('auth.sendFailed')); }
  };

  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
  const progress = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));
  return (
    <SafeAreaView style={s.fill}>
      <BackButton onPress={() => navigation.goBack()} />
      <Screen padded={false} footer={<Button title={t('auth.verify')} onPress={() => verify()} loading={busy} disabled={code.length !== OTP_LENGTH} />}>
        <View style={s.authBody}>
          <Animated.View entering={ZoomIn.duration(500).springify().damping(13)}><Image source={logo} style={s.authLogo} resizeMode="contain" /></Animated.View>
          <Enter index={1}><Text style={[type.h2, s.center]}>{t('auth.otpTitle')}</Text></Enter>
          <Enter index={2}><Text style={[type.small, s.center, { color: colors.secondary, marginBottom: testMode ? spacing.md : spacing.xl }]}>{t('auth.otpSubtitle', { phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` })}</Text></Enter>
          {testMode ? <Enter index={2}><View style={s.testBanner}><Icon name="flask-outline" size={18} color={colors.amber} /><Text style={[type.small, { color: colors.text, flex: 1 }]}>{t('auth.testOtp')}</Text></View></Enter> : null}
          <Enter index={3}>
            <Animated.View style={shake}>
              <Pressable onPress={() => input.current?.focus()} style={s.otpRow} accessibilityLabel={t('auth.otpLabel')}>
                {Array.from({ length: OTP_LENGTH }, (_, i) => <OtpBox key={i} char={code[i] ?? ''} active={code.length === i} error={!!error} />)}
                <TextInput ref={input} value={code} keyboardType="number-pad" maxLength={OTP_LENGTH} textContentType="oneTimeCode" autoComplete="sms-otp" style={s.otpHidden}
                  onChangeText={(v) => { const c = v.replace(/\D/g, '').slice(0, OTP_LENGTH); setCode(c); setError(''); if (c.length === OTP_LENGTH) void verify(c); }} />
              </Pressable>
            </Animated.View>
            {error ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, s.center, { color: colors.red, marginTop: 8 }]}>{error}</Animated.Text> : null}
          </Enter>
          <Enter index={4}>
            {left > 0
              ? <View style={{ marginVertical: spacing.lg, alignItems: 'center', gap: 8 }}>
                  <Text style={[type.body, { color: colors.secondary }]}>{t('auth.resendIn', { time: `${mm}:${ss}` })}</Text>
                  <View style={s.timerTrack}><Animated.View style={[s.timerFill, progress]} /></View>
                </View>
              : <Pressable onPress={resend} style={{ marginVertical: spacing.lg }}><Animated.Text entering={ZoomIn.duration(300)} style={[type.bodyMedium, s.center, { color: colors.primary }]}>{t('auth.resend')}</Animated.Text></Pressable>}
          </Enter>
        </View>
      </Screen>
    </SafeAreaView>
  );
}

export function SignupScreen() {
  const { t } = useTranslation();
  const update = useSession((st) => st.updateProfile);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; api?: string }>({});
  useErrorPopup(errors.api);
  const emailRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  useAutoFocus(nameRef);

  const submit = async () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = t('validation.name');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = t('validation.email');
    setErrors(next);
    if (next.name || next.email) return;
    setBusy(true);
    try { await update({ name: name.trim(), email: email.trim() }); tick('success'); } catch (e) { setErrors({ api: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={s.fill}>
      <Screen padded={false} footer={<Button title={t('signup.continue')} onPress={submit} loading={busy} />}>
        <View style={s.authBody}>
          <Animated.View entering={ZoomIn.duration(500).springify().damping(13)}><Image source={logo} style={s.authLogo} resizeMode="contain" /></Animated.View>
          <Enter index={1}><Text style={[type.h2, s.center]}>{t('signup.title')}</Text></Enter>
          <Enter index={2}><Text style={[type.small, s.center, { color: colors.secondary, marginBottom: spacing.xl }]}>{t('signup.subtitle')}</Text></Enter>
          <Enter index={3}><TextField ref={nameRef} label={t('signup.name')} value={name} onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: undefined })); }} error={errors.name} valid={name.trim().length >= 2} autoCapitalize="words" textContentType="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} blurOnSubmit={false} /></Enter>
          <Enter index={4}><TextField ref={emailRef} label={t('signup.email')} value={email} onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: undefined })); }} error={errors.email} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" returnKeyType="done" onSubmitEditing={submit} /></Enter>
          {errors.api ? <Text style={[type.small, { color: colors.red, marginBottom: 8 }]}>{errors.api}</Text> : null}
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  center: { textAlign: 'center', color: colors.text },
  welcomeTop: { alignItems: 'center', paddingTop: spacing.xxxl, paddingHorizontal: spacing.xl },
  welcomeLogo: { width: 250, height: 250 },
  tagline: { color: colors.primaryDark, textAlign: 'center', marginTop: spacing.sm },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artCore: { width: 128, height: 128, borderRadius: 64, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 10px 28px rgba(11,95,219,0.20)' },
  deco: { position: 'absolute' },
  authBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, width: '100%', maxWidth: 460, alignSelf: 'center' },
  authLogo: { width: 190, height: 190, alignSelf: 'center', marginBottom: spacing.sm },
  phoneBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 56 },
  phoneInput: { flex: 1, fontFamily: fonts.medium, fontSize: 17, color: colors.text, paddingVertical: 10, outlineStyle: 'none' } as object,
  flag: { width: 28, height: 20, borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpBox: { flex: 1, height: 58, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  otpHidden: { position: 'absolute', opacity: 0, width: '100%', height: '100%' },
  testBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.amberBg, marginBottom: spacing.lg },
  timerTrack: { width: 140, height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  timerFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
});
