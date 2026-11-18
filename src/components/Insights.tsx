import { useMemo, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Member, Txn } from '../lib/db';
import { useTransactions } from '../lib/db';
import { fmtRound, periodRange, type Period } from '../lib/format';
import { categoryById, colors } from '../lib/theme';
import { BarChart, LineChart, SplitBars, type Series } from './Charts';
import { Donut } from './Donut';
import { Glass, Segments, T } from './ui';

type ChartKind = 'who' | 'daily' | 'category' | 'trend' | 'inout';

const KINDS: { key: ChartKind; label: string }[] = [
  { key: 'who', label: '👥 Who' },
  { key: 'daily', label: '📊 Day by day' },
  { key: 'category', label: '🏷️ Categories' },
  { key: 'trend', label: '📈 6 months' },
  { key: 'inout', label: '⚖️ In vs out' },
];

const PARTNER_COLOR = '#FF7AD9';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Me / partner / home" split of the household's spending, in five chart styles. */
export function Insights({
  txns,
  period,
  offset,
  members,
  me,
}: {
  txns: Txn[];
  period: Period;
  offset: number;
  members: Member[];
  me: string;
}) {
  const { width } = useWindowDimensions();
  const chartW = width - 40 - 36; // screen padding + card padding
  const [kind, setKind] = useState<ChartKind>('who');

  const whoSeries: Series[] = useMemo(() => {
    const partner = members.find((m) => m.uid !== me);
    return [
      { key: 'home', label: '🏠 Home', color: colors.accent },
      { key: me, label: '🙋 Me', color: colors.accent2 },
      ...(partner ? [{ key: partner.uid, label: `💛 ${partner.firstName}`, color: PARTNER_COLOR }] : []),
    ];
  }, [members, me]);
  const whoKey = (t: Txn) => (whoSeries.some((s) => s.key === t.forWhom) ? t.forWhom : 'home');

  const expenses = useMemo(() => txns.filter((t) => t.type === 'expense'), [txns]);
  const spent = expenses.reduce((s, t) => s + t.amount, 0);

  // 6-month window (always ending with the month being viewed)
  const sixStart = useMemo(() => {
    const ref = periodRange('month', period === 'month' ? offset : 0).start;
    return new Date(ref.getFullYear(), ref.getMonth() - 5, 1);
  }, [period, offset]);
  const sixEnd = useMemo(() => {
    const ref = periodRange('month', period === 'month' ? offset : 0).start;
    return new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  }, [period, offset]);
  const six = useTransactions(sixStart, sixEnd);

  /* WHO */
  const whoTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of expenses) m[whoKey(t)] = (m[whoKey(t)] ?? 0) + t.amount;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, whoSeries]);

  /* DAILY */
  const daily = useMemo(() => {
    const { start, end } = periodRange(period === 'day' ? 'week' : period, offset);
    const days = Math.round((end.getTime() - start.getTime()) / 86400000);
    const labels: string[] = [];
    const data: Record<string, number>[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      labels.push(days <= 7 ? d.toLocaleDateString('en-CA', { weekday: 'narrow' }) : String(d.getDate()));
      data.push({});
    }
    const src = period === 'day' ? (six ?? []).filter((t) => t.date >= start && t.date < end) : expenses;
    for (const t of src) {
      if (t.type !== 'expense') continue;
      const i = Math.floor((t.date.getTime() - start.getTime()) / 86400000);
      if (i >= 0 && i < days) data[i][whoKey(t)] = (data[i][whoKey(t)] ?? 0) + t.amount;
    }
    return { labels, data };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, six, period, offset, whoSeries]);

  /* CATEGORY × WHO */
  const byCat = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const t of expenses) {
      const row = m.get(t.category) ?? {};
      row[whoKey(t)] = (row[whoKey(t)] ?? 0) + t.amount;
      m.set(t.category, row);
    }
    const rows = [...m.entries()]
      .map(([id, row]) => ({ id, row, total: Object.values(row).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 7);
    return { labels: rows.map((r) => categoryById(r.id).emoji), data: rows.map((r) => r.row), rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, whoSeries]);

  /* 6-MONTH TREND + IN/OUT */
  const months = useMemo(() => {
    const labels: string[] = [];
    const who: Record<string, number>[] = [];
    const inout: Record<string, number>[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(sixStart.getFullYear(), sixStart.getMonth() + i, 1);
      labels.push(MONTHS[d.getMonth()]);
      who.push({});
      inout.push({ in: 0, out: 0 });
    }
    for (const t of six ?? []) {
      const i = (t.date.getFullYear() - sixStart.getFullYear()) * 12 + t.date.getMonth() - sixStart.getMonth();
      if (i < 0 || i > 5) continue;
      if (t.type === 'expense') {
        who[i][whoKey(t)] = (who[i][whoKey(t)] ?? 0) + t.amount;
        inout[i].out += t.amount;
      } else inout[i].in += t.amount;
    }
    return { labels, who, inout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [six, sixStart, whoSeries]);

  const savingsRate = (() => {
    const tin = months.inout.reduce((s, m) => s + m.in, 0);
    const tout = months.inout.reduce((s, m) => s + m.out, 0);
    return tin > 0 ? Math.round(((tin - tout) / tin) * 100) : null;
  })();

  return (
    <Glass style={{ gap: 14 }}>
      <T size={18} weight="800">
        Insights
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Segments value={kind} onChange={setKind} options={KINDS} />
      </ScrollView>

      <Animated.View key={kind} entering={FadeIn.duration(300)}>
        {kind === 'who' && (
          <View style={{ gap: 18 }}>
            <View style={{ alignItems: 'center' }}>
              <Donut size={170} stroke={22} data={whoSeries.map((s) => ({ value: whoTotals[s.key] ?? 0, color: s.color }))}>
                <T faint size={11} weight="700">
                  TOTAL
                </T>
                <T size={20} weight="800">
                  {fmtRound(spent)}
                </T>
              </Donut>
            </View>
            <SplitBars
              total={spent}
              rows={whoSeries.map((s) => {
                const mine = expenses.filter((t) => whoKey(t) === s.key);
                const top = new Map<string, number>();
                mine.forEach((t) => top.set(t.category, (top.get(t.category) ?? 0) + t.amount));
                const best = [...top.entries()].sort((a, b) => b[1] - a[1])[0];
                return {
                  label: s.label,
                  color: s.color,
                  cents: whoTotals[s.key] ?? 0,
                  sub: best ? `Mostly ${categoryById(best[0]).label.toLowerCase()} · ${mine.length} entries` : 'No spending',
                };
              })}
            />
          </View>
        )}

        {kind === 'daily' && (
          <BarChart width={chartW} labels={daily.labels} data={daily.data} series={whoSeries} mode="stacked" />
        )}

        {kind === 'category' &&
          (byCat.rows.length ? (
            <View style={{ gap: 10 }}>
              <BarChart width={chartW} labels={byCat.labels} data={byCat.data} series={whoSeries} mode="stacked" />
              <T faint size={12}>
                Top categories, split by who the money was for. Tap a bar for details.
              </T>
            </View>
          ) : (
            <T dim>No spending yet in this period.</T>
          ))}

        {kind === 'trend' && (
          <View style={{ gap: 10 }}>
            <LineChart width={chartW} labels={months.labels} data={months.who} series={whoSeries} />
            <T faint size={12}>
              Monthly spending for each of you and the home, last 6 months.
            </T>
          </View>
        )}

        {kind === 'inout' && (
          <View style={{ gap: 10 }}>
            <BarChart
              width={chartW}
              labels={months.labels}
              data={months.inout}
              mode="grouped"
              series={[
                { key: 'in', label: 'Income', color: colors.good },
                { key: 'out', label: 'Spending', color: colors.danger },
              ]}
            />
            {savingsRate !== null && (
              <T size={14} weight="700" style={{ color: savingsRate >= 0 ? colors.good : colors.danger }}>
                Savings rate (6 mo): {savingsRate}%
              </T>
            )}
          </View>
        )}
      </Animated.View>
    </Glass>
  );
}
