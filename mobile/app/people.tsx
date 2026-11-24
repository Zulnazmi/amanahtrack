import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { api, Person, Session } from '../src/api/client';
import { useLang } from '../src/lang';
import { roleName } from '../src/roles';
import { useSession } from '../src/session';
import { colors } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';

const ROLES: Session['role'][] = ['treasurer', 'committee', 'auditor', 'admin'];

type Pending = { id: string; what: 'access' | 'reset' };

export default function PeopleScreen() {
  const { t } = useLang();
  const { session } = useSession();
  const admin = session?.role === 'admin';
  const [people, setPeople] = useState<Person[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Session['role']>('committee');
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await api.people());
    } catch (e) {
      setPeople((p) => p ?? []);
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // A temporary password must not linger on a screen somebody comes back to.
      return () => setTemp(null);
    }, [load]),
  );

  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      setPending(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (name.trim().length < 2 || !email.includes('@')) return setError(t('Masukkan nama dan e-mel yang sah.', 'Enter a valid name and email.'));
    run(async () => {
      const p = await api.addPerson({ name: name.trim(), email: email.trim(), role });
      setTemp({ name: p.name, password: p.temporary_password });
      setAdding(false);
      setName('');
      setEmail('');
    });
  }

  function confirmPending(p: Person) {
    run(async () => {
      if (pending?.what === 'reset') {
        const r = await api.resetPassword(p.id);
        setTemp({ name: p.name, password: r.temporary_password });
      } else {
        await api.changePerson(p.id, { active: !p.active });
      }
    });
  }

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      {temp && (
        <View style={form.card}>
          <Text style={form.strong}>{t('Kata laluan sementara untuk', 'Temporary password for')} {temp.name}</Text>
          <Text selectable style={form.big}>{temp.password}</Text>
          <Text style={form.text}>
            {t(
              'Berikan kepada orang itu sahaja. Ia hanya ditunjukkan sekali dan mesti ditukar semasa log masuk.',
              'Give it only to that person. It is shown once and must be changed at sign in.',
            )}
          </Text>
          <Button label={t('Sudah disalin', 'I have copied it')} quiet onPress={() => setTemp(null)} />
        </View>
      )}
      {error && <Notice ok={false} text={error} />}

      {admin && !adding && <Button label={t('Tambah pengguna', 'Add a user')} onPress={() => setAdding(true)} />}
      {adding && (
        <View style={form.card}>
          <Field label={t('Nama penuh', 'Full name')} value={name} onChangeText={setName} autoCapitalize="words" maxLength={120} />
          <Field label={t('E-mel', 'Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <Text style={form.strong}>{t('Tugas', 'Role')}</Text>
          <Choices value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: roleName(r, t) }))} />
          <Button label={t('Tambah', 'Add')} busy={busy} onPress={add} />
          <Button label={t('Batal', 'Cancel')} quiet onPress={() => setAdding(false)} />
        </View>
      )}

      {people === null && <ActivityIndicator color={colors.green} />}
      {people?.map((p) => (
        <View key={p.id} style={[form.card, !p.active && { opacity: 0.65 }]}>
          <Text style={form.strong}>{p.name}</Text>
          <Text style={form.faint}>{p.email}</Text>
          <Text style={form.text}>
            {roleName(p.role, t)}
            {!p.active
              ? t(' · Akses dibuang', ' · Access removed')
              : p.must_change_password
                ? t(' · Belum tetapkan kata laluan', ' · Has not set a password')
                : ''}
          </Text>
          {admin && p.email !== session?.email && (
            pending?.id === p.id ? (
              <View style={{ gap: 10 }}>
                <Button
                  label={pending.what === 'reset'
                      ? t('Ya, tetapkan semula', 'Yes, reset it')
                      : p.active
                        ? t('Ya, buang akses', 'Yes, remove access')
                        : t('Ya, pulihkan akses', 'Yes, restore access')}
                  danger
                  busy={busy}
                  onPress={() => confirmPending(p)}
                />
                <Button label={t('Kembali', 'Back')} quiet onPress={() => setPending(null)} />
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {p.active && <Button label={t('Tetapkan semula kata laluan', 'Reset password')} quiet onPress={() => setPending({ id: p.id, what: 'reset' })} />}
                <Button
                  label={p.active ? t('Buang akses', 'Remove access') : t('Pulihkan akses', 'Restore access')}
                  quiet={!p.active}
                  danger={p.active}
                  onPress={() => setPending({ id: p.id, what: 'access' })}
                />
              </View>
            )
          )}
        </View>
      ))}
    </ScrollView>
  );
}
