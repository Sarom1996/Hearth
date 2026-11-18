import { useEffect, useId, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { fmtRound } from '../lib/format';
import { colors } from '../lib/theme';
import { Press, T } from './ui';

const ARect = Animated.createAnimatedComponent(Rect);
const APath = Animated.createAnimatedComponent(Path);

export type Series = { key: string; label: string; color: string };

const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

function Legend({ series, totals }: { series: Series[]; totals?: Record<string, number> }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
      {series.map((s) => (
        <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
          <T size={12} dim>
            {s.label}
            {totals ? ` · ${fmtRound(totals[s.key] ?? 0)}` : ''}
          </T>
        </View>
      ))}
    </View>
  );
}

/* ───────── Stacked / grouped bar chart ───────── */

function Bar({ x, y, w, h, color, delay, r }: { x: number; y: number; w: number; h: number; color: string; delay: number; r: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(delay, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [h, y, delay, p]);
  const props = useAnimatedProps(() => ({ height: h * p.value, y: y + h * (1 - p.value) }));
  return <ARect x={x} width={w} rx={r} fill={color} animatedProps={props} />;
}

export function BarChart({
  labels,
  series,
  data, // data[i][seriesKey] = cents
  mode = 'stacked',
  height = 190,
  width,
  onSelect,
}: {
  labels: string[];
  series: Series[];
  data: Record<string, number>[];
  mode?: 'stacked' | 'grouped';
  height?: number;
  width: number;
  onSelect?: (i: number | null) => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const padL = 40;
  const padB = 22;
  const chartW = width - padL;
  const chartH = height - padB;
  const n = Math.max(labels.length, 1);
  const slot = chartW / n;
  const max = niceMax(
    Math.max(
      0,
      ...data.map((d) => (mode === 'stacked' ? series.reduce((s, x) => s + (d[x.key] ?? 0), 0) : Math.max(0, ...series.map((x) => d[x.key] ?? 0)))),
    ),
  );
  const yOf = (v: number) => chartH - (v / max) * chartH;
  const barW = Math.max(3, Math.min(28, slot * (mode === 'stacked' ? 0.62 : 0.8)));
  const every = n > 14 ? Math.ceil(n / 7) : 1;

  return (
    <View>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((f) => (
          <G key={f}>
            <Line x1={padL} x2={width} y1={yOf(max * f)} y2={yOf(max * f)} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 4" />
            <SvgText x={padL - 6} y={yOf(max * f) + 4} fill={colors.textFaint} fontSize={10} textAnchor="end">
              {fmtRound(max * f).replace('CA', '')}
            </SvgText>
          </G>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const dim = sel !== null && sel !== i;
          if (mode === 'stacked') {
            let acc = 0;
            return (
              <G key={i} opacity={dim ? 0.35 : 1}>
                {series.map((s) => {
                  const v = d[s.key] ?? 0;
                  if (v <= 0) return null;
                  const y = yOf(acc + v);
                  const h = yOf(acc) - y;
                  acc += v;
                  return <Bar key={s.key} x={cx - barW / 2} y={y} w={barW} h={Math.max(h - 1, 1)} color={s.color} delay={i * 25} r={3} />;
                })}
              </G>
            );
          }
          const gw = barW / series.length;
          return (
            <G key={i} opacity={dim ? 0.35 : 1}>
              {series.map((s, k) => {
                const v = d[s.key] ?? 0;
                const y = yOf(v);
                return <Bar key={s.key} x={cx - barW / 2 + k * gw + 1} y={y} w={gw - 2} h={chartH - y} color={s.color} delay={i * 40} r={3} />;
              })}
            </G>
          );
        })}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <SvgText key={i} x={padL + slot * i + slot / 2} y={height - 6} fill={sel === i ? colors.text : colors.textFaint} fontSize={10} textAnchor="middle">
              {l}
            </SvgText>
          ) : null,
        )}
      </Svg>
      {/* Tap targets */}
      <View style={{ position: 'absolute', left: padL, top: 0, height: chartH, flexDirection: 'row', width: chartW }}>
        {labels.map((_, i) => (
          <Press
            key={i}
            haptic="light"
            onPress={() => {
              const v = sel === i ? null : i;
              setSel(v);
              onSelect?.(v);
            }}
            style={{ width: slot, height: chartH }}
          >
            <View />
          </Press>
        ))}
      </View>
      {sel !== null && data[sel] && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          <T size={12} weight="700">
            {labels[sel]}:
          </T>
          {series.map((s) => (
            <T key={s.key} size={12} style={{ color: s.color }}>
              {s.label} {fmtRound(data[sel][s.key] ?? 0)}
            </T>
          ))}
        </View>
      )}
      <Legend series={series} />
    </View>
  );
}

