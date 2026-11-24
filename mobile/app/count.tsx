import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { api, CountResult, DeviceStatus, Fund, newRequestId } from '../src/api/client';
import { parseMoney } from '../src/format';
import { Choices } from '../src/ui/Form';
import { colors, radius, ringgit, space, type } from '../src/theme';

/**
 * Counting day.
 *
 * Only people count money. The box guards the cash; two or more witnesses
 * count it, and what they counted goes into the ledger.
 */

export default function CountScreen() {
  const router = useRouter();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [counted, setCounted] = useState('');
  const [boxes, setBoxes] = useState<DeviceStatus[]>([]);
  const [box, setBox] = useState<string | null>(null);
  const [fund, setFund] = useState('');
  const [names, setNames] = useState(['', '']);
  const requestId = useRef(newRequestId());
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CountResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.funds(), api.devices()])
      .then(([f, d]) => {
        setFunds(f);
        setBoxes(d);
        if (d.length === 1) setBox(d[0].serial);
        if (d.length === 0) setBox('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const money = parseMoney(counted);

  async function submit() {
    setError(null);
    if (box === null) {
      setError('Pilih tabung dahulu.');
      return;
    }
    if (!money) {
      setError('Masukkan jumlah yang sah, contohnya 1250.50.');
      return;
    }
    const who = names.map((n) => n.trim()).filter(Boolean);
    if (who.length < 2) {
      setError('Masukkan nama sekurang-kurangnya dua saksi.');
      return;
    }
    if (box === '' && !fund) {
      setError('Pilih dana untuk wang ini.');
      return;
    }
    setBusy(true);
    try {
      setResult(
        await api.closeCount({
          device_serial: box || undefined,
          fund_code: fund || undefined,
          counted_total: money,
          witnesses: who,
          note: note.trim() || undefined,
          request_id: requestId.current,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tidak dapat merekod kiraan');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ScrollView style={c.screen} contentContainerStyle={c.content}>
        <Text style={c.title}>Kiraan direkod</Text>

        <View style={[c.resultRow, c.resultRowLast]}>
          <Text style={c.resultLabel}>Dikira oleh AJK</Text>
          <Text style={c.resultValue}>{ringgit(result.counted)}</Text>
        </View>

        <View style={c.cleanCard}>
          <Text style={c.cleanTitle}>Disimpan dalam lejar</Text>
          <Text style={c.cleanBody}>
            Jumlah ini direkod bersama nama saksi dan dimeterai dalam lejar.
          </Text>
        </View>

        <Pressable style={c.submit} onPress={() => router.back()}>
          <Text style={c.submitText}>Selesai</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={c.screen} contentContainerStyle={c.content}>
      <Text style={c.title}>Kiraan tabung</Text>
      <Text style={c.lede}>
        Buka tabung bersama sekurang-kurangnya dua orang AJK, kira tunai, dan
        masukkan jumlah sebenar di bawah.
      </Text>

      {boxes.length > 0 && (
        <>
          <Text style={c.label}>Tabung</Text>
          <Choices
            value={box}
            onChange={setBox}
            options={[
              ...boxes.map((b) => ({ value: b.serial, label: b.label })),
              { value: '', label: 'Tanpa tabung pintar' },
            ]}
          />
        </>
      )}

      <Text style={c.label}>Jumlah dikira (RM)</Text>
      <TextInput
        style={c.input}
        value={counted}
        onChangeText={setCounted}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
      />

      <Text style={c.label}>{box === '' ? 'Dana' : 'Dana (kosongkan untuk ikut tetapan tabung)'}</Text>
      <Choices
        value={fund}
        onChange={(v) => setFund(v === fund ? '' : v)}
        options={funds.filter((f) => f.code !== 'cash').map((f) => ({ value: f.code, label: f.label_ms }))}
      />

      {names.map((n, i) => (
        <View key={i}>
          <Text style={c.label}>Nama saksi {i + 1}{i > 1 ? ' (pilihan)' : ''}</Text>
          <TextInput
            style={c.input}
            value={n}
            onChangeText={(v) => setNames(names.map((x, j) => (j === i ? v : x)))}
            autoCapitalize="words"
            accessibilityLabel={`Nama saksi ${i + 1}`}
          />
        </View>
      ))}
      {names.length < 5 && (
        <Pressable onPress={() => setNames([...names, ''])} style={{ paddingVertical: space.md }}>
          <Text style={c.preview}>+ Tambah saksi</Text>
        </Pressable>
      )}

      <Text style={c.label}>Catatan (pilihan)</Text>
      <TextInput
        style={[c.input, c.inputMulti]}
        value={note}
        onChangeText={setNote}
        placeholder="Contoh: dikira selepas solat Jumaat"
        placeholderTextColor={colors.inkFaint}
        multiline
      />

      {error && <Text style={c.error}>{error}</Text>}

      <Pressable style={[c.submit, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
        <Text style={c.submitText}>{busy ? 'Merekod…' : 'Sahkan kiraan'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const c = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.lg, paddingBottom: space.xxl },
  title: { ...type.title, color: colors.ink },
  lede: { ...type.small, color: colors.inkFaint, marginTop: space.sm, lineHeight: 20 },


  label: { ...type.small, color: colors.inkSoft, marginTop: space.lg, marginBottom: space.sm, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    ...type.body,
    color: colors.ink,
  },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },
  preview: { ...type.small, color: colors.warn, marginTop: space.sm },
  error: { ...type.small, color: colors.danger, marginTop: space.md },

  submit: {
    marginTop: space.xl,
    backgroundColor: colors.ink,
    padding: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitText: { ...type.body, color: colors.paper, fontWeight: '600' },

  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  resultRowLast: { borderBottomWidth: 0 },
  resultLabel: { ...type.body, color: colors.inkSoft },
  resultValue: { ...type.body, color: colors.ink, fontWeight: '600' },

  cleanCard: { marginTop: space.lg, padding: space.lg, backgroundColor: colors.greenSoft, borderRadius: radius.md },
  cleanTitle: { ...type.heading, color: colors.green },
  cleanBody: { ...type.small, color: colors.green, marginTop: space.sm, lineHeight: 20 },
});
