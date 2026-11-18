import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Press, T } from '../components/ui';
import { MicButton, useDictation } from '../components/Voice';
import { aiEnabled, interpret, type Interpretation } from '../lib/ai';
import { useAuth } from '../lib/auth';
import { addItem, addTxn } from '../lib/db';
import { fmt } from '../lib/format';
import { addTask, QUADRANTS, quadrantById, quadrantOf } from '../lib/tasks';
import { categoryById, colors } from '../lib/theme';

const EXAMPLES = [
  'Spent 42 dollars at Costco on groceries, add milk and eggs to the list, remind me to call the dentist tomorrow at 10',
  'Pay hydro bill by Friday, renew passport before March 3, plan anniversary dinner Dec 12',
];

export default function AskHearth() {
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const { user } = useAuth();
  const voice = useDictation('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Interpretation | null>(null);
  const [shared, setShared] = useState(true);

  useEffect(() => {
    if (listen === '1') voice.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When you stop talking, sort it automatically.
  const [wasListening, setWasListening] = useState(false);
  useEffect(() => {
    if (wasListening && !voice.listening && voice.text.trim()) think();
    setWasListening(voice.listening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.listening]);

  const think = async () => {
    const text = voice.text.trim();
    if (!text) return;
    if (voice.listening) voice.stop();
    setBusy(true);
    setRes(await interpret(text));
    setBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const cycleQuadrant = (i: number) => {
    Haptics.selectionAsync();
    setRes((r) => {
      if (!r) return r;
      const cur = QUADRANTS.findIndex((q) => q.id === quadrantOf(r.tasks[i]));
      const next = QUADRANTS[(cur + 1) % 4];
      return { ...r, tasks: r.tasks.map((d, k) => (k === i ? { ...d, urgent: next.urgent, important: next.important } : d)) };
    });
  };

  const total = res ? res.tasks.length + res.money.length + res.items.length : 0;

  const saveAll = async () => {
    if (!res || !user) return;
    const me = user.uid;
    await Promise.all([
      ...res.tasks.map((d) =>
        addTask({
          title: d.title,
          notes: d.notes,
          urgent: d.urgent,
          important: d.important,
          due: d.due,
          dueHasTime: d.dueHasTime,
          remindAt: d.remindAt,
          owner: shared ? 'home' : me,
          delegatedTo: d.delegatedTo,
          effort: d.effort,
          createdBy: me,
        }),
      ),
      ...res.money.map((m) =>
        addTxn({
          type: m.type,
          amount: m.cents,
          category: m.category,
          note: m.note,
          date: new Date(),
          forWhom: m.forHome ? 'home' : me,
          createdBy: me,
          createdByName: user.displayName ?? '',
        }),
      ),
      ...res.items.map((i) => addItem(i.list === 'mine' ? me : 'home', i.text, me)),
    ]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg2 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 26, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View>
          <T size={28} weight="800" style={{ letterSpacing: -0.6 }}>
            ✨ Ask Hearth
          </T>
          <T dim size={14} style={{ marginTop: 4 }}>
            Say or type anything — expenses, shopping, tasks, reminders. {aiEnabled() ? 'Claude' : 'Hearth'} sorts it all out.
          </T>
        </View>

        <View style={{ alignItems: 'center' }}>
          <MicButton listening={voice.listening} level={voice.level} onPress={voice.listening ? voice.stop : voice.start} />
          <T faint size={12} style={{ marginTop: -8 }}>
            {voice.listening ? 'Listening… tap to finish' : 'Tap to talk'}
          </T>
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            value={voice.text}
            onChangeText={voice.setText}
            multiline
            placeholder="…or type here"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
        </View>
        {voice.error && (
          <T size={13} style={{ color: colors.danger }}>
            {voice.error}
          </T>
        )}

        {!res && !voice.text && (
          <View style={{ gap: 8 }}>
            {EXAMPLES.map((e) => (
              <Press key={e} onPress={() => voice.setText(e)} style={styles.example}>
                <T size={13} dim>
                  “{e}”
                </T>
              </Press>
            ))}
          </View>
        )}

        <Press haptic="medium" onPress={think} disabled={busy || !voice.text.trim()} style={styles.primary}>
          {busy ? (
            <ActivityIndicator color="#0B0C14" />
          ) : (
            <T size={16} weight="800" style={{ color: '#0B0C14' }}>
              {res ? 'Re-think' : 'Sort it for me'}
            </T>
          )}
        </Press>

        {res && (
          <Animated.View layout={LinearTransition} style={{ gap: 10 }}>
            <T faint size={12} weight="800" style={{ letterSpacing: 1.5 }}>
              {total} ENTR{total === 1 ? 'Y' : 'IES'} · {res.usedAI ? 'BY CLAUDE' : 'ON-DEVICE'}
            </T>

            {res.money.map((m, i) => {
              const cat = categoryById(m.category);
              return (
                <Animated.View key={`m${i}`} entering={FadeInDown.delay(i * 60)} exiting={FadeOut} layout={LinearTransition} style={[styles.card, { borderColor: cat.color + '66' }]}>
                  <View style={styles.cardRow}>
                    <T size={24}>{cat.emoji}</T>
                    <View style={{ flex: 1 }}>
                      <T size={16} weight="700">
                        {m.type === 'income' ? '+' : '−'}
                        {fmt(m.cents)} · {cat.label}
                      </T>
                      <T size={12} dim>
                        {m.note || (m.type === 'income' ? 'Income' : 'Expense')} · {m.forHome ? '🏠 Home' : '🙋 Me'}
                      </T>
                    </View>
                    <Remove onPress={() => setRes({ ...res, money: res.money.filter((_, k) => k !== i) })} />
                  </View>
                </Animated.View>
              );
            })}

            {res.items.length > 0 && (
              <Animated.View entering={FadeInDown} layout={LinearTransition} style={[styles.card, { borderColor: colors.good + '55' }]}>
                <T size={13} weight="800" style={{ color: colors.good, letterSpacing: 1 }}>
                  🛒 SHOPPING LIST
                </T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {res.items.map((it, i) => (
                    <Press key={`i${i}`} onPress={() => setRes({ ...res, items: res.items.filter((_, k) => k !== i) })} style={styles.itemChip}>
                      <T size={14}>{it.text}</T>
                      <T size={12} faint>
                        {' '}
                        ×
                      </T>
                    </Press>
                  ))}
                </View>
              </Animated.View>
            )}

            {res.tasks.map((d, i) => {
              const q = quadrantById(quadrantOf(d));
              return (
                <Animated.View key={`t${i}`} entering={FadeInDown.delay(i * 60)} exiting={FadeOut} layout={LinearTransition} style={[styles.card, { borderColor: q.color + '66' }]}>
                  <View style={[styles.cardRow, { alignItems: 'flex-start' }]}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <T size={16} weight="700">
                        {d.title}
                      </T>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        {d.due && (
                          <T size={12} dim>
                            📅{' '}
                            {d.due.toLocaleString(
                              'en-CA',
                              d.dueHasTime ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric' },
                            )}
                          </T>
                        )}
                        {d.remindAt && d.remindAt.getTime() > Date.now() && (
                          <T size={12} dim>
                            🔔 {d.remindAt.toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                          </T>
                        )}
                        {!!d.delegatedTo && <T size={12} dim>→ {d.delegatedTo}</T>}
                      </View>
                      {!!d.why && (
                        <T size={12} faint>
                          {d.why}
                        </T>
                      )}
                    </View>
                    <Remove onPress={() => setRes({ ...res, tasks: res.tasks.filter((_, k) => k !== i) })} />
                  </View>
                  <Press onPress={() => cycleQuadrant(i)} style={[styles.qChip, { backgroundColor: q.glow }]}>
                    <T size={12} weight="800" style={{ color: q.color }}>
                      {q.title} · {q.hint} ⇄
                    </T>
                  </Press>
                </Animated.View>
              );
            })}

            {res.tasks.length > 0 && (
              <Press onPress={() => setShared((s) => !s)} style={styles.toggle}>
                <T size={14}>{shared ? '🏠 Tasks shared with both of us' : '🙋 Tasks just for me'}</T>
                <T faint size={12}>tap to change</T>
              </Press>
            )}

            {total > 0 ? (
              <Press haptic="medium" onPress={saveAll} style={[styles.primary, { backgroundColor: colors.accent }]}>
                <T size={16} weight="800">
                  Save {total} entr{total === 1 ? 'y' : 'ies'}
                </T>
              </Press>
            ) : (
              <T dim style={{ textAlign: 'center' }}>
                Nothing recognised — try rephrasing.
              </T>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Remove({ onPress }: { onPress: () => void }) {
  return (
    <Press onPress={onPress} style={{ padding: 4 }}>
      <T faint size={18}>
        ×
      </T>
    </Press>
  );
}

const styles = StyleSheet.create({
  inputWrap: { padding: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)' },
  input: { color: colors.text, fontSize: 17, minHeight: 80, textAlignVertical: 'top' },
  example: { padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)' },
  primary: { height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  card: { padding: 14, borderRadius: 20, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.04)', gap: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemChip: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(91,228,155,0.12)' },
  qChip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)' },
});
