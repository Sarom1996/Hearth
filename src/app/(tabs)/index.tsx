import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../../components/Backdrop';
import { Ring } from '../../components/Ring';
import { Glass, Press, T } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useBudget, useListItems, useSummary } from '../../lib/db';
import { useTodayAgenda } from '../../lib/google';
import { maybeAutoScan, useInbox } from '../../lib/inbox';
import { usePrefs } from '../../lib/prefs';
import { fmtRound, greeting, periodRange } from '../../lib/format';
import { dueInfo, quadrantOf, sortTasks, useTasks } from '../../lib/tasks';
import { categoryById, colors } from '../../lib/theme';

export default function Home() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const month = useMemo(() => periodRange('month', 0), []);
  const week = useMemo(() => periodRange('week', 0), []);
  const lastWeek = useMemo(() => periodRange('week', -1), []);
  const m = useSummary(month.start, month.end);
  const w = useSummary(week.start, week.end);
  const lw = useSummary(lastWeek.start, lastWeek.end);
  const budget = useBudget();
  const tasks = useTasks();
  const items = useListItems();
  const prefs = usePrefs();
  const agenda = useTodayAgenda(prefs.calendarAgenda);
  const inbox = useInbox();
  useEffect(() => {
    if (tasks) maybeAutoScan(tasks.map((t) => t.sourceEmailId).filter(Boolean));
  }, [tasks === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const left = budget - m.spent;
  const perDay = Math.max(left, 0) / daysLeft;
  const progress = budget > 0 ? m.spent / budget : 0;
  const over = left < 0;

  const focus = useMemo(
    () => sortTasks((tasks ?? []).filter((t) => !t.done && quadrantOf(t) === 'do'), 'smart').slice(0, 3),
    [tasks],
  );
  const openItems = (items ?? []).filter((i) => !i.done).length;
  const weekDelta = lw.spent > 0 ? (w.spent - lw.spent) / lw.spent : 0;
  const first = (user?.displayName ?? '').split(' ')[0];

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 120, gap: 16 }}
      >
        {/* Header */}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <T dim size={15}>
              {greeting()}
            </T>
            <T size={32} weight="800" style={{ letterSpacing: -0.8 }}>
              {first || 'Welcome'}
            </T>
          </View>
          <Press onPress={() => router.push('/settings')}>
            {user?.photoURL ? (
              <Image source={{ uri: user.photoURL }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.accent }]} />
            )}
          </Press>
        </View>

        {/* Budget ring */}
        <Animated.View entering={FadeInDown.duration(600)}>
          <Glass style={{ alignItems: 'center', paddingVertical: 26 }}>
            <Ring
              size={230}
              stroke={20}
              progress={progress}
              from={over ? colors.danger : colors.accent}
              to={over ? colors.warm : colors.accent2}
            >
              <T dim size={13} weight="600" style={{ letterSpacing: 1 }}>
                SPENT THIS MONTH
              </T>
              <T size={40} weight="800" style={{ letterSpacing: -1, marginTop: 2 }}>
                {fmtRound(m.spent)}
              </T>
              <T faint size={14}>of {fmtRound(budget)}</T>
            </Ring>
            <View style={[styles.row, { marginTop: 18, gap: 10 }]}>
              <Stat label={over ? 'Over budget' : 'Left'} value={fmtRound(Math.abs(left))} tone={over ? colors.danger : colors.good} />
              <Stat label="Per day" value={fmtRound(perDay)} />
              <Stat label="Days left" value={String(daysLeft)} />
            </View>
          </Glass>
        </Animated.View>

        {/* Quick actions */}
        <Animated.View entering={FadeInDown.delay(80).duration(600)} style={[styles.row, { gap: 10 }]}>
          <Quick emoji="➖" label="Expense" onPress={() => router.push({ pathname: '/add-expense', params: { type: 'expense' } })} />
          <Quick emoji="➕" label="Income" onPress={() => router.push({ pathname: '/add-expense', params: { type: 'income' } })} />
          <Quick emoji="🎙️" label="Talk" onPress={() => router.push({ pathname: '/ask-ai', params: { listen: '1' } })} />
          <Quick emoji="🛒" label={`List · ${openItems}`} onPress={() => router.push('/lists')} />
          <Quick emoji="🗂️" label="Docs" onPress={() => router.push('/docs')} />
        </Animated.View>

        {/* Focus */}
        <Animated.View entering={FadeInDown.delay(160).duration(600)}>
          <Press onPress={() => router.push('/focus')} haptic="none">
            <Glass>
              <View style={styles.row}>
                <T size={18} weight="700" style={{ flex: 1 }}>
                  🔥 Today’s focus
                </T>
                <T faint size={13}>Matrix ›</T>
              </View>
              {focus.length === 0 ? (
                <T dim style={{ marginTop: 10 }}>
                  Nothing urgent & important. Enjoy the calm.
                </T>
              ) : (
                focus.map((t) => {
                  const di = dueInfo(t);
                  return (
                    <View key={t.id} style={[styles.row, { marginTop: 12, gap: 10 }]}>
                      <View style={[styles.dot, { backgroundColor: colors.danger }]} />
                      <T style={{ flex: 1 }} numberOfLines={1}>
                        {t.title}
                      </T>
                      {di && (
                        <T size={13} style={{ color: di.tone === 'overdue' ? colors.danger : colors.textDim }}>
                          {di.label}
                        </T>
                      )}
                    </View>
                  );
                })
              )}
            </Glass>
          </Press>
        </Animated.View>

        {/* Inbox suggestions */}
        {inbox.drafts.length > 0 && (
          <Animated.View entering={FadeInDown.delay(200).duration(600)}>
            <Press onPress={() => router.push('/inbox')} haptic="light">
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <T size={26}>📬</T>
                <View style={{ flex: 1 }}>
                  <T size={16} weight="700">
                    {inbox.drafts.length} task{inbox.drafts.length === 1 ? '' : 's'} found in your email
                  </T>
                  <T dim size={13} numberOfLines={1}>
                    {inbox.drafts
                      .slice(0, 2)
                      .map((d) => d.title)
                      .join(' · ')}
                  </T>
                </View>
                <T faint>›</T>
              </Glass>
            </Press>
          </Animated.View>
        )}

        {/* Calendar agenda */}
        {agenda && agenda.length > 0 && (
          <Animated.View entering={FadeInDown.delay(220).duration(600)}>
            <Glass>
              <T size={18} weight="700">
                📅 Agenda
              </T>
              {agenda.slice(0, 6).map((e) => {
                const today = new Date().toDateString() === e.start.toDateString();
                return (
                  <View key={e.id} style={[styles.row, { marginTop: 10, gap: 10 }]}>
                    <View style={[styles.dot, { backgroundColor: today ? colors.accent2 : colors.textFaint }]} />
                    <T style={{ flex: 1 }} numberOfLines={1}>
                      {e.title}
                    </T>
                    <T size={13} dim>
                      {today ? '' : 'Tmrw '}
                      {e.allDay ? 'All day' : e.start.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}
                    </T>
                  </View>
                );
              })}
            </Glass>
          </Animated.View>
        )}

        {/* Week */}
        <Animated.View entering={FadeInDown.delay(240).duration(600)}>
          <Press onPress={() => router.push('/money')} haptic="none">
            <Glass>
              <View style={styles.row}>
                <T size={18} weight="700" style={{ flex: 1 }}>
                  This week
                </T>
                {lw.spent > 0 && (
                  <T size={13} weight="700" style={{ color: weekDelta > 0 ? colors.danger : colors.good }}>
                    {weekDelta > 0 ? '▲' : '▼'} {Math.abs(Math.round(weekDelta * 100))}% vs last week
                  </T>
                )}
              </View>
              <T size={30} weight="800" style={{ marginTop: 6 }}>
                {fmtRound(w.spent)}
              </T>
              <View style={[styles.row, { gap: 8, marginTop: 10, flexWrap: 'wrap' }]}>
                {w.categories.slice(0, 4).map((c) => {
                  const cat = categoryById(c.id);
                  return (
                    <View key={c.id} style={[styles.chip, { borderColor: cat.color + '55' }]}>
                      <T size={13}>
                        {cat.emoji} {fmtRound(c.cents)}
                      </T>
                    </View>
                  );
                })}
              </View>
            </Glass>
          </Press>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <T size={18} weight="700" style={tone ? { color: tone } : undefined}>
        {value}
      </T>
      <T faint size={12}>
        {label}
      </T>
    </View>
  );
}

function Quick({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.quick}>
      <T size={22}>{emoji}</T>
      <T size={12} dim weight="600" style={{ marginTop: 6 }} numberOfLines={1}>
        {label}
      </T>
    </Press>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)' },
  quick: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.04)' },
});
