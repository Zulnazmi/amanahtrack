import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

import { colors } from '../theme';

/**
 * Small motion kit built on React Native's own Animated API, so it adds no
 * dependency and runs the transforms on the native driver. Everything is short
 * (under a second) because slow animation feels like a slow app.
 */

const easeOut = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Fades and slides a child up into place. Stagger with `delay`. */
export function FadeUp({
  children,
  delay = 0,
  distance = 16,
  duration = 550,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  }, [v, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A Pressable that shrinks slightly while held. */
export function PressScale({
  children,
  style,
  scaleTo = 0.96,
  ...rest
}: PressableProps & { scaleTo?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.spring(v, { toValue: value, speed: 40, bounciness: 6, useNativeDriver: true }).start();
  return (
    <Pressable {...rest} onPressIn={() => to(scaleTo)} onPressOut={() => to(1)}>
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>
        {children as React.ReactNode}
      </Animated.View>
    </Pressable>
  );
}

/** Grows its child from the left edge, for the fund split bar. */
export function GrowX({
  children,
  delay = 0,
  duration = 900,
  width,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  }, [v, delay, duration]);

  // Scale around the left edge: shift by half of the lost width.
  return (
    <Animated.View
      style={[
        style,
        {
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0] }) },
            { scaleX: v },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Loading placeholder with a soft pulse. */
export function Skeleton({
  width,
  height,
  radius = 8,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.surfaceSunk,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        },
        style,
      ]}
    />
  );
}

/** Slow breathing glow for a dot or badge. */
export function Pulse({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View style={{ opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }}>
      {children}
    </Animated.View>
  );
}
