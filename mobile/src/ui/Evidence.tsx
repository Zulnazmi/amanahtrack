import { StyleSheet, Text, View } from 'react-native';

import type { Check } from '../api/client';
import { colors, fonts, radius } from '../theme';
import { Icon } from './Icon';
import { FadeUp } from './motion';

/** A full SHA-256 in monospace, split in two lines so it can be compared by eye. */
export function HashBlock({
  label,
  value,
  state,
}: {
  label: string;
  value: string | null;
  state?: 'ok' | 'bad';
}) {
  const tint = state === 'bad' ? colors.danger : state === 'ok' ? colors.green : colors.inkSoft;
  return (
    <View style={h.wrap}>
      <Text style={h.label}>{label}</Text>
      {value ? (
        <Text style={[h.value, { color: tint }]} selectable>
          {value.slice(0, 32)}
          {'\n'}
          {value.slice(32)}
        </Text>
      ) : (
        <Text style={h.none}>none</Text>
      )}
    </View>
  );
}

/** The verification checks. Each row appears in turn so the run feels like work. */
export function CheckList({ checks, stagger = 320 }: { checks: Check[]; stagger?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {checks.map((c, i) => {
        const tone = c.ok === null ? 'na' : c.ok ? 'ok' : 'bad';
        const tint =
          tone === 'ok' ? colors.green : tone === 'bad' ? colors.danger : colors.inkFaint;
        const bg =
          tone === 'ok' ? colors.greenSoft : tone === 'bad' ? colors.dangerSoft : colors.surfaceSunk;
        return (
          <FadeUp key={c.key} delay={i * stagger} distance={10} duration={380}>
            <View style={c2.row}>
              <View style={[c2.badge, { backgroundColor: bg }]}>
                <Icon
                  name={tone === 'bad' ? 'x' : tone === 'ok' ? 'check' : 'shield'}
                  size={15}
                  color={tint}
                  strokeWidth={2.2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={c2.label}>{c.label}</Text>
                <Text style={[c2.detail, tone === 'bad' && { color: colors.danger }]}>
                  {c.detail}
                </Text>
              </View>
            </View>
          </FadeUp>
        );
      })}
    </View>
  );
}

const h = StyleSheet.create({
  wrap: {
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunk,
    borderWidth: 1,
    borderColor: colors.line,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: colors.inkFaint,
    marginBottom: 6,
  },
  value: { fontFamily: 'Courier', fontSize: 12.5, lineHeight: 18 },
  none: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
});

const c2 = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint, marginTop: 1 },
});
