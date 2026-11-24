import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, ReceiptInfo } from '../../src/api/client';
import { fullTime } from '../../src/format';
import { useLang } from '../../src/lang';
import { colors, ringgit } from '../../src/theme';
import { Button, form, Notice } from '../../src/ui/Form';

export default function ReceiptScreen() {
  const { t } = useLang();
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const router = useRouter();
  const [r, setR] = useState<ReceiptInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .receipt(String(reference))
      .then(setR)
      .catch((e: Error) => setError(e.message));
  }, [reference]);

  async function share() {
    if (!r) return;
    const lines = [
      r.valid ? 'RESIT DERMA' : 'RESIT DIBATALKAN',
      r.institution,
      `No: ${r.number}`,
      `Rujukan: ${r.reference}`,
      `Jumlah: ${ringgit(r.amount)}`,
      `Dana: ${r.fund_ms}`,
      r.donor_name ? `Penderma: ${r.donor_name}` : null,
      `Tarikh: ${fullTime(r.issued_at)}`,
    ];
    try {
      await Share.share({ message: lines.filter(Boolean).join('\n') });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(t('Perkongsian tidak disokong pada peranti ini.', 'Sharing is not supported on this device.'));
    }
  }

  if (!r) {
    return (
      <View style={[form.screen, { padding: 20 }]}>
        {error ? <Notice ok={false} text={error} /> : <ActivityIndicator color={colors.green} />}
      </View>
    );
  }

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content}>
      {!r.valid && <Notice ok={false} text={t('Resit ini telah dibatalkan dan tidak sah.', 'This receipt was cancelled and is not valid.')} />}
      <View style={form.card}>
        <Text style={form.faint}>{r.institution}</Text>
        <Text style={form.strong}>{t('Resit', 'Receipt')} {r.number}</Text>
        <Text style={[form.big, !r.valid && { textDecorationLine: 'line-through' }]}>{ringgit(r.amount)}</Text>
        <Text style={form.text}>{r.fund_ms}</Text>
        <Text style={form.text}>
          {t('Penderma', 'Donor')}: {r.donor_name ?? t('Tanpa nama', 'Anonymous')}
        </Text>
        <Text style={form.text}>{r.description}</Text>
        <Text style={form.faint}>{fullTime(r.issued_at)}</Text>
        <Text style={form.faint}>{t('Direkod oleh', 'Recorded by')} {r.issued_by} · {r.reference}</Text>
      </View>
      {error && <Notice ok={false} text={error} />}
      <Button label={t('Kongsi resit', 'Share receipt')} onPress={share} />
      <Button label={t('Selesai', 'Done')} quiet onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </ScrollView>
  );
}
