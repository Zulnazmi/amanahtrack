import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';

import { api } from '../api/client';
import { useLang } from '../lang';
import { setUpPush, usePushState } from '../push';
import { Button, form, Notice } from './Form';

/** Whether this phone gets notifications, and a button that proves it. */
export function PushSettings() {
  const { t } = useLang();
  const state = usePushState();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Back from the phone's own settings
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && state === 'denied') setUpPush(false);
    });
    return () => sub.remove();
  }, [state]);

  const test = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.testPush();
      setResult(
        r.ok
          ? { ok: true, text: t('Ujian dihantar. Notifikasi sepatutnya muncul sekarang.', 'Test sent. The notification should appear now.') }
          : { ok: false, text: `${t('Notifikasi tidak dapat dihantar.', 'The notification could not be sent.')} (${r.problem})` },
      );
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [t]);

  const words = {
    checking: t('Sedang disediakan…', 'Setting up…'),
    on: t('Dihidupkan pada telefon ini.', 'On for this phone.'),
    denied: t('Dimatikan dalam tetapan telefon.', 'Turned off in the phone settings.'),
    failed: t('Telefon ini belum dapat didaftarkan.', 'This phone could not be registered.'),
    unavailable: t('Tidak disokong pada peranti ini.', 'Not supported on this device.'),
  }[state];

  return (
    <>
      <Text style={form.strong}>{t('Notifikasi', 'Notifications')}</Text>
      <View style={form.card}>
        <Text style={form.text}>{words}</Text>
        {state === 'on' && <Button label={t('Uji notifikasi', 'Test notification')} quiet busy={busy} onPress={test} />}
        {state === 'denied' && (
          <Button label={t('Buka tetapan telefon', 'Open phone settings')} quiet onPress={() => Linking.openSettings()} />
        )}
        {state === 'failed' && <Button label={t('Cuba lagi', 'Try again')} quiet onPress={() => setUpPush()} />}
        {result && <Notice ok={result.ok} text={result.text} />}
      </View>
    </>
  );
}
