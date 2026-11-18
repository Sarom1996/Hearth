import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Backdrop } from '../components/Backdrop';
import { Press, T } from '../components/ui';
import { dueInfo, moveTask, QUADRANTS, quadrantById, quadrantOf, snoozeTask, updateTask, useTasks, type Task } from '../lib/tasks';
import { colors } from '../lib/theme';

type Verdict = 'done' | 'snooze' | 'now' | 'skip';

/**
 * Review mode — your open tasks one card at a time.
 *  → right: done   ← left: snooze to tomorrow 9 am   ↑ up: move to "Do now"
 */
export default function Review() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tasks = useTasks();
  // Freeze the queue when the screen opens so cards don't reshuffle as you act.
  const queueRef = useRef<Task[] | null>(null);
  if (!queueRef.current && tasks) {
    const order = QUADRANTS.map((q) => q.id);
    queueRef.current = tasks
      .filter((t) => !t.done)
      .sort((a, b) => {
        const qa = order.indexOf(quadrantOf(a));
        const qb = order.indexOf(quadrantOf(b));
        if (qa !== qb) return qa - qb;
        return (a.due?.getTime() ?? 8.64e15) - (b.due?.getTime() ?? 8.64e15);
      });
  }
  const queue = queueRef.current ?? [];
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState({ done: 0, snooze: 0, now: 0 });
  const card = queue[index];
  const next = queue[index + 1];

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const decide = (v: Verdict) => {
    if (!card) return;
    if (v === 'done') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updateTask(card.id, { done: true });
    } else if (v === 'snooze') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      snoozeTask(card, 'tomorrow');
    } else if (v === 'now') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      moveTask(card.id, 'do');
    } else Haptics.selectionAsync();
    if (v !== 'skip') setTally((t) => ({ ...t, [v]: t[v] + 1 }));
    setIndex((i) => i + 1);
    tx.value = 0;
    ty.value = 0;
  };

  const fling = (v: Verdict) => {
    const dx = v === 'done' ? width * 1.4 : v === 'snooze' ? -width * 1.4 : 0;
    const dy = v === 'now' ? -900 : v === 'skip' ? 900 : 0;
    tx.value = withTiming(dx, { duration: 220 });
    ty.value = withTiming(dy, { duration: 220 }, () => scheduleOnRN(decide, v));
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const th = width * 0.28;
      let v: Verdict | null = null;
      if (e.translationX > th || e.velocityX > 900) v = 'done';
      else if (e.translationX < -th || e.velocityX < -900) v = 'snooze';
      else if (e.translationY < -140 || e.velocityY < -900) v = 'now';
      if (v) {
        const dx = v === 'done' ? width * 1.4 : v === 'snooze' ? -width * 1.4 : tx.value;
        const dy = v === 'now' ? -900 : ty.value;
        tx.value = withTiming(dx, { duration: 200 });
        const verdict = v;
        ty.value = withTiming(dy, { duration: 200 }, () => scheduleOnRN(decide, verdict));
      } else {
        tx.value = withSpring(0, { damping: 14 });
        ty.value = withSpring(0, { damping: 14 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, width], [-14, 14])}deg` },
    ],
  }));
  const backStyle = useAnimatedStyle(() => {
    const p = Math.min(1, (Math.abs(tx.value) + Math.abs(ty.value)) / 220);
    return { transform: [{ scale: 0.92 + p * 0.08 }], opacity: 0.5 + p * 0.5 };
  });
  const doneStamp = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [20, 120], [0, 1], 'clamp') }));
  const snoozeStamp = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [-120, -20], [1, 0], 'clamp') }));
  const nowStamp = useAnimatedStyle(() => ({ opacity: interpolate(ty.value, [-140, -30], [1, 0], 'clamp') }));

  const finished = tasks !== null && index >= queue.length;
  const progress = queue.length ? index / queue.length : 1;

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 }}>
      <Backdrop />
      <View style={styles.top}>
        <Press onPress={() => router.back()} style={styles.close}>
          <T size={16}>✕</T>
        </Press>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
        <T dim size={13} weight="700">
          {Math.min(index + 1, queue.length)}/{queue.length}
        </T>
      </View>

      {finished ? (
        <Animated.View entering={ZoomIn.springify()} style={styles.center}>
          <T size={72}>🎉</T>
          <T size={28} weight="800" style={{ marginTop: 12 }}>
            All reviewed
          </T>
          <T dim style={{ marginTop: 8, textAlign: 'center' }}>
            {tally.done} done · {tally.now} moved to Do now · {tally.snooze} snoozed
          </T>
          <Press onPress={() => router.back()} style={[styles.btn, { marginTop: 30, paddingHorizontal: 40 }]}>
            <T weight="800" style={{ color: '#0B0C14' }}>
              Back to matrix
            </T>
          </Press>
        </Animated.View>
      ) : (
        <>
          <View style={styles.deck}>
            {next && (
              <Animated.View style={[styles.card, backStyle]}>
                <CardFace task={next} />
              </Animated.View>
            )}
            {card && (
              <GestureDetector gesture={pan}>
                <Animated.View key={card.id} entering={FadeIn.duration(180)} style={[styles.card, cardStyle]}>
                  <CardFace task={card} />
                  <Animated.View style={[styles.stamp, { left: 20, borderColor: colors.good, transform: [{ rotate: '-12deg' }] }, doneStamp]}>
                    <T size={22} weight="900" style={{ color: colors.good }}>
                      DONE
                    </T>
                  </Animated.View>
                  <Animated.View style={[styles.stamp, { right: 20, borderColor: colors.warm, transform: [{ rotate: '12deg' }] }, snoozeStamp]}>
                    <T size={22} weight="900" style={{ color: colors.warm }}>
                      TOMORROW
                    </T>
                  </Animated.View>
                  <Animated.View style={[styles.stamp, { alignSelf: 'center', bottom: 30, top: undefined, borderColor: colors.danger }, nowStamp]}>
                    <T size={22} weight="900" style={{ color: colors.danger }}>
                      DO NOW
                    </T>
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            )}
          </View>

          <View style={styles.actions}>
            <Action label="Snooze" emoji="💤" color={colors.warm} onPress={() => fling('snooze')} />
            <Action label="Skip" emoji="↓" color={colors.textDim} onPress={() => fling('skip')} small />
            <Action label="Do now" emoji="🔥" color={colors.danger} onPress={() => fling('now')} small />
            <Action label="Done" emoji="✓" color={colors.good} onPress={() => fling('done')} />
          </View>
          <T faint size={12} style={{ textAlign: 'center', marginTop: 10 }}>
            Swipe → done · ← tomorrow · ↑ do now
          </T>
        </>
      )}
    </View>
  );
}

function CardFace({ task }: { task: Task }) {
  const q = quadrantById(quadrantOf(task));
  const di = dueInfo(task);
  return (
    <>
      <LinearGradient colors={[q.glow, 'rgba(20,21,38,0.96)']} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, padding: 26, justifyContent: 'space-between' }}>
        <View style={{ gap: 6 }}>
          <View style={[styles.qBadge, { backgroundColor: q.color + '2A' }]}>
            <T size={12} weight="800" style={{ color: q.color, letterSpacing: 1 }}>
              {q.title.toUpperCase()}
            </T>
          </View>
          <T size={30} weight="800" style={{ letterSpacing: -0.6, marginTop: 10 }}>
            {task.title}
          </T>
          {!!task.notes && (
            <T dim size={15} numberOfLines={6}>
              {task.notes}
            </T>
          )}
        </View>
        <View style={{ gap: 8 }}>
          {di && (
            <T size={15} weight="700" style={{ color: di.tone === 'overdue' ? colors.danger : di.tone === 'soon' ? colors.warm : colors.text }}>
              📅 {di.tone === 'overdue' ? 'Overdue · ' : ''}
              {di.label}
            </T>
          )}
          {task.remindAt && task.remindAt.getTime() > Date.now() && (
            <T dim size={14}>
              🔔 {task.remindAt.toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </T>
          )}
          {!!task.delegatedTo && <T dim size={14}>→ {task.delegatedTo}</T>}
        </View>
      </View>
    </>
  );
}

function Action({ label, emoji, color, onPress, small }: { label: string; emoji: string; color: string; onPress: () => void; small?: boolean }) {
  const s = small ? 54 : 70;
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Press haptic="none" onPress={onPress} style={[styles.action, { width: s, height: s, borderRadius: s / 2, borderColor: color }]}>
        <T size={small ? 20 : 26} weight="800" style={{ color }}>
          {emoji}
        </T>
      </Press>
      <T faint size={11} weight="700">
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  deck: { flex: 1, margin: 20, marginTop: 24 },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#141526',
  },
  stamp: { position: 'absolute', top: 30, borderWidth: 3, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  qBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-end', paddingHorizontal: 20 },
  action: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  btn: { height: 54, borderRadius: 18, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
});
