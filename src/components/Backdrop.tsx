import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../lib/theme';

/** Slowly drifting colour orbs behind every screen — the app's "living" background. */
function Orb({ color, size, x, y, dx, dy, duration }: {
  color: string; size: number; x: number; y: number; dx: number; dy: number; duration: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [duration, t]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x + dx * t.value },
      { translateY: y + dy * t.value },
      { scale: 1 + 0.15 * t.value },
    ],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.35 },
        style,
      ]}
    />
  );
}

export function Backdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[colors.bg2, colors.bg]} style={StyleSheet.absoluteFill} />
      <Orb color={colors.accent} size={width * 0.9} x={-width * 0.35} y={-height * 0.12} dx={60} dy={40} duration={9000} />
      <Orb color={colors.accent2} size={width * 0.7} x={width * 0.5} y={height * 0.25} dx={-50} dy={70} duration={11000} />
      <Orb color={colors.warm} size={width * 0.55} x={-width * 0.1} y={height * 0.7} dx={70} dy={-50} duration={13000} />
      {/* Soft veil keeps the orbs dreamy and the text readable */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,8,15,0.55)' }]} />
    </View>
  );
}
