import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../../components/Backdrop';
import { Donut } from '../../components/Donut';
import { Insights } from '../../components/Insights';
import { Glass, Press, Segments, T } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { deleteTxn, summarize, useMembers, useTransactions, type Txn } from '../../lib/db';
import { dayHeading, fmt, fmtRound, periodLabel, periodRange, type Period } from '../../lib/format';
import { categoryById, colors } from '../../lib/theme';

type Who = 'all' | 'home' | string;

export default function Money() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const members = useMembers();
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);
  const [who, setWho] = useState<Who>('all');
  const { start, end } = useMemo(() => periodRange(period, offset), [period, offset]);
  const prev = useMemo(() => periodRange(period, offset - 1), [period, offset]);
  const all = useTransactions(start, end);
  const prevAll = useTransactions(prev.start, prev.end);

  const txns = useMemo(() => (all ?? []).filter((t) => who === 'all' || t.forWhom === who), [all, who]);
  const s = useMemo(() => summarize(txns), [txns]);
  const ps = useMemo(() => summarize((prevAll ?? []).filter((t) => who === 'all' || t.forWhom === who)), [prevAll, who]);
  const delta = ps.spent > 0 ? (s.spent - ps.spent) / ps.spent : null;

  const groups = useMemo(() => {
    const m = new Map<string, { date: Date; items: Txn[]; total: number }>();
    for (const t of txns) {
      const k = t.date.toDateString();
      const g = m.get(k) ?? { date: t.date, items: [], total: 0 };
      g.items.push(t);
      g.total += t.type === 'expense' ? t.amount : 0;
      m.set(k, g);
    }
    return [...m.values()];
  }, [txns]);

  const maxCat = s.categories[0]?.cents ?? 1;
  const nameFor = (forWhom: string) =>
    forWhom === 'home' ? 'Home' : forWhom === user?.uid ? 'Me' : members.find((m) => m.uid === forWhom)?.firstName ?? '';

  const onTxnPress = (t: Txn) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Delete'], destructiveButtonIndex: 1, cancelButtonIndex: 0, title: `${categoryById(t.category).label} · ${fmt(t.amount)}`, message: t.note || undefined },
      (i) => i === 1 && deleteTxn(t.id),
    );

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140, gap: 14 }}
      >
        <T size={32} weight="800" style={{ letterSpacing: -0.8 }}>
          Money
        </T>
        <Segments<Period>
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setOffset(0);
          }}
          options={[
            { key: 'day', label: 'Day' },
            { key: 'week', label: 'Week' },
            { key: 'month', label: 'Month' },
          ]}
        />

        {/* Period navigator */}
        <View style={styles.nav}>
          <Press onPress={() => setOffset((o) => o - 1)} style={styles.navBtn}>
            <T size={18}>‹</T>
          </Press>
          <T size={17} weight="700" style={{ flex: 1, textAlign: 'center' }}>
            {periodLabel(period, offset)}
          </T>
          <Press onPress={() => setOffset((o) => Math.min(o + 1, 0))} disabled={offset === 0} style={styles.navBtn}>
            <T size={18}>›</T>
          </Press>
        </View>

        {/* Who filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Segments<Who>
            value={who}
            onChange={setWho}
            options={[
              { key: 'all', label: 'Everything' },
              { key: 'home', label: '🏠 Home' },
              ...members.map((m) => ({ key: m.uid, label: m.uid === user?.uid ? 'Me' : m.firstName })),
            ]}
          />
        </ScrollView>

        {/* Wrap-up */}
        <Animated.View entering={FadeInDown.duration(500)} key={`${period}${offset}${who}`}>
          <Glass style={{ gap: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Donut size={150} stroke={18} data={s.categories.map((c) => ({ value: c.cents, color: categoryById(c.id).color }))}>
                <T faint size={11} weight="700">
                  SPENT
                </T>
                <T size={20} weight="800">
                  {fmtRound(s.spent)}
                </T>
              </Donut>
              <View style={{ flex: 1, gap: 10 }}>
                <Mini label="Income" value={fmtRound(s.earned)} color={colors.good} />
                <Mini label="Net" value={(s.net >= 0 ? '+' : '−') + fmtRound(Math.abs(s.net))} color={s.net >= 0 ? colors.good : colors.danger} />
                {delta !== null && (
                  <Mini
                    label={`vs previous`}
                    value={`${delta > 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta * 100))}%`}
                    color={delta > 0 ? colors.danger : colors.good}
                  />
                )}
              </View>
            </View>

            {s.categories.length > 0 && (
              <View style={{ gap: 10 }}>
                {s.categories.map((c) => {
                  const cat = categoryById(c.id);
                  const pct = s.spent ? Math.round((c.cents / s.spent) * 100) : 0;
                  return (
                    <View key={c.id} style={{ gap: 5 }}>
                      <View style={{ flexDirection: 'row' }}>
                        <T size={14} style={{ flex: 1 }}>
                          {cat.emoji} {cat.label}
                        </T>
                        <T size={14} weight="700">
                          {fmt(c.cents)}
                        </T>
                        <T size={12} faint style={{ width: 42, textAlign: 'right' }}>
                          {pct}%
                        </T>
                      </View>
                      <View style={styles.barBg}>
                        <Animated.View
                          entering={FadeIn.duration(600)}
                          style={[styles.bar, { width: `${(c.cents / maxCat) * 100}%`, backgroundColor: cat.color }]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {s.categories.length === 0 && all !== null && (
              <T dim style={{ textAlign: 'center' }}>
                No spending recorded {periodLabel(period, offset).toLowerCase()}.
              </T>
            )}
          </Glass>
        </Animated.View>

        {/* Charts: me / partner / home */}
        <Insights txns={all ?? []} period={period} offset={offset} members={members} me={user?.uid ?? ''} />

        {/* Transactions */}
        {groups.map((g) => (
          <Animated.View key={g.date.toDateString()} layout={LinearTransition} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', paddingHorizontal: 4, marginTop: 6 }}>
              <T dim size={13} weight="700" style={{ flex: 1 }}>
                {dayHeading(g.date)}
              </T>
              <T faint size={13}>
                {fmt(g.total)}
              </T>
            </View>
            <Glass style={{ padding: 6 }}>
              {g.items.map((t, i) => {
                const cat = categoryById(t.category);
                return (
                  <Press key={t.id} haptic="none" onPress={() => onTxnPress(t)} style={[styles.txn, i > 0 && styles.sep]}>
                    <View style={[styles.emoji, { backgroundColor: cat.color + '22' }]}>
                      <T size={18}>{cat.emoji}</T>
                    </View>
                    <View style={{ flex: 1 }}>
                      <T size={15} weight="600" numberOfLines={1}>
                        {t.note || cat.label}
                      </T>
                      <T faint size={12}>
                        {cat.label} · {nameFor(t.forWhom)} · by {t.createdByName.split(' ')[0]}
                      </T>
                    </View>
                    <T size={15} weight="700" style={{ color: t.type === 'income' ? colors.good : colors.text }}>
                      {t.type === 'income' ? '+' : '−'}
                      {fmt(t.amount)}
                    </T>
                  </Press>
                );
              })}
            </Glass>
          </Animated.View>
        ))}
      </ScrollView>

      <Press haptic="medium" onPress={() => router.push('/add-expense')} style={[styles.fab, { bottom: insets.bottom + 76 }]}>
        <T size={30} weight="300" style={{ color: '#0B0C14', marginTop: -2 }}>
          +
        </T>
      </Press>
    </View>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View>
      <T faint size={12}>
        {label}
      </T>
      <T size={18} weight="800" style={{ color }}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center' },
  navBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  barBg: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  emoji: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 22,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
});
