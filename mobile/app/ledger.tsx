import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api, Txn } from '../src/api/client';
import { colors, radius, ringgit, space, type } from '../src/theme';

const CHANNEL_LABEL: Record<string, string> = {
  device: 'Tabung sensor',
  telegram: 'Telegram',
  dashboard: 'Aplikasi',
  bank_import: 'Penyata bank',
  qr_payment: 'DuitNow QR',
};

export default function LedgerScreen() {
  const router = useRouter();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [seal, setSeal] = useState<{ checked: number; intact: boolean; head_hash: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.transactions(50), api.verify()])
      .then(([t, v]) => {
        setTxns(t);
        setSeal(v);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={[g.screen, g.centre]}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <ScrollView style={g.screen} contentContainerStyle={g.content}>
      <Text style={g.title}>Lejar</Text>

      {seal && (
        <View style={g.sealCard}>
          <Text style={g.sealTitle}>
            {seal.intact ? 'Rantaian utuh' : 'Rantaian terputus'}
          </Text>
          <Text style={g.sealBody}>{seal.checked} entri dimeterai</Text>
          <Text style={g.sealHash}>{seal.head_hash.slice(0, 32)}…</Text>
          <Text style={g.sealHash}>Tap an entry to see its proof</Text>
        </View>
      )}

      {txns.length === 0 && (
        <View style={g.empty}>
          <Text style={g.emptyTitle}>Belum ada entri</Text>
          <Text style={g.emptyBody}>
            Rekod kutipan pertama melalui Telegram atau aplikasi ini.
          </Text>
        </View>
      )}

      {txns.map((t) => (
        <Pressable
          key={t.reference}
          style={g.row}
          onPress={() => router.push(`/proof/${t.reference}`)}
        >
          <View style={g.rowMain}>
            <Text style={g.rowDesc} numberOfLines={2}>
              {t.description}
            </Text>
            <Text style={g.rowMeta}>
              {CHANNEL_LABEL[t.channel] ?? t.channel} · {t.reference}
            </Text>
          </View>
          <View style={g.rowRight}>
            <Text style={[g.rowAmount, t.status === 'void' && g.voidAmount]}>
              {ringgit(t.amount)}
            </Text>
            {t.status === 'provisional' && (
              <Text style={g.pendingTag}>Belum dikira</Text>
            )}
            {t.status === 'void' && <Text style={g.voidTag}>Dibatalkan</Text>}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const g = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  centre: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxl },
  title: { ...type.title, color: colors.ink, marginBottom: space.lg },

  sealCard: {
    padding: space.md,
    backgroundColor: colors.greenSoft,
    borderRadius: radius.md,
    marginBottom: space.lg,
  },
  sealTitle: { ...type.small, color: colors.green, fontWeight: '600' },
  sealBody: { ...type.small, color: colors.inkSoft, marginTop: 2 },
  sealHash: { ...type.mono, color: colors.inkFaint, marginTop: space.xs },

  empty: { padding: space.xl, alignItems: 'center' },
  emptyTitle: { ...type.heading, color: colors.inkSoft },
  emptyBody: { ...type.small, color: colors.inkFaint, marginTop: space.sm, textAlign: 'center' },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: space.md,
  },
  rowMain: { flex: 1 },
  rowDesc: { ...type.body, color: colors.ink },
  rowMeta: { ...type.small, color: colors.inkFaint, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { ...type.body, color: colors.ink, fontWeight: '600' },
  voidAmount: { color: colors.inkFaint, textDecorationLine: 'line-through' },
  pendingTag: { ...type.micro, color: colors.warn, marginTop: 2 },
  voidTag: { ...type.micro, color: colors.inkFaint, marginTop: 2 },
});
