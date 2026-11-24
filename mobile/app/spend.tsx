import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, Fund, newRequestId, RuleVerdict } from '../src/api/client';
import { parseMoney } from '../src/format';
import { useLang } from '../src/lang';
import { colors, fonts, radius, ringgit } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';
import { PURPOSES, purposeName } from '../src/words';

/**
 * The screen the whole product exists for.
 *
 * The rule check runs as soon as a purpose is picked, not on submit. A
 * treasurer should learn that zakat cannot pay the electricity bill before
 * they have typed an amount and a description, not after. When a spend is
 * refused the screen says which fund would work instead, because refusing
 * without offering a way forward just teaches people to work around you.
 *
 * A record is permanent, so it is shown once more before it is made.
 */

export default function SpendScreen() {
  const router = useRouter();
  const { t } = useLang();
  const given = useLocalSearchParams<{ fund?: string; amount?: string; purpose?: string }>();

  const [funds, setFunds] = useState<Fund[]>([]);
  // Never chosen for the person: the wrong fund is the costliest mistake here
  const [fundCode, setFundCode] = useState(given.fund ?? '');
  const [purpose, setPurpose] = useState(PURPOSES.some((p) => p.code === given.purpose) ? given.purpose! : '');
  const [amount, setAmount] = useState(given.amount ?? '');
  const [description, setDescription] = useState('');

  const [verdict, setVerdict] = useState<RuleVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkAgain, setCheckAgain] = useState(0);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [needsApproval, setNeedsApproval] = useState(false);
  const [sent, setSent] = useState(false);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    api
      .funds()
      .then((f) => {
        const usable = f.filter((x) => x.code !== 'cash');
        setFunds(usable);
        setFundCode((c) => (usable.some((x) => x.code === c) ? c : ''));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setVerdict(null);
    if (!fundCode || !purpose) return;
    let newest = true;
    setChecking(true);
    api
      .checkSpend(fundCode, purpose)
      .then((v) => newest && setVerdict(v))
      .catch((e: Error) => newest && setError(e.message))
      .finally(() => newest && setChecking(false));
    return () => {
      newest = false;
      setChecking(false);
    };
  }, [fundCode, purpose, checkAgain]);

  const selected = funds.find((f) => f.code === fundCode);
  const blocked = verdict !== null && !verdict.allowed;
  const money = parseMoney(amount);
  const over = !!selected && !!money && Number(money) > parseFloat(selected.balance);

  function check() {
    setError(null);
    if (!fundCode) return setError(t('Pilih dana dahulu.', 'Choose a fund first.'));
    if (!purpose) return setError(t('Pilih tujuan belanja.', 'Choose what it is for.'));
    if (!money || Number(money) <= 0) {
      return setError(t('Masukkan jumlah yang sah, contohnya 150.00.', 'Enter a valid amount, for example 150.00.'));
    }
    if (over) return setError(t('Jumlah melebihi baki dana ini.', 'The amount is more than this fund holds.'));
    if (!description.trim()) {
      return setError(t('Tulis keterangan ringkas untuk rekod AJK.', 'Write a short note for the committee’s records.'));
    }
    if (checking) return;
    if (!verdict) {
      setCheckAgain((n) => n + 1);
      return;
    }
    Keyboard.dismiss();
    setReview(true);
  }

  async function submit() {
    if (!money) return;
    setError(null);
    setBusy(true);
    const body = {
      fund_code: fundCode,
      amount: money,
      purpose,
      description: description.trim(),
      request_id: requestId.current,
    };
    try {
      if (needsApproval) {
        await api.requestSpend(body);
        setSent(true);
        return;
      }
      const result = await api.disburse(body);
      if (result.ok) setPosted(result.data.reference);
      else if ('refusal' in result) {
        setVerdict(result.refusal);
        setReview(false);
      } else if (result.code === 'approval_required') setNeedsApproval(true);
      else setError(result.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent || posted) {
    return (
      <ScrollView style={form.screen} contentContainerStyle={form.content}>
        <View style={form.card}>
          <Text style={[form.big, { color: colors.green }]}>
            {sent ? t('Dihantar untuk kelulusan', 'Sent for approval') : t('Belanja direkod', 'Spending recorded')}
          </Text>
          <Text style={form.text}>
            {sent
              ? t(
                  'Wang belum direkod keluar. Pentadbir atau AJK lain perlu meluluskannya dahulu.',
                  'The money is not recorded as spent yet. Another admin or committee member must approve it first.',
                )
              : t(`Nombor rekod: ${posted}`, `Record number: ${posted}`)}
          </Text>
        </View>
        <Button label={t('Selesai', 'Done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </ScrollView>
    );
  }

  if (review && selected && money) {
    return (
      <ScrollView style={form.screen} contentContainerStyle={form.content}>
        <Text style={form.lede}>
          {needsApproval
            ? t(
                'Belanja ini perlu diluluskan oleh orang kedua. Semak, kemudian hantar.',
                'This spending needs a second person’s approval. Check, then send.',
              )
            : t('Semak dahulu. Rekod ini kekal dan tidak boleh dipadam.', 'Check first. This record is permanent and cannot be deleted.')}
        </Text>
        <View style={form.card}>
          <Text style={form.big}>{ringgit(money)}</Text>
          <Text style={form.strong}>
            {t('Daripada', 'From')} {t(selected.label_ms, selected.label_en)}
          </Text>
          <Text style={form.text}>
            {t('Untuk', 'For')}: {purposeName(purpose)}
          </Text>
          <Text style={form.text}>{description.trim()}</Text>
          <Text style={form.faint}>
            {t('Baki selepas ini', 'Left after this')}: {ringgit(parseFloat(selected.balance) - Number(money))}
          </Text>
        </View>
        {error && <Notice ok={false} text={error} />}
        <Button
          label={needsApproval ? t('Hantar untuk kelulusan', 'Send for approval') : t('Betul, rekod belanja', 'Correct, record it')}
          busy={busy}
          onPress={submit}
        />
        <Button label={t('Betulkan', 'Go back and fix')} quiet busy={busy} onPress={() => setReview(false)} />
      </ScrollView>
    );
  }

  const groups = [
    { key: 'mosque', label: t('Urusan masjid', 'Running the mosque') },
    { key: 'people', label: t('Program dan kebajikan', 'Programmes and welfare') },
    { key: 'asnaf', label: t('Asnaf zakat', 'Zakat recipients') },
  ];

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      <Text style={form.strong}>{t('Ambil daripada dana mana?', 'From which fund?')}</Text>
      <View style={{ gap: 8 }}>
        {funds.map((f) => {
          const on = f.code === fundCode;
          const name = t(f.label_ms, f.label_en);
          return (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected: on }}
              onPress={() => setFundCode(f.code)}
              style={[s.fund, on && s.fundOn]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.fundName, on && { color: colors.green }]}>{name}</Text>
                {!f.spendable && <Text style={form.faint}>{t('Dikunci', 'Locked')}</Text>}
              </View>
              <Text style={s.fundBalance}>{ringgit(f.balance)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={form.strong}>{t('Untuk apa?', 'What is it for?')}</Text>
      {groups.map((g) => (
        <View key={g.key} style={{ gap: 8 }}>
          <Text style={form.faint}>{g.label}</Text>
          <Choices
            value={purpose}
            onChange={setPurpose}
            options={PURPOSES.filter((p) => p.group === g.key).map((p) => ({ value: p.code, label: t(p.ms, p.en) }))}
          />
        </View>
      ))}

      {checking && (
        <View style={s.checking}>
          <ActivityIndicator size="small" color={colors.green} />
          <Text style={form.text}>{t('Menyemak syarat dana…', 'Checking the fund’s rules…')}</Text>
        </View>
      )}

      {blocked && verdict && (
        <View style={s.block} accessibilityLiveRegion="polite">
          <Text style={[form.strong, { color: colors.danger }]}>{t('Tidak dibenarkan', 'Not allowed')}</Text>
          <Text style={form.text}>{t(verdict.message_ms, verdict.message_en)}</Text>
          {funds.some((f) => verdict.suggested_funds.includes(f.category)) && (
            <>
              <Text style={form.strong}>{t('Guna dana ini sebagai ganti:', 'Use this fund instead:')}</Text>
              <Choices
                value={null}
                onChange={setFundCode}
                options={funds
                  .filter((f) => verdict.suggested_funds.includes(f.category))
                  .map((f) => ({ value: f.code, label: t(f.label_ms, f.label_en) }))}
              />
            </>
          )}
        </View>
      )}
      {verdict?.allowed && selected && (
        <Notice
          ok
          text={t(
            `Dibenarkan. Baki ${selected.label_ms}: ${ringgit(selected.balance)}`,
            `Allowed. ${selected.label_en} holds ${ringgit(selected.balance)}`,
          )}
        />
      )}

      {!blocked && (
        <>
          <Field
            label={t('Jumlah (RM)', 'Amount (RM)')}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            hint={money ? ringgit(money) : undefined}
          />
          {over && (
            <Notice
              ok={false}
              text={t(`Melebihi baki dana (${ringgit(selected!.balance)}).`, `More than the fund holds (${ringgit(selected!.balance)}).`)}
            />
          )}
          <Field
            label={t('Keterangan', 'Note')}
            value={description}
            onChangeText={setDescription}
            maxLength={300}
            placeholder={t('Contoh: bil elektrik bulan ini', 'Example: this month’s electricity bill')}
            hint={t(
              'Jangan tulis nama penerima bantuan. Catatan ini kekal.',
              'Do not write the name of anyone receiving help. This note is permanent.',
            )}
            multiline
          />
          {error && <Notice ok={false} text={error} />}
          <Button label={t('Seterusnya', 'Next')} busy={checking} onPress={check} />
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  fund: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  fundOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  fundName: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  fundBalance: { fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  block: {
    padding: 16,
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,122,107,0.4)',
    backgroundColor: colors.dangerSoft,
  },
});
