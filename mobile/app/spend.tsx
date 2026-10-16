import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, Fund, RuleVerdict } from '../src/api/client';
import { colors, radius, ringgit, space, type } from '../src/theme';

/**
 * The screen the whole product exists for.
 *
 * The rule check runs as soon as a purpose is picked, not on submit. A
 * treasurer should learn that zakat cannot pay the electricity bill before
 * they have typed an amount and a description, not after. When a spend is
 * refused the screen says which fund would work instead, because refusing
 * without offering a way forward just teaches people to work around you.
 */

const PURPOSES: { code: string; label: string; group: string }[] = [
  { code: 'asnaf_fakir', label: 'Asnaf fakir', group: 'Asnaf' },
  { code: 'asnaf_miskin', label: 'Asnaf miskin', group: 'Asnaf' },
  { code: 'asnaf_amil', label: 'Asnaf amil', group: 'Asnaf' },
  { code: 'asnaf_gharimin', label: 'Asnaf gharimin', group: 'Asnaf' },
  { code: 'asnaf_ibnussabil', label: 'Ibnus sabil', group: 'Asnaf' },
  { code: 'mosque_maintenance', label: 'Penyelenggaraan', group: 'Operasi' },
  { code: 'utilities', label: 'Bil utiliti', group: 'Operasi' },
  { code: 'staff_salary', label: 'Gaji petugas', group: 'Operasi' },
  { code: 'education', label: 'Kelas agama', group: 'Program' },
  { code: 'orphan_welfare', label: 'Anak yatim', group: 'Program' },
  { code: 'funeral_support', label: 'Khairat kematian', group: 'Program' },
  { code: 'ramadan_programme', label: 'Program Ramadan', group: 'Program' },
];