/* ───────── Smooth line / area chart ───────── */

function smooth(points: [number, number][]) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

function AnimatedLine({ d, color, length, delay }: { d: string; color: string; length: number; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(delay, withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }));
  }, [d, delay, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - p.value) }));
  return <APath d={d} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${length} ${length}`} animatedProps={props} />;
}

export function LineChart({
  labels,
  series,
  data,
  height = 190,
  width,
}: {
  labels: string[];
  series: Series[];
  data: Record<string, number>[];
  height?: number;
  width: number;
}) {
  const gid = `lg${useId().replace(/:/g, '')}`;
  const padL = 40;
  const padB = 22;
  const padT = 8;
  const chartW = width - padL - 10;
  const chartH = height - padB - padT;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0))));
  const xOf = (i: number) => padL + (n <= 1 ? chartW / 2 : (chartW * i) / (n - 1));
  const yOf = (v: number) => padT + chartH - (v / max) * chartH;

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = data.map((d, i) => [xOf(i), yOf(d[s.key] ?? 0)] as [number, number]);
        return { s, d: smooth(pts), pts };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, series, width, max],
  );
  const first = paths[0];

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={first?.s.color ?? colors.accent} stopOpacity={0.35} />
            <Stop offset="1" stopColor={first?.s.color ?? colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0, 0.5, 1].map((f) => (
          <G key={f}>
            <Line x1={padL} x2={width} y1={yOf(max * f)} y2={yOf(max * f)} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 4" />
            <SvgText x={padL - 6} y={yOf(max * f) + 4} fill={colors.textFaint} fontSize={10} textAnchor="end">
              {fmtRound(max * f).replace('CA', '')}
            </SvgText>
          </G>
        ))}
        {first && first.pts.length > 1 && (
          <Path d={`${first.d} L${first.pts[first.pts.length - 1][0]},${padT + chartH} L${first.pts[0][0]},${padT + chartH} Z`} fill={`url(#${gid})`} />
        )}
        {paths.map((p, k) => (
          <G key={p.s.key}>
            <AnimatedLine d={p.d} color={p.s.color} length={chartW * 3} delay={k * 150} />
            {p.pts.map(([x, y], i) => (
              <Circle key={i} cx={x} cy={y} r={3.5} fill={colors.bg} stroke={p.s.color} strokeWidth={2} />
            ))}
          </G>
        ))}
        {labels.map((l, i) => (
          <SvgText key={i} x={xOf(i)} y={height - 6} fill={colors.textFaint} fontSize={10} textAnchor="middle">
            {l}
          </SvgText>
        ))}
      </Svg>
      <Legend series={series} />
    </View>
  );
}

/* ───────── Horizontal split bars (who spent / share) ───────── */

export function SplitBars({ rows, total }: { rows: { label: string; color: string; cents: number; sub?: string }[]; total: number }) {
  return (
    <View style={{ gap: 14 }}>
      {rows.map((r, i) => {
        const pct = total ? r.cents / total : 0;
        return (
          <View key={r.label} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <T size={15} weight="700" style={{ flex: 1 }}>
                {r.label}
              </T>
              <T size={15} weight="800">
                {fmtRound(r.cents)}
              </T>
              <T size={12} faint style={{ width: 44, textAlign: 'right' }}>
                {Math.round(pct * 100)}%
              </T>
            </View>
            <GrowBar pct={pct} color={r.color} delay={i * 120} />
            {!!r.sub && (
              <T size={12} faint>
                {r.sub}
              </T>
            )}
          </View>
        );
      })}
    </View>
  );
}

function GrowBar({ pct, color, delay }: { pct: number; color: string; delay: number }) {
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(delay, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }));
  }, [pct, delay, p]);
  const props = useAnimatedProps(() => ({ width: Math.max(w * pct * p.value, pct > 0 ? 6 : 0) }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 12 }}>
      <Svg width={w} height={12}>
        <Rect x={0} y={0} width={w} height={12} rx={6} fill="rgba(255,255,255,0.06)" />
        <ARect x={0} y={0} height={12} rx={6} fill={color} animatedProps={props} />
      </Svg>
    </View>
  );
}
