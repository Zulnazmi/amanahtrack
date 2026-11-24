import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useLang } from '../src/lang';
import { useSession } from '../src/session';
import { brand, colors, fonts, radius, space } from '../src/theme';
import { Icon } from '../src/ui/Icon';
import { LogoMark, Wordmark } from '../src/ui/Logo';
import { FadeUp, PressScale } from '../src/ui/motion';

export default function LoginScreen() {
  const { signIn } = useSession();
  const { lang, setLang, t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!email.trim() || !password) {
      setError(t('Masukkan e-mel dan kata laluan.', 'Enter your email and password.'));
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Tidak dapat log masuk.', 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={l.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={l.glow} />
      <ScrollView contentContainerStyle={l.content} keyboardShouldPersistTaps="handled">
        <FadeUp>
          <View style={l.brandRow}>
            <LogoMark size={44} gradient />
            <Wordmark size={22} />
            <PressScale
              onPress={() => setLang(lang === 'ms' ? 'en' : 'ms')}
              style={l.lang}
              accessibilityRole="button"
              accessibilityLabel={lang === 'ms' ? 'Switch to English' : 'Tukar ke Bahasa Melayu'}
            >
              <Text style={l.langText}>{lang === 'ms' ? 'EN' : 'BM'}</Text>
            </PressScale>
          </View>
        </FadeUp>

        <FadeUp delay={80}>
          <Text style={l.title}>{t('Selamat kembali', 'Welcome back')}</Text>
          <Text style={l.subtitle}>{t('Log masuk untuk urus kewangan masjid anda.', 'Sign in to manage your mosque’s funds.')}</Text>
        </FadeUp>

        <FadeUp delay={180} style={{ marginTop: space.xl }}>
          <Text style={l.label}>{t('E-mel', 'Email')}</Text>
          <View style={[l.field, focus === 'email' && l.fieldFocus]}>
            <Icon name="mail" size={18} color={focus === 'email' ? colors.green : colors.inkFaint} />
            <TextInput
              style={l.input}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocus('email')}
              onBlur={() => setFocus(null)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder={t('bendahari@masjid.my', 'treasurer@masjid.my')}
              accessibilityLabel={t('E-mel', 'Email')}
              placeholderTextColor={colors.inkFaint}
              editable={!busy}
            />
          </View>

          <Text style={[l.label, { marginTop: space.lg }]}>{t('Kata laluan', 'Password')}</Text>
          <View style={[l.field, focus === 'password' && l.fieldFocus]}>
            <Icon name="lock" size={18} color={focus === 'password' ? colors.green : colors.inkFaint} />
            <TextInput
              style={l.input}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocus('password')}
              onBlur={() => setFocus(null)}
              secureTextEntry
              placeholder={t('Kata laluan anda', 'Your password')}
              accessibilityLabel={t('Kata laluan', 'Password')}
              placeholderTextColor={colors.inkFaint}
              editable={!busy}
              onSubmitEditing={submit}
            />
          </View>

          {error && <Text style={l.error}>{error}</Text>}

          <PressScale
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('Log masuk', 'Sign in')}
            style={[l.submit, busy && l.submitBusy]}>
            {busy ? (
              <ActivityIndicator color={colors.onGreen} />
            ) : (
              <Text style={l.submitText}>{t('Log masuk', 'Sign in')}</Text>
            )}
          </PressScale>
        </FadeUp>

        <FadeUp delay={300} style={l.trust}>
          <TrustRow text={t('Sebarang ubahan pada rekod lama dapat dikesan', 'Any change to an old record can be detected')} />
          <TrustRow text={t('Setiap AJK ada akses mengikut tugas', 'Each committee member has access to match their duty')} />
          <TrustRow text={t('Syarat dana disemak sebelum wang dibelanjakan', 'Fund rules are checked before money is spent')} />
        </FadeUp>

        <FadeUp delay={400}>
          <Text style={l.legal}>
            {brand.copyright} {'·'} {brand.version}
          </Text>
        </FadeUp>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TrustRow({ text }: { text: string }) {
  return (
    <View style={l.trustRow}>
      <Icon name="shield" size={16} color={colors.green} strokeWidth={1.9} />
      <Text style={l.trustText}>{text}</Text>
    </View>
  );
}

const l = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  glow: {
    position: 'absolute',
    top: -160,
    right: -140,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(79,227,168,0.07)',
  },
  content: { padding: 28, paddingTop: 72, paddingBottom: 32 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lang: {
    minWidth: 48,
    minHeight: 44,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  langText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    letterSpacing: -1,
    color: colors.ink,
    marginTop: 44,
  },
  subtitle: { fontFamily: fonts.body, fontSize: 15, color: colors.inkFaint, marginTop: 8 },

  label: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.inkFaint, marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  fieldFocus: { borderColor: colors.green, borderWidth: 1.5 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink, height: '100%' },
  error: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.danger,
    marginTop: space.md,
  },

  submit: {
    marginTop: space.xl,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBusy: { opacity: 0.8 },
  submitText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.onGreen },

  trust: {
    marginTop: 30,
    padding: 16,
    gap: 10,
    borderRadius: radius.md + 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trustText: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft, flex: 1 },

  legal: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: 28,
  },
});
