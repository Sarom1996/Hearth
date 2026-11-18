import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { memo } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { dueInfo, snoozeTask, SNOOZES, updateTask, type Task } from '../lib/tasks';
import { colors } from '../lib/theme';
import { T } from './ui';

export type DragApi = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  hover: SharedValue<number>;
  rects: SharedValue<number[][]>; // [x, y, w, h] per quadrant, window coords
  begin: (task: Task) => void;
  end: (quadrantIndex: number) => void;
};

function hitTest(rects: number[][], x: number, y: number) {
  'worklet';
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r && r.length === 4 && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) return i;
  }
  return -1;
}

const tick = () => Haptics.selectionAsync();
const thud = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);

export function completeTask(t: Task) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return updateTask(t.id, { done: !t.done });
}

export function askSnooze(t: Task) {
  ActionSheetIOS.showActionSheetWithOptions(
    { title: `Snooze “${t.title}”`, options: ['Cancel', ...SNOOZES.map((s) => s.label)], cancelButtonIndex: 0 },
    (i) => {
      if (i > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        snoozeTask(t, SNOOZES[i - 1].key);
      }
    },
  );
}

/**
 * A task in the matrix.
 *  • swipe right → complete (green)      • swipe left → snooze (amber)
 *  • long-press & drag → move to another quadrant
 *  • tap → open details                  • tap circle → complete
 */
export const TaskRow = memo(function TaskRow({
  task,
  color,
  ownerLabel,
  drag,
  compact,
}: {
  task: Task;
  color: string;
  ownerLabel?: string;
  drag: DragApi;
  compact?: boolean;
}) {
  const di = dueInfo(task);
  const tx = useSharedValue(0);
  const width = useSharedValue(300);
  const armed = useSharedValue(0); // -1 snooze, 1 done

  const onComplete = () => completeTask(task);
  const onSnooze = () => askSnooze(task);

  const swipe = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      tx.value = e.translationX;
      const th = width.value * 0.32;
      const next = e.translationX > th ? 1 : e.translationX < -th ? -1 : 0;
      if (next !== armed.value) {
        armed.value = next;
        if (next !== 0) scheduleOnRN(thud);
      }
    })
    .onEnd(() => {
      if (armed.value === 1 && !task.done) {
        tx.value = withTiming(width.value * 1.2, { duration: 220 });
        scheduleOnRN(onComplete);
      } else {
        if (armed.value === -1) scheduleOnRN(onSnooze);
        if (armed.value === 1 && task.done) scheduleOnRN(onComplete);
        tx.value = withSpring(0, { damping: 16 });
      }
      armed.value = 0;
    });

  const move = Gesture.Pan()
    .activateAfterLongPress(280)
    .onStart((e) => {
      drag.x.value = e.absoluteX;
      drag.y.value = e.absoluteY;
      drag.hover.value = hitTest(drag.rects.value, e.absoluteX, e.absoluteY);
      scheduleOnRN(drag.begin, task);
    })
    .onUpdate((e) => {
      drag.x.value = e.absoluteX;
      drag.y.value = e.absoluteY;
      const h = hitTest(drag.rects.value, e.absoluteX, e.absoluteY);
      if (h !== drag.hover.value) {
        drag.hover.value = h;
        scheduleOnRN(tick);
      }
    })
    .onEnd(() => {
      const h = drag.hover.value;
      drag.hover.value = -1;
      scheduleOnRN(drag.end, h);
    })
    .onFinalize((_, success) => {
      if (!success) scheduleOnRN(drag.end, -1);
    });

  const gesture = Gesture.Race(move, swipe);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const doneBg = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, 40], [0, 1], 'clamp'),
  }));
  const snoozeBg = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-40, 0], [1, 0], 'clamp'),
  }));
  const doneIcon = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(tx.value, [0, width.value * 0.32, width.value * 0.4], [0.6, 1.25, 1], 'clamp') }],
  }));
  const snoozeIcon = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(-tx.value, [0, width.value * 0.32, width.value * 0.4], [0.6, 1.25, 1], 'clamp') }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(220)}
      layout={LinearTransition.springify().damping(18)}
      onLayout={(e) => {
        width.value = e.nativeEvent.layout.width;
      }}
      style={{ marginBottom: 6 }}
    >
      {/* Swipe backgrounds */}
      <Animated.View style={[styles.bg, { backgroundColor: colors.good, alignItems: 'flex-start' }, doneBg]}>
        <Animated.View style={[styles.bgInner, doneIcon]}>
          <T size={13} weight="900" style={{ color: '#0B0C14' }}>
            {task.done ? '↺ Undo' : '✓ Done'}
          </T>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.bg, { backgroundColor: colors.warm, alignItems: 'flex-end' }, snoozeBg]}>
        <Animated.View style={[styles.bgInner, snoozeIcon]}>
          <T size={13} weight="900" style={{ color: '#0B0C14' }}>
            💤 Snooze
          </T>
        </Animated.View>
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <Animated.View style={rowStyle}>
          <Pressable
            onPress={() => router.push({ pathname: '/task', params: { id: task.id } })}
            style={({ pressed }) => [styles.row, compact && styles.compact, pressed && { backgroundColor: '#24263F' }]}
          >
            <Pressable hitSlop={10} onPress={onComplete} style={[styles.check, { borderColor: color }, task.done && { backgroundColor: color }]}>
              {task.done && (
                <T size={11} weight="900" style={{ color: '#0B0C14' }}>
                  ✓
                </T>
              )}
            </Pressable>
            <View style={{ flex: 1, gap: 3 }}>
              <T
                size={compact ? 14 : 15}
                weight="600"
                numberOfLines={compact ? 2 : 3}
                style={task.done ? { textDecorationLine: 'line-through', color: colors.textFaint } : undefined}
              >
                {task.title}
              </T>
              {(di || task.remindAt || ownerLabel || task.delegatedTo) && (
                <View style={styles.meta}>
                  {di && (
                    <T size={11} weight="700" style={{ color: di.tone === 'overdue' ? colors.danger : di.tone === 'soon' ? colors.warm : colors.textDim }}>
                      {di.tone === 'overdue' ? '⚠︎ ' : ''}
                      {di.label}
                    </T>
                  )}
                  {task.remindAt && task.remindAt.getTime() > Date.now() && !task.done && (
                    <T size={11} dim>
                      🔔
                    </T>
                  )}
                  {!!task.delegatedTo && (
                    <T size={11} dim numberOfLines={1}>
                      → {task.delegatedTo}
                    </T>
                  )}
                  {!!ownerLabel && (
                    <View style={styles.owner}>
                      <T size={10} weight="700" dim>
                        {ownerLabel}
                      </T>
                    </View>
                  )}
                </View>
              )}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#191A2E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  compact: { paddingVertical: 8, paddingHorizontal: 8 },
  bg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 14, justifyContent: 'center' },
  bgInner: { paddingHorizontal: 12 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  owner: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)' },
});
