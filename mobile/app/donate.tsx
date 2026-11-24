import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, Fund, newRequestId } from '../src/api/client';
import { parseMoney } from '../src/format';
import { useLang } from '../src/lang';
import { ringgit } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';

/**
 * Money handed to the committee, not through the box.
 *
 * A record is permanent, so it is shown once more before it is made.
 */
export default function DonateScreen() {
  const router = useRouter();
  const [funds, setFunds] = useState<Fund[]>([]);
  // The assistant may fill these in; the person still checks and confirms
  const given = useLocalSearchParams<{ fund?: string; amount?: string }>();
  const [fund, setFund] = useState(given.fund ?? '');
  const [amount, setAmount] = useState(given.amount ?? '');
  const [description, setDescription] = useState('');
  const [donor, setDonor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const { t } = useLang();
  const requestId = useRef(newRequestId());

  useEffect(() => {
    api
      .funds()
      .then((f) => {
        const usable = f.filter((x) => x.code !== 'cash');
        setFunds(usable);
        setFund((c) => (usable.some((x) => x.code === c) ? c : ''));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const money = parseMoney(amount);

  function review() {
    setError(null);
    if (!fund) return setError(t('Pilih tabung yang menerima derma.', 'Choose the fund that receives it.'));
    if (!money || Number(money) <= 0) {
      return setError(t('Masukkan jumlah yang sah, contohnya 150.00.', 'Enter a valid amount, for example 150.00.'));
    }
    Keyboard.dismiss();
    setChecking(true);
  }

  async function submit() {
    if (!money) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.donate({
        fund_code: fund,
        amount: money,
        description: description.trim() || 'Derma tunai',
        donor_name: donor.trim() || undefined,
        request_id: requestId.current,
      });
      router.replace(`/receipt/${r.reference}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = funds.find((f) => f.code === fund);
  if (checking && chosen && money) {
    return (
      <ScrollView style={form.screen} contentContainerStyle={form.content}>
        <Text style={form.lede}>
          {t('Semak dahulu. Rekod ini kekal dan tidak boleh dipadam.', 'Check first. This record is permanent and cannot be deleted.')}
        </Text>
        <View style={form.card}>
          <Text style={form.big}>{ringgit(money)}</Text>
          <Text style={form.strong}>{t(chosen.label_ms, chosen.label_en)}</Text>
          <Text style={form.text}>
            {t('Penderma', 'Donor')}: {donor.trim() || t('Tanpa nama', 'Anonymous')}
          </Text>
          <Text style={form.text}>
            {t('Catatan', 'Note')}: {description.trim() || t('Tiada', 'None')}
          </Text>
        </View>
        {error && <Notice ok={false} text={error} />}
        <Button label={t('Betul, rekod derma', 'Correct, record it')} busy={busy} onPress={submit} />
        <Button label={t('Betulkan', 'Go back and fix')} quiet busy={busy} onPress={() => setChecking(false)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      <Text style={form.lede}>
        {t(
          'Untuk wang tunai yang diserahkan terus kepada AJK. Wang dalam tabung direkod melalui Kira tabung.',
          'For cash handed straight to the committee. Money in the box is recorded through Box count.',
        )}
      </Text>
      <Text style={form.strong}>{t('Untuk tabung mana?', 'For which fund?')}</Text>
      <Choices value={fund} onChange={setFund} options={funds.map((f) => ({ value: f.code, label: t(f.label_ms, f.label_en) }))} />
      <Field
        label={t('Jumlah (RM)', 'Amount (RM)')}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={money ? ringgit(money) : undefined}
      />
      <Field
        label={t('Nama penderma (pilihan)', 'Donor name (optional)')}
        value={donor}
        onChangeText={setDonor}
        autoCapitalize="words"
        maxLength={120}
        hint={t(
          'Kosongkan jika penderma mahu tanpa nama. Nama hanya pada resit, bukan dalam rekod kewangan.',
          'Leave empty for an anonymous donor. The name is only on the receipt, not in the financial records.',
        )}
      />
      <Field
        label={t('Catatan (pilihan)', 'Note (optional)')}
        value={description}
        onChangeText={setDescription}
        maxLength={300}
        placeholder={t('Contoh: derma selepas Jumaat', 'Example: after Friday prayer')}
        hint={t('Jangan tulis nama penderma di sini. Catatan ini kekal.', 'Do not write the donor’s name here. This note is permanent.')}
      />
      {error && <Notice ok={false} text={error} />}
      <Button label={t('Seterusnya', 'Next')} onPress={review} />
    </ScrollView>
  );
}
