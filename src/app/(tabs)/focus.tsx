import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, type HostInstance } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  ZoomIn,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../../components/Backdrop';
import { Ring } from '../../components/Ring';
import { TaskRow, type DragApi } from '../../components/TaskRow';
import { Press, Segments, T } from '../../components/ui';
import { aiEnabled, aiResort, type SortAdvice } from '../../lib/ai';
import { useAuth } from '../../lib/auth';
import { useMembers } from '../../lib/db';
import {
  moveTask,
  QUADRANTS,
  quadrantOf,
  sortTasks,
  SORTS,
  useTasks,
  type Quadrant,
  type QuadrantId,
  type SortKey,
  type Task,
} from '../../lib/tasks';
import { colors } from '../../lib/theme';

type OwnerFilter = 'all' | 'me' | 'partner' | 'home';

export default function Focus() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const members = useMembers();
  const tasks = useTasks();
  const [sort, setSort] = useState<SortKey>('smart');
  const [owner, setOwner] = useState<OwnerFilter>('all');
  const [showDone, setShowDone] = useState(false);
  const [expanded, setExpanded] = useState<QuadrantId | null>(null);
  const [advice, setAdvice] = useState<SortAdvice | null>(null);
  const [thinking, setThinking] = useState(false);

  const me = user?.uid ?? '';
  const partner = members.find((m) => m.uid !== me);
  const ownerLabel = useCallback(
    (t: Task) => {
      if (t.owner === 'home') return 'Shared';
      if (t.owner === me) return 'Me';
      return members.find((m) => m.uid === t.owner)?.firstName ?? '';
    },
    [members, me],
  );

  const byQuadrant = useMemo(() => {
    const filtered = (tasks ?? []).filter((t) => {
      if (!showDone && t.done) return false;
      if (owner === 'me') return t.owner === me;
      if (owner === 'partner') return !!partner && t.owner === partner.uid;
      if (owner === 'home') return t.owner === 'home';
      return true;
    });
    const map: Record<QuadrantId, Task[]> = { do: [], schedule: [], delegate: [], drop: [] };
    for (const t of filtered) map[quadrantOf(t)].push(t);
    (Object.keys(map) as QuadrantId[]).forEach((k) => {
      const open = sortTasks(map[k].filter((t) => !t.done), sort);
      const done = map[k].filter((t) => t.done);
      map[k] = [...open, ...done];
    });
    return map;
  }, [tasks, sort, owner, showDone, me, partner]);

  const openCount = (tasks ?? []).filter((t) => !t.done).length;
  const progressOf = (q: QuadrantId) => {
    const all = (tasks ?? []).filter((t) => quadrantOf(t) === q);
    return all.length ? all.filter((t) => t.done).length / all.length : 0;
  };
  const weekAgo = Date.now() - 7 * 86400000;
  const doneWeek = (tasks ?? []).filter((t) => t.done && (t.doneAt?.getTime() ?? 0) > weekAgo).length;

  /* ───── Drag & drop between quadrants ───── */
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const hover = useSharedValue(-1);
  const rects = useSharedValue<number[][]>([[], [], [], []]);
  const rootRef = useRef<HostInstance>(null);
  const [rootOffset, setRootOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<Task | null>(null);
  const draggingRef = useRef<Task | null>(null);

  const quadRefs = useRef<(HostInstance | null)[]>([null, null, null, null]);
  const remeasure = useCallback(() => {
    quadRefs.current.forEach((ref, i) =>
      ref?.measureInWindow((qx, qy, w, h) => {
        const next = [...rects.value];
        next[i] = w > 0 ? [qx, qy, w, h] : [];
        rects.value = next;
      }),
    );
  }, [rects]);
  const measureQuadrant = (i: number) => (ref: HostInstance | null) => {
    quadRefs.current[i] = ref;
  };

  const drag: DragApi = useMemo(
    () => ({
      x,
      y,
      hover,
      rects,
      begin: (t: Task) => {
        remeasure();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        draggingRef.current = t;
        setDragging(t);
      },
      end: (qi: number) => {
        const t = draggingRef.current;
        draggingRef.current = null;
        setDragging(null);
        if (!t || qi < 0) return;
        const target = QUADRANTS[qi].id;
        if (target !== quadrantOf(t)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          moveTask(t.id, target);
        }
      },
    }),
    [x, y, hover, rects, remeasure],
  );

  const floating = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - rootOffset.x - 110 },
      { translateY: y.value - rootOffset.y - 30 },
      { rotate: '-3deg' },
      { scale: 1.04 },
    ],
  }));

  /* ───── AI re-sort ───── */
  const runResort = async () => {
    if (!tasks) return;
    setThinking(true);
    try {
      setAdvice(await aiResort(tasks));
    } catch (e) {
      setAdvice({ moves: [], focus: [], summary: e instanceof Error ? e.message : 'AI failed' });
    } finally {
      setThinking(false);
    }
  };
  const applyAdvice = async () => {
    if (!advice) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Promise.all(advice.moves.map((m) => moveTask(m.id, m.to)));
    setAdvice(null);
  };

  useEffect(() => {
    if (expanded) quadRefs.current.forEach((_, i) => QUADRANTS[i].id !== expanded && (quadRefs.current[i] = null));
    const id = setTimeout(remeasure, 450);
    return () => clearTimeout(id);
  }, [expanded, advice, remeasure]);

  const visibleQuadrants = expanded ? QUADRANTS.filter((q) => q.id === expanded) : QUADRANTS;

  return (
    <View
      ref={rootRef}
      style={{ flex: 1 }}
      onLayout={() => rootRef.current?.measureInWindow((rx, ry) => setRootOffset({ x: rx, y: ry }))}
    >
      <Backdrop />
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, gap: 12 }}>
        {/* Header */}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <T size={32} weight="800" style={{ letterSpacing: -0.8 }}>
              Focus
            </T>
            <T dim size={13}>
              {openCount} open · {doneWeek} done this week
            </T>
          </View>
          <Press onPress={runResort} style={styles.iconBtn} disabled={thinking}>
            {thinking ? <ActivityIndicator color={colors.text} size="small" /> : <T size={17}>🪄</T>}
          </Press>
          <Press onPress={() => router.push('/review')} style={styles.iconBtn}>
            <T size={15}>▶︎</T>
          </Press>
          <Press onPress={() => router.push({ pathname: '/ask-ai', params: { listen: '1' } })} style={[styles.iconBtn, { backgroundColor: colors.accent }]}>
            <T size={17}>🎙️</T>
          </Press>
        </View>

        {/* Controls */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
          <Segments value={sort} options={SORTS} onChange={setSort} />
          <Segments<OwnerFilter>
            value={owner}
            onChange={setOwner}
            options={[
              { key: 'all', label: 'All' },
              { key: 'me', label: 'Me' },
              ...(partner ? [{ key: 'partner' as const, label: partner.firstName }] : []),
              { key: 'home', label: 'Shared' },
            ]}
          />
          <Press onPress={() => setShowDone((v) => !v)} style={[styles.pill, showDone && { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
            <T size={13} weight="600" dim={!showDone}>
              ✓ Done
            </T>
          </Press>
        </ScrollView>

        {/* AI advice banner */}
        {advice && (
          <Animated.View entering={FadeInDown} exiting={FadeOut} style={styles.advice}>
            <T size={14} weight="700">
              🪄 {aiEnabled() ? 'Claude suggests' : 'Suggestion'}
            </T>
            <T size={13} dim style={{ marginTop: 4 }}>
              {advice.summary}
            </T>
            {advice.moves.slice(0, 4).map((m) => {
              const t = tasks?.find((k) => k.id === m.id);
              const q = QUADRANTS.find((k) => k.id === m.to);
              if (!t || !q) return null;
              return (
                <T key={m.id} size={13} style={{ marginTop: 6 }}>
                  • {t.title} → <T size={13} weight="700" style={{ color: q.color }}>{q.title}</T>
                  <T size={12} faint> — {m.why}</T>
                </T>
              );
            })}
            <View style={[styles.row, { gap: 8, marginTop: 10 }]}>
              {advice.moves.length > 0 && (
                <Press onPress={applyAdvice} style={[styles.pill, { backgroundColor: colors.accent }]}>
                  <T size={13} weight="700">
                    Apply {advice.moves.length}
                  </T>
                </Press>
              )}
              <Press onPress={() => setAdvice(null)} style={styles.pill}>
                <T size={13} dim>
                  Dismiss
                </T>
              </Press>
            </View>
          </Animated.View>
        )}

        {/* Axis labels */}
        <View style={[styles.row, { paddingLeft: 22 }]}>
          <T faint size={10} weight="800" style={styles.axis}>
            URGENT
          </T>
          <T faint size={10} weight="800" style={styles.axis}>
            NOT URGENT
          </T>
        </View>
      </View>

      {/* Matrix */}
      <View style={[styles.matrixWrap, { paddingBottom: insets.bottom + 70 }]}>
        <View style={styles.sideAxis}>
          <T faint size={10} weight="800" style={styles.sideText}>
            IMPORTANT
          </T>
          <T faint size={10} weight="800" style={styles.sideText}>
            NOT IMPORTANT
          </T>
        </View>
        <Animated.View layout={LinearTransition.springify().damping(20)} style={styles.grid}>
          {visibleQuadrants.map((q) => {
            const i = QUADRANTS.indexOf(q);
            return (
              <QuadrantCard
                key={q.id}
                q={q}
                index={i}
                tasks={byQuadrant[q.id]}
                progress={progressOf(q.id)}
                expanded={expanded === q.id}
                hover={hover}
                onToggleExpand={() => setExpanded((e) => (e === q.id ? null : q.id))}
                measureRef={measureQuadrant(i)}
                onLayout={remeasure}
                drag={drag}
                ownerLabel={ownerLabel}
                loading={tasks === null}
              />
            );
          })}
        </Animated.View>
      </View>

      {/* Floating chip while dragging */}
      {dragging && (
        <Animated.View pointerEvents="none" entering={ZoomIn.duration(150)} style={[styles.floating, floating]}>
          <T size={14} weight="700" numberOfLines={2}>
            {dragging.title}
          </T>
        </Animated.View>
      )}
    </View>
  );
}

function QuadrantCard({
  q,
  index,
  tasks,
  progress,
  expanded,
  hover,
  onToggleExpand,
  measureRef,
  onLayout,
  drag,
  ownerLabel,
  loading,
}: {
  q: Quadrant;
  index: number;
  tasks: Task[];
  progress: number;
  expanded: boolean;
  hover: SharedValue<number>;
  onToggleExpand: () => void;
  measureRef: (r: HostInstance | null) => void;
  onLayout: () => void;
  drag: DragApi;
  ownerLabel: (t: Task) => string;
  loading: boolean;
}) {
  const hl = useAnimatedStyle(() => {
    const on = hover.value === index;
    return {
      borderColor: on ? q.color : 'rgba(255,255,255,0.10)',
      transform: [{ scale: withSpring(on ? 1.02 : 1, { damping: 16 }) }],
    };
  });
  const open = tasks.filter((t) => !t.done).length;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      layout={LinearTransition.springify().damping(20)}
      onLayout={onLayout}
      style={[styles.quad, expanded ? styles.quadFull : styles.quadHalf, hl]}
    >
      <View ref={measureRef} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <LinearGradient colors={[q.glow, 'rgba(255,255,255,0.02)']} style={StyleSheet.absoluteFill} />
      <Press onPress={onToggleExpand} haptic="light" style={styles.quadHead}>
        <View style={[styles.qDot, { backgroundColor: q.color }]} />
        <View style={{ flex: 1 }}>
          <T size={15} weight="800">
            {q.title}
          </T>
          {expanded && (
            <T size={11} faint>
              {q.hint}
            </T>
          )}
        </View>
        <Ring size={30} stroke={3.5} progress={progress} from={q.color} to={q.color} track={q.color + '30'}>
          <T size={11} weight="800" style={{ color: q.color }}>
            {open}
          </T>
        </Ring>
        <Press
          onPress={() => router.push({ pathname: '/task', params: { q: q.id } })}
          style={[styles.add, { borderColor: q.color + '88' }]}
        >
          <T size={16} weight="700" style={{ color: q.color, marginTop: -1 }}>
            +
          </T>
        </Press>
      </Press>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.textDim} style={{ marginTop: 20 }} />
        ) : tasks.length === 0 ? (
          <T faint size={12} style={{ textAlign: 'center', marginTop: 18, paddingHorizontal: 8 }}>
            Tap + or drag a task here.{'\n'}Swipe → done · ← snooze
          </T>
        ) : (
          tasks.map((t) => (
            <TaskRow key={t.id} task={t} color={q.color} drag={drag} compact={!expanded} ownerLabel={expanded ? ownerLabel(t) : undefined} />
          ))
        )}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  advice: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(139,124,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,124,255,0.5)',
  },
  axis: { flex: 1, textAlign: 'center', letterSpacing: 2 },
  matrixWrap: { flex: 1, flexDirection: 'row', paddingHorizontal: 12, paddingTop: 6 },
  sideAxis: { width: 16, justifyContent: 'space-around', alignItems: 'center' },
  sideText: { transform: [{ rotate: '-90deg' }], width: 140, textAlign: 'center', letterSpacing: 2 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quad: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  quadHalf: { width: '48.6%', height: '49.2%' },
  quadFull: { width: '100%', height: '100%' },
  quadHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  qDot: { width: 10, height: 10, borderRadius: 5 },
  count: { minWidth: 26, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  add: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  floating: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 220,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#1D1F3A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
});
