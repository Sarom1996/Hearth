import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const ACircle = Animated.createAnimatedComponent(Circle);

function Slice({
  size, stroke, color, fraction, offset, index,
}: { size: number; stroke: number; color: string; fraction: number; offset: number; index: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = fraction > 0.02 ? 0.006 : 0;
  const len = Math.max(fraction - gap, 0) * c;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(index * 90, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [fraction, offset, index, p]);
  const props = useAnimatedProps(() => ({ strokeDasharray: [len * p.value, c] }));
  return (
    <ACircle
      cx={size / 2}
      cy={size / 2}
      r={r}
      stroke={color}
      strokeWidth={stroke}
      fill="none"
      strokeLinecap="butt"
      strokeDashoffset={-offset * c}
      animatedProps={props}
    />
  );
}

/** Category breakdown donut — slices sweep in one after another. */
export function Donut({
  size = 180,
  stroke = 22,
  data,
  children,
}: {
  size?: number;
  stroke?: number;
  data: { value: number; color: string }[];
  children?: ReactNode;
}) {
  const total = data.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={(size - stroke) / 2} stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none" />
        {data.map((x, i) => {
          const f = x.value / total;
          const el = <Slice key={i} index={i} size={size} stroke={stroke} color={x.color} fraction={f} offset={acc} />;
          acc += f;
          return el;
        })}
      </Svg>
      {children}
    </View>
  );
}
