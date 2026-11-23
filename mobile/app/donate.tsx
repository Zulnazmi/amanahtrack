import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { api, Fund, newRequestId } from '../src/api/client';
import { parseMoney } from '../src/format';
import { ringgit } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';

/** Money handed to the committee, not through the box. */
export default function DonateScreen() {
  const router = useRouter();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fund, setFund] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [donor, setDonor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    api
      .funds()
      .then((f) => setFunds(f.filter((x) => x.code !== 'cash')))
      .catch((e: Error) => setError(e.message));
  }, []);

  const money = parseMoney(amount);

  async function submit() {
    setError(null);
    if (!fund) return setError('Pilih dana penerima.');
    if (!money || Number(money) <= 0) return setError('Masukkan jumlah yang sah, contohnya 150.00.');
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

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      <Text style={form.lede}>Untuk wang tunai yang diserahkan terus kepada AJK. Wang dalam tabung direkod melalui kiraan.</Text>
      <Text style={form.strong}>Dana penerima</Text>
      <Choices value={fund} onChange={setFund} options={funds.map((f) => ({ value: f.code, label: f.label_ms }))} />
      <Field
        label="Jumlah (RM)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={money ? ringgit(money) : undefined}
      />
      <Field
        label="Nama penderma (pilihan)"
        value={donor}
        onChangeText={setDonor}
        autoCapitalize="words"
        maxLength={120}
        hint="Kosongkan jika penderma mahu tanpa nama. Nama hanya pada resit, bukan dalam lejar."
      />
      <Field
        label="Catatan (pilihan)"
        value={description}
        onChangeText={setDescription}
        maxLength={300}
        placeholder="Contoh: derma selepas Jumaat"
        hint="Jangan tulis nama penderma di sini. Catatan ini kekal dalam lejar."
      />
      {error && <Notice ok={false} text={error} />}
      <Button label="Rekod derma" busy={busy} onPress={submit} />
    </ScrollView>
  );
}
