import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, radius } from '../lib/theme';

/** Frosted-glass card. */
export function Glass({ children, style, intensity = 30 }: { children: ReactNode; style?: StyleProp<ViewStyle>; intensity?: number }) {
  return (
    <View style={[styles.glass, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}

/** Pressable that squishes on touch with a light haptic tap. */
export function Press({
  children,
  onPress,
  onLongPress,
  style,
  haptic = 'light',
  disabled,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  haptic?: 'light' | 'medium' | 'none';
  disabled?: boolean;
}) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        s.value = withSpring(0.94, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        s.value = withSpring(1, { damping: 12, stiffness: 300 });
      }}
      onPress={() => {
        if (haptic !== 'none') {
          Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        }
        onPress?.();
      }}
      onLongPress={onLongPress}
    >
      <Animated.View style={[style, anim, disabled && { opacity: 0.4 }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function T({
  children,
  style,
  dim,
  faint,
  size = 16,
  weight = '500',
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  dim?: boolean;
  faint?: boolean;
  size?: number;
  weight?: TextStyle['fontWeight'];
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: faint ? colors.textFaint : dim ? colors.textDim : colors.text, fontSize: size, fontWeight: weight, fontVariant: ['tabular-nums'] },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Pill-style segmented control. */
export function Segments<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: { key: K; label: string }[];
  onChange: (k: K) => void;
}) {
  return (
    <View style={styles.segWrap}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Press key={o.key} onPress={() => onChange(o.key)} style={[styles.seg, active && styles.segActive]}>
            <T size={14} weight={active ? '700' : '500'} dim={!active}>
              {o.label}
            </T>
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    padding: 18,
  },
  segWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  seg: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  segActive: { backgroundColor: 'rgba(255,255,255,0.14)' },
});