export default function SpendScreen() {
  const router = useRouter();
  const { fund: fundParam } = useLocalSearchParams<{ fund?: string }>();

  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundCode, setFundCode] = useState(fundParam ?? '');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const [verdict, setVerdict] = useState<RuleVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api.funds().then((f) => {
      setFunds(f);
      if (!fundCode && f.length) setFundCode(f[1]?.code ?? f[0].code);
    });
  }, []);

  const runCheck = useCallback(async () => {
    if (!fundCode || !purpose) {
      setVerdict(null);
      return;
    }
    setChecking(true);
    try {
      setVerdict(await api.checkSpend(fundCode, purpose));
    } finally {
      setChecking(false);
    }
  }, [fundCode, purpose]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const selected = funds.find((f) => f.code === fundCode);
  const blocked = verdict !== null && !verdict.allowed;
  const parsedAmount = parseFloat(amount);
  const overBalance =
    selected && parsedAmount > 0 && parsedAmount > parseFloat(selected.balance);

  async function submit() {
    setFormError(null);

    if (!fundCode) return setFormError('Pilih dana dahulu.');
    if (!purpose) return setFormError('Pilih tujuan perbelanjaan.');
    if (!parsedAmount || parsedAmount <= 0)
      return setFormError('Masukkan jumlah yang sah.');
    if (!description.trim())
      return setFormError('Tulis keterangan ringkas untuk rekod AJK.');

    setSubmitting(true);
    const result = await api.disburse({
      fund_code: fundCode,
      amount: parsedAmount,
      purpose,
      description: description.trim(),
    });
    setSubmitting(false);

    if (result.ok) {
      setPosted(result.data.reference);
      setTimeout(() => router.back(), 1400);
    } else if ('refusal' in result) {
      setVerdict(result.refusal);
    } else {
      setFormError(result.error);
    }
  }

  if (posted) {
    return (
      <View style={[st.screen, st.centre]}>
        <Text style={st.postedTitle}>Direkod</Text>
        <Text style={st.postedRef}>{posted}</Text>
        <Text style={st.postedNote}>Entri telah dimeterai dalam lejar.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.content}>
      <Text style={st.title}>Rekod perbelanjaan</Text>

      <Text style={st.label}>Ambil daripada dana</Text>
      <View style={st.chipRow}>
        {funds
          .filter((f) => f.code !== 'cash')
          .map((f) => {
            const active = f.code === fundCode;
            return (
              <Pressable
                key={f.id}
                onPress={() => setFundCode(f.code)}
                style={[st.chip, active && st.chipActive, !f.spendable && st.chipLocked]}
              >
                <Text style={[st.chipText, active && st.chipTextActive]}>
                  {f.label_ms}
                </Text>
                <Text style={[st.chipSub, active && st.chipSubActive]}>
                  {ringgit(f.balance)}
                </Text>
              </Pressable>
            );
          })}
      </View>

      <Text style={st.label}>Tujuan</Text>
      <View style={st.chipRow}>
        {PURPOSES.map((p) => {
          const active = p.code === purpose;
          return (
            <Pressable
              key={p.code}
              onPress={() => setPurpose(p.code)}
              style={[st.purposeChip, active && st.chipActive]}
            >
              <Text style={[st.chipText, active && st.chipTextActive]}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {checking && (
        <View style={st.checking}>
          <ActivityIndicator size="small" color={colors.inkFaint} />
          <Text style={st.checkingText}>Menyemak hukum dana</Text>
        </View>
      )}

      {blocked && verdict && (
        <View style={st.blockCard}>
          <Text style={st.blockTitle}>Tidak dibenarkan</Text>
          <Text style={st.blockBody}>{verdict.message_ms}</Text>
          <Text style={st.blockBodyEn}>{verdict.message_en}</Text>
          {verdict.suggested_funds.length > 0 && (
            <View style={st.suggestRow}>
              <Text style={st.suggestLabel}>Guna dana ini sebagai ganti:</Text>
              {verdict.suggested_funds.map((code) => {
                const alt = funds.find((f) => f.category === code);
                if (!alt) return null;
                return (
                  <Pressable
                    key={code}
                    style={st.suggestChip}
                    onPress={() => setFundCode(alt.code)}
                  >
                    <Text style={st.suggestChipText}>{alt.label_ms}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      {verdict?.allowed && selected && (
        <View style={st.okCard}>
          <Text style={st.okText}>
            Dibenarkan. Baki {selected.label_ms}: {ringgit(selected.balance)}
          </Text>
        </View>
      )}

      <Text style={st.label}>Jumlah (RM)</Text>
      <TextInput
        style={[st.input, blocked && st.inputDisabled]}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={colors.inkFaint}
        editable={!blocked}
      />
      {overBalance && (
        <Text style={st.fieldError}>
          Melebihi baki dana ({ringgit(selected!.balance)}).
        </Text>
      )}

      <Text style={st.label}>Keterangan</Text>
      <TextInput
        style={[st.input, st.inputMulti, blocked && st.inputDisabled]}
        value={description}
        onChangeText={setDescription}
        placeholder="Contoh: bantuan 6 keluarga asnaf Kampung Baru"
        placeholderTextColor={colors.inkFaint}
        multiline
        editable={!blocked}
      />

      {formError && <Text style={st.fieldError}>{formError}</Text>}

      <Pressable
        style={[st.submit, (blocked || submitting) && st.submitDisabled]}
        onPress={submit}
        disabled={blocked || submitting}
      >
        <Text style={st.submitText}>
          {submitting ? 'Merekod…' : 'Rekod perbelanjaan'}
        </Text>
      </Pressable>

      <Text style={st.footnote}>
        Setiap entri dimeterai dan tidak boleh diubah selepas direkod.
        Pembetulan dibuat dengan catatan balik, bukan suntingan.
      </Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  centre: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxl },

  title: { ...type.title, color: colors.ink, marginBottom: space.lg },
  label: {
    ...type.small,
    color: colors.inkSoft,
    marginTop: space.lg,
    marginBottom: space.sm,
    fontWeight: '600',
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  purposeChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLocked: { borderStyle: 'dashed', borderColor: colors.lineStrong },
  chipText: { ...type.small, color: colors.inkSoft },
  chipTextActive: { color: colors.paper },
  chipSub: { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  chipSubActive: { color: colors.greenSoft },

  checking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
  },
  checkingText: { ...type.small, color: colors.inkFaint },

  blockCard: {
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  blockTitle: { ...type.heading, color: colors.danger },
  blockBody: { ...type.body, color: colors.danger, marginTop: space.sm, lineHeight: 21 },
  blockBodyEn: {
    ...type.small,
    color: colors.danger,
    marginTop: space.xs,
    opacity: 0.75,
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  suggestLabel: { ...type.small, color: colors.danger, width: '100%' },
  suggestChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  suggestChipText: { ...type.small, color: colors.ink },

  okCard: {
    marginTop: space.lg,
    padding: space.md,
    backgroundColor: colors.greenSoft,
    borderRadius: radius.md,
  },
  okText: { ...type.small, color: colors.green },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    ...type.body,
    color: colors.ink,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  inputDisabled: { backgroundColor: colors.surfaceSunk, color: colors.inkFaint },
  fieldError: { ...type.small, color: colors.danger, marginTop: space.xs },

  submit: {
    marginTop: space.xl,
    backgroundColor: colors.ink,
    padding: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: colors.lineStrong },
  submitText: { ...type.body, color: colors.paper, fontWeight: '600' },

  footnote: {
    ...type.small,
    color: colors.inkFaint,
    marginTop: space.lg,
    lineHeight: 19,
  },

  postedTitle: { ...type.title, color: colors.green },
  postedRef: { ...type.mono, color: colors.inkSoft, marginTop: space.sm },
  postedNote: { ...type.small, color: colors.inkFaint, marginTop: space.sm },
});
