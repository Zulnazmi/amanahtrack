import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Alert, AlertStatus, api } from '../src/api/client';
import { timeAgo } from '../src/format';
import { colors, fonts, radius } from '../src/theme';
import { Icon } from '../src/ui/Icon';
import { FadeUp, PressScale, Skeleton } from '../src/ui/motion';
import { SEVERITY, STATUS_LABEL } from '../src/ui/severity';

type Filter = 'open' | 'all';

export default function AlertsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await api.alerts(filter === 'open' ? 'open' : undefined));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load alerts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.green}
          />
        }
      >
        <View style={s.chips}>
          {(['open', 'all'] as Filter[]).map((f) => (
            <PressScale
              key={f}
              onPress={() => {
                setLoading(true);
                setFilter(f);
              }}
              style={[s.chip, filter === f && s.chipOn]}
            >
              <Text style={[s.chipText, filter === f && s.chipTextOn]}>
                {f === 'open' ? 'Needs review' : 'All alerts'}
              </Text>
            </PressScale>
          ))}
        </View>

        {error && (
          <View style={s.errorBar}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {loading ? (
          <View style={{ gap: 12 }}>
            <Skeleton height={104} radius={20} />
            <Skeleton height={104} radius={20} />
            <Skeleton height={104} radius={20} />
          </View>
        ) : alerts.length === 0 ? (
          <FadeUp style={s.empty}>
            <View style={s.emptyIcon}>
              <Icon name="shield" size={26} color={colors.green} />
            </View>
            <Text style={s.emptyTitle}>
              {filter === 'open' ? 'Nothing needs review' : 'No alerts yet'}
            </Text>
            <Text style={s.emptyBody}>
              The box and the ledger raise an alert when something does not add up.
            </Text>
          </FadeUp>
        ) : (
          alerts.map((a, i) => (
            <FadeUp key={a.id} delay={Math.min(i, 6) * 70} distance={12}>
              <AlertCard alert={a} onPress={() => router.push(`/alert/${a.id}`)} />
            </FadeUp>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function AlertCard({ alert: a, onPress }: { alert: Alert; onPress: () => void }) {
  const sev = SEVERITY[a.severity];
  const open = a.status === 'open';
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={[s.card, open && { borderColor: sev.tint + '55' }]}>
      <View style={[s.iconWrap, { backgroundColor: sev.soft }]}>
        <Icon name={a.has_photo ? 'camera' : 'alert'} size={22} color={sev.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.topRow}>
          <Text style={[s.sev, { color: sev.tint }]}>{sev.label.toUpperCase()}</Text>
          <Text style={s.time}>{timeAgo(a.occurred_at)}</Text>
        </View>
        <Text style={s.title} numberOfLines={2}>
          {a.title}
        </Text>
        <View style={s.metaRow}>
          <Text style={s.meta} numberOfLines={1}>
            {a.device_label ?? 'Ledger'}
            {a.has_photo ? '  ·  photo evidence' : ''}
          </Text>
          <View style={[s.pill, open ? s.pillOpen : s.pillDone]}>
            <Text style={[s.pillText, open ? { color: colors.brass } : { color: colors.inkFaint }]}>
              {STATUS_LABEL[a.status as AlertStatus]}
            </Text>
          </View>
        </View>
      </View>
      <Icon name="chevron" size={18} color={colors.inkFaint} />
    </PressScale>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 60, gap: 12 },

  chips: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  chip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.inkSoft },
  chipTextOn: { color: colors.green },

  errorBar: { padding: 12, backgroundColor: colors.dangerSoft, borderRadius: radius.md },
  errorText: { fontFamily: fonts.body, fontSize: 14, color: colors.danger },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkFaint,
    textAlign: 'center',
    maxWidth: 260,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sev: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2 },
  time: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkFaint },
  title: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  meta: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  pill: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  pillOpen: { backgroundColor: colors.brassSoft },
  pillDone: { backgroundColor: colors.surfaceSunk },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 10.5 },
});
