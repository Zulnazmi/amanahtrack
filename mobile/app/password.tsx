import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useLang } from '../src/lang';
import { useSession } from '../src/session';
import { Button, Field, form, Notice } from '../src/ui/Form';

export default function PasswordScreen() {
  const { t } = useLang();
  const router = useRouter();
  const { session, changePassword, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = session?.must_change_password;

  async function submit() {
    setError(null);
    if (next.length < 10) return setError(t('Kata laluan baharu mesti sekurang-kurangnya 10 aksara.', 'The new password needs at least 10 characters.'));
    if (next !== again) return setError(t('Kata laluan baharu tidak sepadan.', 'The new passwords do not match.'));
    if (next === current) return setError(t('Pilih kata laluan yang berbeza.', 'Choose a different password.'));
    setBusy(true);
    try {
      await changePassword(current, next);
      router.replace('/');
    } catch (e) {
      const m = (e as Error).message;
      setError(m === 'Current password is incorrect' ? t('Kata laluan semasa salah.', 'The current password is wrong.') : m);
    } finally {
      setBusy(false);
    }
  }

  const common = { secureTextEntry: true, autoCapitalize: 'none' as const, autoCorrect: false, maxLength: 72 };
  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      <Text style={form.lede}>
        {forced
          ? t('Anda menggunakan kata laluan sementara. Tetapkan kata laluan sendiri untuk meneruskan.', 'You are using a temporary password. Set your own to continue.')
          : t('Semua peranti lain akan dilog keluar selepas pertukaran.', 'All other devices will be signed out after the change.')}
      </Text>
      <Field label={forced ? t('Kata laluan sementara', 'Temporary password') : t('Kata laluan semasa', 'Current password')} value={current} onChangeText={setCurrent} {...common} />
      <Field label={t('Kata laluan baharu', 'New password')} value={next} onChangeText={setNext} hint={t('Sekurang-kurangnya 10 aksara', 'At least 10 characters')} {...common} />
      <Field label={t('Ulang kata laluan baharu', 'New password again')} value={again} onChangeText={setAgain} {...common} />
      {error && <Notice ok={false} text={error} />}
      <Button label={t('Tukar kata laluan', 'Change password')} busy={busy} onPress={submit} />
      {forced && <Button label={t('Log keluar', 'Sign out')} quiet onPress={signOut} />}
    </ScrollView>
  );
}
