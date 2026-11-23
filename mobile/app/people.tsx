import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { api, Person, Session } from '../src/api/client';
import { useSession } from '../src/session';
import { colors } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';

const ROLES: { value: Session['role']; label: string }[] = [
  { value: 'treasurer', label: 'Bendahari' },
  { value: 'committee', label: 'AJK' },
  { value: 'auditor', label: 'Juruaudit' },
  { value: 'admin', label: 'Admin' },
];
const ROLE = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

type Pending = { id: string; what: 'access' | 'reset' };

export default function PeopleScreen() {
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
    if (name.trim().length < 2 || !email.includes('@')) return setError('Masukkan nama dan e-mel yang sah.');
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
          <Text style={form.strong}>Kata laluan sementara untuk {temp.name}</Text>
          <Text selectable style={form.big}>{temp.password}</Text>
          <Text style={form.text}>Berikan kepada orang itu sahaja. Ia hanya ditunjukkan sekali dan mesti ditukar semasa log masuk.</Text>
          <Button label="Sudah disalin" quiet onPress={() => setTemp(null)} />
        </View>
      )}
      {error && <Notice ok={false} text={error} />}

      {admin && !adding && <Button label="Tambah pengguna" onPress={() => setAdding(true)} />}
      {adding && (
        <View style={form.card}>
          <Field label="Nama penuh" value={name} onChangeText={setName} autoCapitalize="words" maxLength={120} />
          <Field label="E-mel" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <Text style={form.strong}>Peranan</Text>
          <Choices value={role} onChange={setRole} options={ROLES} />
          <Button label="Tambah" busy={busy} onPress={add} />
          <Button label="Batal" quiet onPress={() => setAdding(false)} />
        </View>
      )}

      {people === null && <ActivityIndicator color={colors.green} />}
      {people?.map((p) => (
        <View key={p.id} style={[form.card, !p.active && { opacity: 0.65 }]}>
          <Text style={form.strong}>{p.name}</Text>
          <Text style={form.faint}>{p.email}</Text>
          <Text style={form.text}>
            {ROLE[p.role]}{!p.active ? ' · Akses dibuang' : p.must_change_password ? ' · Belum tetapkan kata laluan' : ''}
          </Text>
          {admin && p.email !== session?.email && (
            pending?.id === p.id ? (
              <View style={{ gap: 10 }}>
                <Button
                  label={pending.what === 'reset' ? 'Ya, tetapkan semula' : p.active ? 'Ya, buang akses' : 'Ya, pulihkan akses'}
                  danger
                  busy={busy}
                  onPress={() => confirmPending(p)}
                />
                <Button label="Kembali" quiet onPress={() => setPending(null)} />
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {p.active && <Button label="Tetapkan semula kata laluan" quiet onPress={() => setPending({ id: p.id, what: 'reset' })} />}
                <Button
                  label={p.active ? 'Buang akses' : 'Pulihkan akses'}
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
