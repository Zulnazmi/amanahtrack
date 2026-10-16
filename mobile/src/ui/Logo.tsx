import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors, fonts } from '../theme';

/**
 * The AmanahTrack mark: a mihrab arch carrying a ledger tick.
 * `progress` (0 to 1) draws the tick, used by the launch animation.
 */

export function LogoMark({
  size = 40,
  gradient = false,
  tickProgress = 1,
}: {
  size?: number;
  gradient?: boolean;
  tickProgress?: number;
}) {
  const dash = 20; // approximate length of the tick path
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {gradient && (
        <Defs>
          <LinearGradient id="lg" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#8CF7CD" />
            <Stop offset="1" stopColor="#17A878" />
          </LinearGradient>
        </Defs>
      )}
      <Path
        d="M6 43V22C6 11 14 4 24 4s18 7 18 18v21z"
        fill={gradient ? 'url(#lg)' : colors.green}
      />
      <Path
        d="M12 40V23c0-7 5-12 12-12s12 5 12 12v17"
        fill="none"
        stroke={colors.paper}
        strokeOpacity={0.3}
        strokeWidth={1.8}
      />
      <Path
        d="M15 26l6.5 6.5L33 19"
        fill="none"
        stroke={colors.paper}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        strokeDashoffset={dash * (1 - tickProgress)}
      />
    </Svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <View style={s.row}>
      <Text style={[s.bold, { fontSize: size }]}>Amanah</Text>
      <Text style={[s.light, { fontSize: size }]}>Track</Text>
      <Text style={[s.tm, { fontSize: Math.max(8, size * 0.32) }]}>TM</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  bold: { fontFamily: fonts.displayBold, color: colors.ink, letterSpacing: -0.8 },
  light: { fontFamily: fonts.displayLight, color: colors.green, letterSpacing: -0.8 },
  tm: { fontFamily: fonts.bodySemi, color: colors.inkFaint, marginLeft: 2, marginTop: 3 },
});
