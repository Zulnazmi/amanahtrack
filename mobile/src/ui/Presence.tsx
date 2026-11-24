import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '../theme';

/**
 * The assistant's presence: an eight-pointed star, the pattern found in mosque
 * tilework, inside a ring of sound.
 *
 * The ring is moved by `level`, from 0 to 1. While listening that is the real
 * loudness of the microphone; while speaking it beats on each word. It never
 * moves to a voice that is not there.
 */

export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'trouble';

const TINT: Record<Mood, string> = {
  idle: colors.green,
  listening: colors.brass,
  thinking: '#7FD6FF',
  speaking: colors.green,
  trouble: colors.danger,
};

const BARS = 56;
export const STAR = star(46, 35.2);
const STAR_OUT = star(66, 50.5);

/** Two overlapping squares, drawn as one outline of sixteen corners. */
function star(outer: number, inner: number) {
  const points = Array.from({ length: 16 }, (_, i) => {
    const a = (Math.PI / 8) * i - Math.PI / 2;
    const d = i % 2 === 0 ? outer : inner;
    return `${(100 + d * Math.cos(a)).toFixed(2)} ${(100 + d * Math.sin(a)).toFixed(2)}`;
  });
  return `M${points.join('L')}Z`;
}

function useCalm() {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setCalm).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setCalm);
    return () => sub?.remove();
  }, []);
  return calm;
}

function useLoop(ms: number, on: boolean, swing = false) {
  const v = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (!on) {
      v.setValue(0);
      return;
    }
    const go = (toValue: number, easing: (n: number) => number) =>
      Animated.timing(v, { toValue, duration: ms, easing, useNativeDriver: true });
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(
      swing ? Animated.sequence([go(1, ease), go(0, ease)]) : go(1, Easing.linear),
    );
    loop.start();
    return () => loop.stop();
  }, [v, ms, on, swing]);
  return v;
}

export function Presence({ mood, level, size }: { mood: Mood; level: Animated.Value; size: number }) {
  const calm = useCalm();
  const tint = TINT[mood];
  const voiced = mood === 'listening' || mood === 'speaking';

  const slow = useLoop(48000, !calm);
  const breath = useLoop(2600, !calm, true);
  const spin = useLoop(1300, !calm && mood === 'thinking');
  const a = useLoop(190, !calm && voiced, true);
  const b = useLoop(270, !calm && voiced, true);
  const c = useLoop(350, !calm && voiced, true);

  const turn = (v: Animated.Value, to: string) => ({
    transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', to] }) }],
  });

  const radius = size * 0.39;
  const long = size * 0.11;
  const bars = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => {
        const swing = [a, b, c][(i * 7) % 3];
        const reach = 0.45 + 0.55 * Math.abs(Math.sin(i * 1.9));
        return {
          angle: `${(360 / BARS) * i}deg`,
          scale: Animated.add(
            0.16,
            Animated.multiply(
              level,
              swing.interpolate({ inputRange: [0, 1], outputRange: [reach, reach * 0.4] }),
            ),
          ),
        };
      }),
    [level, a, b, c],
  );

  const swell = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.02] }),
    Animated.multiply(level, calm ? 0 : 0.14),
  );
  const glow = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.7] }),
    Animated.multiply(level, 0.3),
  );

  return (
    <View
      style={{ width: size, height: size }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow, transform: [{ scale: swell }] }]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tint} stopOpacity={0.5} />
              <Stop offset="0.55" stopColor={tint} stopOpacity={0.13} />
              <Stop offset="1" stopColor={tint} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={100} cy={100} r={100} fill="url(#halo)" />
        </Svg>
      </Animated.View>

      {bars.map((bar) => (
        <Animated.View
          key={bar.angle}
          style={{
            position: 'absolute',
            left: size / 2 - 1.5,
            top: size / 2 - long / 2,
            width: 3,
            height: long,
            borderRadius: 2,
            backgroundColor: tint,
            opacity: voiced ? 0.95 : 0.4,
            transform: [{ rotate: bar.angle }, { translateY: -radius }, { scaleY: bar.scale }],
          }}
        />
      ))}

      <Animated.View style={[StyleSheet.absoluteFill, turn(slow, '360deg')]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Path d={STAR_OUT} fill="none" stroke={tint} strokeOpacity={0.35} strokeWidth={1.2} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, turn(slow, '-360deg')]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Path
            d={STAR_OUT}
            fill="none"
            stroke={tint}
            strokeOpacity={0.2}
            strokeWidth={1}
            transform="rotate(22.5 100 100)"
          />
        </Svg>
      </Animated.View>

      {mood === 'thinking' && (
        <Animated.View style={[StyleSheet.absoluteFill, turn(spin, '360deg')]}>
          <Svg width={size} height={size} viewBox="0 0 200 200">
            <Circle
              cx={100}
              cy={100}
              r={70}
              fill="none"
              stroke={tint}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="110 330"
            />
          </Svg>
        </Animated.View>
      )}

      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: swell }] }]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="core" cx="50%" cy="42%" r="60%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
              <Stop offset="0.35" stopColor={tint} stopOpacity={1} />
              <Stop offset="1" stopColor={tint} stopOpacity={0.35} />
            </RadialGradient>
          </Defs>
          <Path d={STAR} fill="url(#core)" stroke={tint} strokeWidth={1.5} strokeLinejoin="round" />
          {/* the arch from the AmanahTrack mark */}
          <Path d="M83 120V97a17 17 0 0 1 34 0v23Z" fill={colors.paper} fillOpacity={0.82} />
        </Svg>
      </Animated.View>
    </View>
  );
}
