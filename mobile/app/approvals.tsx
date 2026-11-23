import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { api, Approval, Fund } from '../src/api/client';
import { fullTime } from '../src/format';
import { colors, ringgit } from '../src/theme';
import { PURPOSES } from './spend';
import { Button, Choices, Field, form, Notice } from '../src/ui/Form';

const STATUS: Record<Approval['status'], string> = {
  pending: 'Menunggu',
  approved: 'Diluluskan',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
};

type Action = 'approve' | 'reject' | 'cancel';
const ASK: Record<Action, string> = {
  approve: 'Ya, luluskan',
  reject: 'Ya, tolak',
  cancel: 'Ya, batalkan',
};

export default function ApprovalsScreen() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([api.approvals(tab === 'pending' ? 'pending' : undefined), api.funds()]);
      setRows(a);
      setFunds(f);
    } catch (e) {
      setRows((r) => r ?? []);
      setNotice({ ok: false, text: (e as Error).message });
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
      setNotice({ ok: true, text: 'Keputusan direkod.' });
      setConfirm(null);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      load();
    }
  }

  const fundName = (code: string | null) => funds.find((f) => f.code === code)?.label_ms ?? code;

  return (
    <ScrollView style={form.screen} contentContainerStyle={form.content}>
      <Text style={form.lede}>Wang keluar dan pembetulan perlu dua orang. Orang yang meminta tidak boleh meluluskan permintaannya sendiri.</Text>
      <Choices
        value={tab}
        onChange={setTab}
        options={[{ value: 'pending', label: 'Menunggu' }, { value: 'all', label: 'Semua' }]}
      />
      {notice && <Notice ok={notice.ok} text={notice.text} />}
      {rows === null && <ActivityIndicator color={colors.green} />}
      {rows?.length === 0 && <Text style={form.text}>Tiada permintaan.</Text>}
      {rows?.map((a) => (
        <View key={a.id} style={form.card}>
          <Text style={form.faint}>{a.kind === 'spend' ? 'Perbelanjaan' : `Pembetulan ${a.target_reference}`} · {STATUS[a.status]}</Text>
          <Text style={form.big}>{ringgit(a.amount)}</Text>
          {a.kind === 'spend' && <Text style={form.strong}>Daripada {fundName(a.fund_code)}</Text>}
          {a.purpose && (
            <Text style={form.text}>Tujuan: {PURPOSES.find((p) => p.code === a.purpose)?.label ?? a.purpose}</Text>
          )}
          <Text style={form.text}>{a.description}</Text>
          <Text style={form.faint}>Diminta oleh {a.requested_by} · {fullTime(a.requested_at)}</Text>
          {a.decided_by && a.decided_at && (
            <Text style={form.faint}>{STATUS[a.status]} oleh {a.decided_by} · {fullTime(a.decided_at)}</Text>
          )}
          {a.decision_note ? <Text style={form.text}>Catatan: {a.decision_note}</Text> : null}

          {confirm?.id === a.id ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              {confirm.action !== 'cancel' && (
                <Field label="Catatan (pilihan)" value={note} onChangeText={setNote} maxLength={500} />
              )}
              <Button label={ASK[confirm.action]} busy={busy} danger={confirm.action !== 'approve'} onPress={act} />
              <Button label="Kembali" quiet onPress={() => setConfirm(null)} />
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 8 }}>
              {a.can_decide && <Button label="Luluskan" onPress={() => start(a.id, 'approve')} />}
              {a.can_decide && <Button label="Tolak" danger onPress={() => start(a.id, 'reject')} />}
              {a.can_cancel && <Button label="Batalkan permintaan" quiet onPress={() => start(a.id, 'cancel')} />}
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
