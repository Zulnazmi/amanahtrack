import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { api, Fund, Txn } from '../src/api/client';
import { dayName } from '../src/format';
import { useLang } from '../src/lang';
import { useRetry } from '../src/retry';
import { colors, fonts, radius, ringgit } from '../src/theme';
import { form } from '../src/ui/Form';
import { Icon } from '../src/ui/Icon';
import { stored } from '../src/words';

const MOST = 50;

export default function LedgerScreen() {
  const router = useRouter();
  const { t } = useLang();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [seal, setSeal] = useState<{ checked: number; intact: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  const load = useCallback(() => {
    Promise.all([api.transactions(MOST), api.verify(), api.funds()])
      .then(([x, v, f]) => {
        setTxns(x);
        setSeal(v);
        setFunds(f);
        setError(null);
        setFailures(0);
      })
      .catch((e: Error) => {
        setError(e.message);
        setFailures((n) => n + 1);
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);
  useRetry(failures, load);

  if (loading) {
    return (
      <View style={[form.screen, { padding: 24 }]}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const fundName = (code?: string | null) => {
    const f = funds.find((x) => x.code === code);
    return f ? t(f.label_ms, f.label_en) : null;
  };

  let day = '';
  return (
    <ScrollView style={form.screen} contentContainerStyle={[form.content, { gap: 10 }]}>
      {error && (
        <View style={[s.seal, { backgroundColor: colors.dangerSoft }]}>
          <Text style={[form.text, { color: colors.danger }]}>
            {error} {t('Sedang cuba semula.', 'Trying again.')}
          </Text>
        </View>
      )}

      {seal && (!error || !seal.intact) && (
        <View style={[s.seal, !seal.intact && { backgroundColor: colors.dangerSoft }]}>
          <Icon name={seal.intact ? 'shield' : 'alert'} size={22} color={seal.intact ? colors.green : colors.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[form.strong, { color: seal.intact ? colors.green : colors.danger }]}>
              {seal.intact ? t('Rekod utuh', 'Records intact') : t('Rekod diusik', 'Records altered')}
            </Text>
            <Text style={form.faint}>
              {seal.intact
                ? t(`${seal.checked} rekod disemak. Tekan satu rekod untuk lihat buktinya.`, `${seal.checked} records checked. Tap one to see its proof.`)
                : t('Ada rekod yang tidak sama seperti asal. Maklumkan kepada juruaudit.', 'Some records differ from the original. Tell the auditor.')}
            </Text>
          </View>
        </View>
      )}

      {/* Unread records must never look like no records */}
      {!error && txns.length === 0 && (
        <View style={form.card}>
          <Text style={form.strong}>{t('Belum ada rekod', 'No records yet')}</Text>
          <Text style={form.text}>{t('Rekod derma pertama dari laman Utama.', 'Record the first donation from Home.')}</Text>
        </View>
      )}

      {txns.map((x) => {
        const heading = dayName(x.occurred_at);
        const first = heading !== day;
        day = heading;
        const isVoid = x.status === 'void';
        const sign = x.direction === 'in' ? '+ ' : x.direction === 'out' ? '− ' : '';
        const tint = isVoid ? colors.inkFaint : x.direction === 'in' ? colors.green : colors.ink;
        const way = x.direction === 'in' ? t('Masuk', 'In') : x.direction === 'out' ? t('Keluar', 'Out') : null;
        return (
          <View key={x.reference} style={{ gap: 10 }}>
            {first && <Text style={s.day}>{heading}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${way ?? ''} ${ringgit(x.amount)}, ${stored(x.description)}`}
              style={s.row}
              onPress={() => router.push(`/proof/${x.reference}`)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={2}>
                  {stored(x.description)}
                </Text>
                <Text style={form.faint}>{[way, fundName(x.fund_code), x.reference].filter(Boolean).join(' · ')}</Text>
                {x.status === 'provisional' && (
                  <Text style={[s.tag, { color: colors.warn }]}>{t('Belum dikira', 'Not counted yet')}</Text>
                )}
                {isVoid && <Text style={s.tag}>{t('Dibatalkan', 'Cancelled')}</Text>}
              </View>
              <Text style={[s.amount, { color: tint }, isVoid && { textDecorationLine: 'line-through' }]}>
                {sign}
                {ringgit(x.amount)}
              </Text>
            </Pressable>
          </View>
        );
      })}

      {txns.length === MOST && (
        <Text style={[form.faint, { textAlign: 'center' }]}>
          {t(`${MOST} rekod terkini ditunjukkan.`, `The latest ${MOST} records are shown.`)}
        </Text>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  seal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.greenSoft,
  },
  day: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.inkSoft, marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  name: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  amount: { fontFamily: fonts.display, fontSize: 15.5 },
  tag: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.inkFaint, marginTop: 2 },
});
