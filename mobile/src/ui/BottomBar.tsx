import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useLang } from '../lang';
import { colors, fonts } from '../theme';
import { Icon, IconName } from './Icon';
import { PressScale } from './motion';
import { STAR } from './Presence';

type Tab = { key: string; ms: string; en: string; icon?: IconName; href: string };

const TABS: Tab[] = [
  { key: 'home', ms: 'Utama', en: 'Home', icon: 'home', href: '/' },
  { key: 'ledger', ms: 'Rekod', en: 'Records', icon: 'ledger', href: '/ledger' },
  { key: 'assistant', ms: 'Pembantu', en: 'Assistant', href: '/assistant' },
  { key: 'live', ms: 'Tabung', en: 'Box', icon: 'camera', href: '/live' },
  { key: 'alerts', ms: 'Amaran', en: 'Alerts', icon: 'bell', href: '/alerts' },
];

/** Sits under the page, never over it, so it cannot hide a balance. */
export function BottomBar({ active, alertCount = 0 }: { active: string; alertCount?: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLang();

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const on = tab.key === active;
        const label = t(tab.ms, tab.en);
        const badge = tab.key === 'alerts' ? alertCount : 0;
        return (
          <View key={tab.key} style={{ flex: 1 }}>
            <PressScale
              style={s.item}
              onPress={() => (on ? undefined : router.push(tab.href as never))}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={badge > 0 ? `${label}, ${badge}` : label}
            >
              {tab.icon ? (
                <View style={s.icon}>
                  <Icon name={tab.icon} size={23} color={on ? colors.green : colors.inkFaint} />
                  {badge > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={s.orb}>
                  <Svg width={46} height={46} viewBox="50 50 100 100">
                    <Path d={STAR} fill={colors.green} />
                    <Path d="M83 120V97a17 17 0 0 1 34 0v23Z" fill={colors.paper} fillOpacity={0.82} />
                  </Svg>
                </View>
              )}
              <Text style={[s.label, (on || !tab.icon) && s.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </PressScale>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingHorizontal: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.lineStrong,
  },
  item: { minHeight: 60, alignItems: 'center', justifyContent: 'flex-end', gap: 4, paddingBottom: 4 },
  icon: { height: 28, justifyContent: 'center' },
  orb: {
    position: 'absolute',
    top: -22,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -11,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.paper },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.inkFaint },
  labelOn: { fontFamily: fonts.bodyBold, color: colors.green },
});
