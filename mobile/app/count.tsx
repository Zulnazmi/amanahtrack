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
 * The box has an estimate; the committee counts the actual cash. The gap
 * between the two is written down permanently instead of being quietly
 * absorbed. Framing matters here: a clean count is evidence that the people
 * who handled the money handled it honestly, and the copy says so. Treating
 * every variance as an accusation is how you get a committee that stops
 * using the app.
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

  const cash = funds.find((f) => f.code === 'cash');
  const estimate = cash ? parseFloat(cash.provisional) : 0;
  const money = parseMoney(counted);
  // The estimate covers every box, so it only means something with one.
  const comparable = boxes.length === 1 && box === boxes[0].serial;
  const preview = money && comparable ? Number(money) - estimate : null;

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
    const variance = parseFloat(result.variance);
    const clean = Math.abs(variance) < 0.01;
    return (
      <ScrollView style={c.screen} contentContainerStyle={c.content}>
        <Text style={c.title}>Kiraan direkod</Text>

        <View style={c.resultRow}>
          <Text style={c.resultLabel}>Anggaran tabung</Text>
          <Text style={c.resultValue}>{ringgit(result.estimated)}</Text>
        </View>
        <View style={c.resultRow}>
          <Text style={c.resultLabel}>Dikira oleh AJK</Text>
          <Text style={c.resultValue}>{ringgit(result.counted)}</Text>
        </View>
        <View style={[c.resultRow, c.resultRowLast]}>
          <Text style={c.resultLabel}>Perbezaan</Text>
          <Text style={[c.resultValue, !clean && c.varianceValue]}>
            {ringgit(result.variance)}
          </Text>
        </View>

        <View style={clean ? c.cleanCard : c.flagCard}>
          <Text style={clean ? c.cleanTitle : c.flagTitle}>
            {clean ? 'Sepadan sepenuhnya' : 'Perbezaan dicatat'}
          </Text>
          <Text style={clean ? c.cleanBody : c.flagBody}>
            {clean
              ? 'Jumlah dikira sepadan dengan anggaran tabung. Rekod ini menjadi bukti bahawa kutipan diuruskan dengan amanah.'
              : 'Perbezaan disimpan kekal dalam lejar bersama bilangan saksi. Sensor memberi anggaran, bukan jumlah tepat, jadi perbezaan kecil adalah biasa.'}
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

      {comparable && <View style={c.estimateCard}>
        <Text style={c.estimateLabel}>Anggaran daripada sensor</Text>
        <Text style={c.estimateValue}>{ringgit(estimate)}</Text>
        <Text style={c.estimateNote}>
          Anggaran berdasarkan berat dan bilangan kemasukan. Bukan jumlah muktamad.
        </Text>
      </View>}

      <Text style={c.label}>Jumlah dikira (RM)</Text>
      <TextInput
        style={c.input}
        value={counted}
        onChangeText={setCounted}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
      />

      {preview !== null && (
        <Text style={c.preview}>
          Perbezaan: {ringgit(preview)}
          {Math.abs(preview) >= 20 ? ' — akan ditanda untuk semakan' : ''}
        </Text>
      )}

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

  estimateCard: {
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surfaceSunk,
    borderRadius: radius.md,
  },
  estimateLabel: { ...type.small, color: colors.inkSoft },
  estimateValue: { ...type.title, color: colors.ink, marginTop: space.xs },
  estimateNote: { ...type.small, color: colors.inkFaint, marginTop: space.sm, lineHeight: 18 },

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
  varianceValue: { color: colors.warn },

  cleanCard: { marginTop: space.lg, padding: space.lg, backgroundColor: colors.greenSoft, borderRadius: radius.md },
  cleanTitle: { ...type.heading, color: colors.green },
  cleanBody: { ...type.small, color: colors.green, marginTop: space.sm, lineHeight: 20 },
  flagCard: { marginTop: space.lg, padding: space.lg, backgroundColor: colors.warnSoft, borderRadius: radius.md },
  flagTitle: { ...type.heading, color: colors.warn },
  flagBody: { ...type.small, color: colors.warn, marginTop: space.sm, lineHeight: 20 },
});
