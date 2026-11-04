
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, type TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import type { Gender } from '../../api/types';
import { otpProvider } from '../../auth/provider';
import { CheckRow, DobField, GenderChips } from '../../components/forms';
import { Enter, tick } from '../../components/motion';
import { BackButton, Button, Screen, TextField } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup } from '../../hooks';
import type { AuthStackParamList } from '../../navigation/types';
import { colors, spacing, type } from '../../theme';

type Errors = Partial<Record<'name' | 'phone' | 'email' | 'dob' | 'terms', string>>;

/** New customers: the sign-up form, then an OTP to the mobile number; the account is created once the OTP is right. */
export function RegisterScreen({
  navigation,
  route,
}: NativeStackScreenProps<AuthStackParamList, 'Register'>) {
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState(route.params?.phone ?? '');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState('');
  const [city, setCity] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState('');

  useErrorPopup(apiError);

  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  const clear = (k: keyof Errors) =>
    setErrors((e) => ({ ...e, [k]: undefined }));

  const submit = async () => {
    const next: Errors = {};

    if (name.trim().length < 2) {
      next.name = t('validation.name');
    }

    if (!/^[6-9]\d{9}$/.test(phone)) {
      next.phone = t('auth.invalidPhone');
    }

    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      next.email = t('validation.email');
    }

    if (!terms) {
      next.terms = t('register.acceptTerms');
    }

    setErrors(next);

    if (Object.values(next).some(Boolean)) {
      tick('error');
      return;
    }

    setBusy(true);
    setApiError('');

    try {
      const result = await otpProvider.sendOtp(phone, 'signup');

      navigation.navigate('OTP', {
        phone,
        purpose: 'signup',
        testMode: result.testMode,
        profile: {
          name: name.trim(),
          email: email.trim() || undefined,
          gender,
          dateOfBirth: dob || null,
          city: city.trim() || undefined,
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_registered') {
        const go = await showDialog({
          title: t('register.existsTitle'),
          message: t('register.existsMsg'),
          icon: 'person-circle',
          confirmLabel: t('register.goLogin'),
          cancelLabel: t('common.cancel'),
        });

        if (go) {
          navigation.replace('Login', { phone });
        }
      } else {
        setApiError(
          e instanceof ApiError ? e.message : t('auth.sendFailed')
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.fill}>
      <BackButton />

      <Screen
        padded={false}
        footer={
          <Button
            title={t('register.submit')}
            icon="arrow-forward"
            onPress={submit}
            loading={busy}
          />
        }
      >
        <View style={s.body}>
          <Enter index={0}>
            <Text style={[type.h2, s.center]}>
              {t('register.title')}
            </Text>
          </Enter>

          <Enter index={1}>
            <Text
              style={[
                type.small,
                s.center,
                { color: colors.secondary, marginBottom: spacing.xl },
              ]}
            >
              {t('register.subtitle')}
            </Text>
          </Enter>

          <Enter index={2}>
            <TextField
              label={t('register.name')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                clear('name');
              }}
              error={errors.name}
              valid={name.trim().length >= 2}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              blurOnSubmit={false}
            />

            <TextField
              ref={phoneRef}
              label={t('register.phone')}
              value={phone}
              onChangeText={(v) => {
                setPhone(v.replace(/\D/g, '').slice(0, 10));
                clear('phone');
              }}
              error={errors.phone}
              valid={/^[6-9]\d{9}$/.test(phone)}
              keyboardType="number-pad"
              maxLength={10}
              placeholder="98765 43210"
              textContentType="telephoneNumber"
              hint={t('register.phoneHint')}
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              blurOnSubmit={false}
            />

            <TextField
              ref={emailRef}
              label={t('register.email')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                clear('email');
              }}
              error={errors.email}
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType="emailAddress"
              autoComplete="email"
            />
          </Enter>

          <Enter index={3}>
            <GenderChips value={gender} onChange={setGender} />

            <DobField
              value={dob}
              onChange={(v) => {
                setDob(v);
                clear('dob');
              }}
              error={errors.dob}
            />

            <TextField
              label={t('register.city')}
              value={city}
              onChangeText={setCity}
              autoCapitalize="words"
              textContentType="addressCity"
            />
          </Enter>

          <Enter index={4}>
            <CheckRow
              checked={terms}
              onChange={(v) => {
                setTerms(v);
                clear('terms');
              }}
              error={!!errors.terms}
            >
              <Text style={[type.small, { color: colors.text }]}>
                {t('register.agree')} {t('auth.consentLink')}
              </Text>
            </CheckRow>

            <Text
              accessibilityRole="link"
              onPress={() => navigation.navigate('Legal')}
              style={[
                type.smallMedium,
                {
                  color: colors.primary,
                  marginLeft: 36,
                  alignSelf: 'flex-start',
                  paddingVertical: 4,
                },
              ]}
            >
              {t('register.readTerms')}
            </Text>

            {errors.terms ? (
              <Text style={[type.small, { color: colors.red }]}>
                {errors.terms}
              </Text>
            ) : null}

            <Text
              style={[
                type.small,
                s.center,
                { color: colors.secondary, marginTop: spacing.lg },
              ]}
            >
              {t('register.haveAccount')}{' '}
              <Text
                style={{ color: colors.primary }}
                onPress={() =>
                  navigation.replace(
                    'Login',
                    phone ? { phone } : undefined
                  )
                }
              >
                {t('register.goLogin')}
              </Text>
            </Text>
          </Enter>
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  center: { textAlign: 'center', color: colors.text },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
});
