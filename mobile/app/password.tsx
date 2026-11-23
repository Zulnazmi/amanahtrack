import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useSession } from '../src/session';
import { Button, Field, form, Notice } from '../src/ui/Form';

export default function PasswordScreen() {
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
    if (next.length < 10) return setError('Kata laluan baharu mesti sekurang-kurangnya 10 aksara.');
    if (next !== again) return setError('Kata laluan baharu tidak sepadan.');
    if (next === current) return setError('Pilih kata laluan yang berbeza.');
    setBusy(true);
    try {
      await changePassword(current, next);
      router.replace('/');
    } catch (e) {
      const m = (e as Error).message;
      setError(m === 'Current password is incorrect' ? 'Kata laluan semasa salah.' : m);
    } finally {
      setBusy(false);
    }
  }

  const common = { secureTextEntry: true, autoCapitalize: 'none' as const, autoCorrect: false, maxLength: 72 };
  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      <Text style={form.lede}>
        {forced
          ? 'Anda menggunakan kata laluan sementara. Tetapkan kata laluan sendiri untuk meneruskan.'
          : 'Semua peranti lain akan dilog keluar selepas pertukaran.'}
      </Text>
      <Field label={forced ? 'Kata laluan sementara' : 'Kata laluan semasa'} value={current} onChangeText={setCurrent} {...common} />
      <Field label="Kata laluan baharu" value={next} onChangeText={setNext} hint="Sekurang-kurangnya 10 aksara" {...common} />
      <Field label="Ulang kata laluan baharu" value={again} onChangeText={setAgain} {...common} />
      {error && <Notice ok={false} text={error} />}
      <Button label="Tukar kata laluan" busy={busy} onPress={submit} />
      {forced && <Button label="Log keluar" quiet onPress={signOut} />}
    </ScrollView>
  );
}
