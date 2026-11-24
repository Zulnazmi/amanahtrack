import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { api, Approval, Fund } from '../src/api/client';
import { useLang } from '../src/lang';
import { useRetry } from '../src/retry';
import { fullTime } from '../src/format';
import { colors, ringgit } from '../src/theme';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';
import { purposeName } from '../src/words';

const STATUS: Record<Approval['status'], [string, string]> = {
  pending: ['Menunggu', 'Waiting'],
  approved: ['Diluluskan', 'Approved'],
  rejected: ['Ditolak', 'Rejected'],
  cancelled: ['Dibatalkan', 'Cancelled'],
};

type Action = 'approve' | 'reject' | 'cancel';
const ASK: Record<Action, [string, string]> = {
  approve: ['Ya, luluskan', 'Yes, approve'],
  reject: ['Ya, tolak', 'Yes, reject'],
  cancel: ['Ya, batalkan', 'Yes, cancel it'],
};

export default function ApprovalsScreen() {
  const { t } = useLang();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  const load = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([api.approvals(tab === 'pending' ? 'pending' : undefined), api.funds()]);
      setRows(a);
      setFunds(f);
      setLoadError(null);
      setFailures(0);
    } catch (e) {
      setLoadError((e as Error).message);
      setFailures((n) => n + 1);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useRetry(failures, load);

  function start(id: string, action: Action) {
    setNotice(null);
    setNote('');
    setConfirm({ id, action });
  }

  async function act() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === 'cancel') await api.cancelApproval(confirm.id);
      else await api.decide(confirm.id, confirm.action, note.trim());
      setNotice({ ok: true, text: t('Keputusan direkod.', 'Decision recorded.') });
      setConfirm(null);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      load();
    }
  }

  const fundName = (code: string | null) => {
    const f = funds.find((x) => x.code === code);
    return f ? t(f.label_ms, f.label_en) : code;
  };

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content}>
      <Text style={form.lede}>
        {t(
          'Wang keluar dan pembetulan perlu dua orang. Orang yang meminta tidak boleh meluluskan permintaannya sendiri.',
          'Spending and corrections need two people. Nobody can approve their own request.',
        )}
      </Text>
      <Choices
        value={tab}
        onChange={(next) => {
          if (next === tab) return;
          setRows(null);
          setTab(next);
        }}
        options={[{ value: 'pending', label: t('Menunggu', 'Waiting') }, { value: 'all', label: t('Semua', 'All') }]}
      />
      {notice && <Notice ok={notice.ok} text={notice.text} />}
      {loadError && <Notice ok={false} text={`${loadError} ${t('Sedang cuba semula.', 'Trying again.')}`} />}
      {rows === null && !loadError && <ActivityIndicator color={colors.green} />}
      {!loadError && rows?.length === 0 && <Text style={form.text}>{t('Tiada permintaan.', 'No requests.')}</Text>}
      {rows?.map((a) => (
        <View key={a.id} style={form.card}>
          <Text style={form.faint}>{a.kind === 'spend' ? t('Belanja', 'Spending') : `${t('Pembetulan', 'Correction')} ${a.target_reference}`} · {t(...STATUS[a.status])}</Text>
          <Text style={form.big}>{ringgit(a.amount)}</Text>
          {a.kind === 'spend' && <Text style={form.strong}>{t('Daripada', 'From')} {fundName(a.fund_code)}</Text>}
          {a.purpose && (
            <Text style={form.text}>{t('Untuk', 'For')}: {purposeName(a.purpose)}</Text>
          )}
          <Text style={form.text}>{a.description}</Text>
          <Text style={form.faint}>{t('Diminta oleh', 'Asked by')} {a.requested_by} · {fullTime(a.requested_at)}</Text>
          {a.decided_by && a.decided_at && (
            <Text style={form.faint}>{t(...STATUS[a.status])} {t('oleh', 'by')} {a.decided_by} · {fullTime(a.decided_at)}</Text>
          )}
          {a.decision_note ? <Text style={form.text}>{t('Catatan', 'Note')}: {a.decision_note}</Text> : null}

          {confirm?.id === a.id ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              {confirm.action !== 'cancel' && (
                <Field label={t('Catatan (pilihan)', 'Note (optional)')} value={note} onChangeText={setNote} maxLength={500} />
              )}
              <Button label={t(...ASK[confirm.action])} busy={busy} danger={confirm.action !== 'approve'} onPress={act} />
              <Button label={t('Kembali', 'Back')} quiet onPress={() => setConfirm(null)} />
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 8 }}>
              {a.can_decide && <Button label={t('Luluskan', 'Approve')} onPress={() => start(a.id, 'approve')} />}
              {a.can_decide && <Button label={t('Tolak', 'Reject')} danger onPress={() => start(a.id, 'reject')} />}
              {a.can_cancel && <Button label={t('Batalkan permintaan', 'Cancel request')} quiet onPress={() => start(a.id, 'cancel')} />}
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
