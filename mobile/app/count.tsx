import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api, CountResult, DeviceStatus, Fund, newRequestId } from '../src/api/client';
import { parseMoney } from '../src/format';
import { useLang } from '../src/lang';
import { colors, ringgit } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';

/**
 * Counting day.
 *
 * Only people count money. The box guards the cash; two or more witnesses
 * count it, and what they counted goes into the records, after one more look.
 */

export default function CountScreen() {
  const router = useRouter();
  const { t } = useLang();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [counted, setCounted] = useState('');
  const [boxes, setBoxes] = useState<DeviceStatus[]>([]);
  const [box, setBox] = useState<string | null>(null);
  const [fund, setFund] = useState('');
  const [names, setNames] = useState(['', '']);
  const requestId = useRef(newRequestId());
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const [result, setResult] = useState<CountResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.funds(), api.devices()])
      .then(([f, d]) => {
        setFunds(f.filter((x) => x.code !== 'cash'));
        setBoxes(d);
        if (d.length === 1) setBox(d[0].serial);
        if (d.length === 0) setBox('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const money = parseMoney(counted);
  const who = names.map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean);

  function check() {
    setError(null);
    if (box === null) return setError(t('Pilih tabung dahulu.', 'Choose the box first.'));
    if (!money || Number(money) <= 0) {
      return setError(t('Masukkan jumlah yang sah, contohnya 1250.50.', 'Enter a valid amount, for example 1250.50.'));
    }
    if (who.length < 2) {
      return setError(t('Masukkan nama sekurang-kurangnya dua saksi.', 'Enter the names of at least two witnesses.'));
    }
    if (new Set(who.map((n) => n.toLowerCase())).size < who.length) {
      return setError(t('Setiap saksi mesti orang yang berbeza.', 'Each witness must be a different person.'));
    }
    if (box === '' && !fund) return setError(t('Pilih dana untuk wang ini.', 'Choose the fund for this money.'));
    Keyboard.dismiss();
    setReview(true);
  }

  async function submit() {
    if (!money) return;
    setError(null);
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
      setError(e instanceof Error ? e.message : t('Tidak dapat merekod kiraan.', 'Could not record the count.'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ScrollView style={form.screen} contentContainerStyle={form.content}>
        <View style={form.card}>
          <Text style={[form.strong, { color: colors.green }]}>{t('Kiraan direkod', 'Count recorded')}</Text>
          <Text style={form.big}>{ringgit(result.counted)}</Text>
          <Text style={form.text}>
            {t('Jumlah ini disimpan bersama nama saksi.', 'This amount is saved with the witnesses’ names.')}
          </Text>
        </View>
        <Button label={t('Selesai', 'Done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </ScrollView>
    );
  }

  if (review && money) {
    const chosen = funds.find((f) => f.code === fund);
    const from = boxes.find((b) => b.serial === box);
    return (
      <ScrollView style={form.screen} contentContainerStyle={form.content}>
        <Text style={form.lede}>
          {t('Semak bersama saksi. Rekod ini kekal dan tidak boleh dipadam.', 'Check with the witnesses. This record is permanent and cannot be deleted.')}
        </Text>
        <View style={form.card}>
          <Text style={form.big}>{ringgit(money)}</Text>
          <Text style={form.text}>
            {t('Tabung', 'Box')}: {from?.label ?? t('Tanpa tabung pintar', 'No smart box')}
          </Text>
          <Text style={form.text}>
            {t('Dana', 'Fund')}: {chosen ? t(chosen.label_ms, chosen.label_en) : t('Ikut tetapan tabung', 'As the box is set')}
          </Text>
          <Text style={form.text}>
            {t('Saksi', 'Witnesses')}: {who.join(', ')}
          </Text>
          {note.trim() !== '' && (
            <Text style={form.text}>
              {t('Catatan', 'Note')}: {note.trim()}
            </Text>
          )}
        </View>
        {error && <Notice ok={false} text={error} />}
        <Button label={t('Betul, sahkan kiraan', 'Correct, confirm count')} busy={busy} onPress={submit} />
        <Button label={t('Betulkan', 'Go back and fix')} quiet busy={busy} onPress={() => setReview(false)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content} keyboardShouldPersistTaps="handled">
      <Text style={form.lede}>
        {t(
          'Buka tabung bersama sekurang-kurangnya dua orang, kira wang tunai, dan masukkan jumlah sebenar.',
          'Open the box with at least two people, count the cash, and enter the actual amount.',
        )}
      </Text>

      {boxes.length > 0 && (
        <>
          <Text style={form.strong}>{t('Tabung', 'Box')}</Text>
          <Choices
            value={box}
            onChange={setBox}
            options={[
              ...boxes.map((b) => ({ value: b.serial, label: b.label })),
              { value: '', label: t('Tanpa tabung pintar', 'No smart box') },
            ]}
          />
        </>
      )}

      <Field
        label={t('Jumlah dikira (RM)', 'Amount counted (RM)')}
        value={counted}
        onChangeText={setCounted}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={money ? ringgit(money) : undefined}
      />

      <Text style={form.strong}>
        {box === '' ? t('Untuk dana mana?', 'For which fund?') : t('Untuk dana mana? (pilihan)', 'For which fund? (optional)')}
      </Text>
      {box !== '' && (
        <Text style={form.faint}>{t('Jika tidak dipilih, ikut tetapan tabung.', 'If not chosen, the box’s own setting is used.')}</Text>
      )}
      <Choices
        value={fund}
        onChange={(v) => setFund(v === fund ? '' : v)}
        options={funds.map((f) => ({ value: f.code, label: t(f.label_ms, f.label_en) }))}
      />

      {names.map((n, i) => (
        <Field
          key={i}
          label={`${t('Nama saksi', 'Witness')} ${i + 1}${i > 1 ? ` (${t('pilihan', 'optional')})` : ''}`}
          value={n}
          onChangeText={(v) => setNames(names.map((x, j) => (j === i ? v : x)))}
          autoCapitalize="words"
          maxLength={80}
        />
      ))}
      {names.length < 5 && (
        <Button label={t('Tambah saksi', 'Add a witness')} quiet onPress={() => setNames([...names, ''])} />
      )}

      <Field
        label={t('Catatan (pilihan)', 'Note (optional)')}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        placeholder={t('Contoh: dikira selepas solat Jumaat', 'Example: counted after Friday prayer')}
        multiline
      />

      {error && <Notice ok={false} text={error} />}
      <Button label={t('Seterusnya', 'Next')} onPress={check} />
    </ScrollView>
  );
}
