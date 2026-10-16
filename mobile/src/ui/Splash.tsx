import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { brand, colors, fonts } from '../theme';
import { LogoMark, Wordmark } from './Logo';

/**
 * Launch animation. The logo pops in, the tick draws itself, the wordmark
 * and tagline fade up, then the whole overlay fades out and reveals the app.
 * Total time is about 2.4 seconds, which is long enough to read as a brand
 * moment and short enough that nobody waits for it.
 */

export function Splash({ onDone }: { onDone: () => void }) {
  const pop = useRef(new Animated.Value(0)).current;
  const tick = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;
  const [tickProgress, setTickProgress] = useState(0);

  useEffect(() => {
    const id = tick.addListener(({ value }) => setTickProgress(value));
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, speed: 8, bounciness: 12, useNativeDriver: true }),
      Animated.timing(tick, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(text, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(out, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start(() => onDone());
    return () => tick.removeListener(id);
  }, [pop, tick, text, out, onDone]);

  return (
    <Animated.View style={[s.root, { opacity: out }]} pointerEvents="auto">
      <View style={s.glow} />
      <View style={s.center}>
        <Animated.View
          style={{
            opacity: pop,
            transform: [
              { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
            ],
          }}
        >
          <LogoMark size={112} gradient tickProgress={tickProgress} />
        </Animated.View>

        <Animated.View
          style={{
            marginTop: 28,
            alignItems: 'center',
            opacity: text,
            transform: [
              { translateY: text.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            ],
          }}
        >
          <Wordmark size={34} />
          <Text style={s.tagline}>{brand.tagline}</Text>
        </Animated.View>
      </View>

      <Animated.View style={[s.footer, { opacity: text }]}>
        <Text style={s.legal}>{brand.copyright}</Text>
        <Text style={s.legal}>{brand.trademark}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  glow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(79,227,168,0.08)',
  },
  center: { alignItems: 'center' },
  tagline: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 2.4,
    color: colors.inkFaint,
    marginTop: 10,
  },
  footer: { position: 'absolute', bottom: 44, alignItems: 'center', gap: 4, paddingHorizontal: 32 },
  legal: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.inkFaint,
    textAlign: 'center',
  },
});
