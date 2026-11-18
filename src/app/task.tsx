import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Press, T } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useMembers } from '../lib/db';
import { addToCalendar, useGoogleConnection } from '../lib/google';
import { usePrefs } from '../lib/prefs';
import { REMINDER_PRESETS, reminderFromPreset, type ReminderPreset } from '../lib/reminders';
import {
  addTask,
  deleteTask,
  QUADRANTS,
  quadrantById,
  quadrantOf,
  updateTask,
  useTasks,
  type QuadrantId,
  type Task,
} from '../lib/tasks';
import { colors } from '../lib/theme';

const EFFORTS: { key: NonNullable<Task['effort']>; label: string }[] = [
  { key: 'quick', label: '⚡ Quick' },
  { key: 'medium', label: '⏱ Medium' },
  { key: 'big', label: '🏔 Big' },
];

function tomorrowAt9() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

export default function TaskSheet() {
  const { id, q: qParam } = useLocalSearchParams<{ id?: string; q?: QuadrantId }>();
  const { user } = useAuth();
  const members = useMembers();
  const tasks = useTasks();
  const existing = useMemo(() => tasks?.find((t) => t.id === id), [tasks, id]);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [quadrant, setQuadrant] = useState<QuadrantId>(qParam ?? 'schedule');
  const [hasDue, setHasDue] = useState(false);
  const [due, setDue] = useState<Date>(tomorrowAt9());
  const [dueHasTime, setDueHasTime] = useState(false);
  const [preset, setPreset] = useState<ReminderPreset | 'custom'>('none');
  const [customRemind, setCustomRemind] = useState<Date>(tomorrowAt9());
  const [owner, setOwner] = useState<string>('home');
  const [delegatedTo, setDelegatedTo] = useState('');
  const [effort, setEffort] = useState<Task['effort']>(null);
  const [loaded, setLoaded] = useState(!id);
  const prefs = usePrefs();
  const cal = useGoogleConnection('calendar');
  const [calState, setCalState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (!existing || loaded) return;
    setTitle(existing.title);
    setNotes(existing.notes);
    setQuadrant(quadrantOf(existing));
    setHasDue(!!existing.due);
    if (existing.due) setDue(existing.due);
    setDueHasTime(existing.dueHasTime);
    if (existing.remindAt) {
      setPreset('custom');
      setCustomRemind(existing.remindAt);
    }
    setOwner(existing.owner);
    setDelegatedTo(existing.delegatedTo);
    setEffort(existing.effort);
    setLoaded(true);
  }, [existing, loaded]);

  const q = quadrantById(quadrant);
  const remindAt =
    preset === 'custom' ? customRemind : reminderFromPreset(hasDue ? due : null, preset, dueHasTime);

  const save = async () => {
    if (!title.trim() || !user) return;
    const data = {
      title: title.trim(),
      notes: notes.trim(),
      urgent: q.urgent,
      important: q.important,
      due: hasDue ? (dueHasTime ? due : new Date(due.getFullYear(), due.getMonth(), due.getDate(), 12)) : null,
      dueHasTime: hasDue && dueHasTime,
      remindAt,
      owner,
      delegatedTo: delegatedTo.trim(),
      effort,
      createdBy: existing?.createdBy ?? user.uid,
    };
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (existing) await updateTask(existing.id, data);
    else {
      await addTask(data);
      if (prefs.calendarAddTasks && cal.connected && data.due && data.dueHasTime) {
        addToCalendar({ title: data.title, notes: data.notes, due: data.due, dueHasTime: true }).catch(() => {});
      }
    }
    router.back();
  };

  const remove = () =>
    Alert.alert('Delete task?', existing?.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTask(existing!.id);
          router.back();
        },
      },
    ]);

  const owners = [
    { key: 'home', label: '🏠 Shared' },
    ...members.map((m) => ({ key: m.uid, label: m.uid === user?.uid ? '🙋 Me' : `💛 ${m.firstName}` })),
  ];

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg2 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 18, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <T size={13} weight="800" style={{ color: q.color, letterSpacing: 1.5, flex: 1 }}>
            {existing ? 'EDIT TASK' : 'NEW TASK'} · {q.title.toUpperCase()}
          </T>
          {existing && (
            <Press onPress={() => updateTask(existing.id, { done: !existing.done }).then(() => router.back())} style={styles.smallBtn}>
              <T size={13} weight="700">
                {existing.done ? 'Reopen' : '✓ Done'}
              </T>
            </Press>
          )}
        </View>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          placeholderTextColor={colors.textFaint}
          style={styles.title}
          autoFocus={!id}
          multiline
        />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes, links, details…"
          placeholderTextColor={colors.textFaint}
          style={styles.notes}
          multiline
        />

        {/* Quadrant picker */}
        <Section label="Priority">
          <View style={styles.qGrid}>
            {QUADRANTS.map((x) => {
              const on = x.id === quadrant;
              return (
                <Press
                  key={x.id}
                  onPress={() => setQuadrant(x.id)}
                  style={[styles.qTile, { borderColor: on ? x.color : 'rgba(255,255,255,0.08)', backgroundColor: on ? x.glow : 'rgba(255,255,255,0.04)' }]}
                >
                  <T size={15} weight="800" style={{ color: on ? x.color : colors.text }}>
                    {x.title}
                  </T>
                  <T size={11} faint>
                    {x.hint}
                  </T>
                </Press>
              );
            })}
          </View>
        </Section>

        {/* Due */}
        <Section label="Due">
          <Line label="Has a due date">
            <Switch value={hasDue} onValueChange={setHasDue} trackColor={{ true: colors.accent }} />
          </Line>
          {hasDue && (
            <>
              <Line label="Specific time">
                <Switch value={dueHasTime} onValueChange={setDueHasTime} trackColor={{ true: colors.accent }} />
              </Line>
              <Line label="When">
                <DateTimePicker
                  value={due}
                  mode={dueHasTime ? 'datetime' : 'date'}
                  display="compact"
                  themeVariant="dark"
                  accentColor={colors.accent}
                  minuteInterval={5}
                  onValueChange={(_, d) => setDue(d)}
                />
              </Line>
            </>
          )}
        </Section>

        {/* Reminder */}
        <Section label="Reminder">
          <View style={styles.chips}>
            {[...REMINDER_PRESETS, { key: 'custom' as const, label: 'Custom…' }]
              .filter((p) => hasDue || p.key === 'none' || p.key === 'custom')
              .map((p) => (
                <Chip key={p.key} on={preset === p.key} onPress={() => setPreset(p.key)} label={p.label} />
              ))}
          </View>
          {preset === 'custom' && (
            <Line label="Remind me">
              <DateTimePicker
                value={customRemind}
                mode="datetime"
                display="compact"
                themeVariant="dark"
                accentColor={colors.accent}
                minuteInterval={5}
                onValueChange={(_, d) => setCustomRemind(d)}
              />
            </Line>
          )}
          {remindAt && (
            <T size={12} dim>
              🔔 {remindAt.toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {remindAt.getTime() < Date.now() ? '  (in the past)' : ''}
            </T>
          )}
        </Section>

        {/* Owner */}
        <Section label="Whose task">
          <View style={styles.chips}>
            {owners.map((o) => (
              <Chip key={o.key} on={owner === o.key} onPress={() => setOwner(o.key)} label={o.label} />
            ))}
          </View>
          {quadrant === 'delegate' && (
            <TextInput
              value={delegatedTo}
              onChangeText={setDelegatedTo}
              placeholder="Hand off to… (e.g. plumber, landlord)"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
          )}
        </Section>

        <Section label="Effort">
          <View style={styles.chips}>
            {EFFORTS.map((e) => (
              <Chip key={e.key} on={effort === e.key} onPress={() => setEffort(effort === e.key ? null : e.key)} label={e.label} />
            ))}
          </View>
        </Section>

        {cal.connected && hasDue && !!title.trim() && (
          <Press
            disabled={calState === 'busy' || calState === 'done'}
            onPress={async () => {
              setCalState('busy');
              try {
                await addToCalendar({ title: title.trim(), notes: notes.trim(), due, dueHasTime });
                setCalState('done');
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                setCalState('error');
              }
            }}
            style={styles.line}
          >
            <T style={{ flex: 1 }}>
              {calState === 'done' ? '✅ Added to Google Calendar' : calState === 'error' ? '⚠︎ Could not add — try again' : '📅 Add to Google Calendar'}
            </T>
            {calState === 'busy' && <T dim>…</T>}
          </Press>
        )}

        <Press haptic="medium" onPress={save} disabled={!title.trim()} style={[styles.save, { backgroundColor: q.color }]}>
          <T size={17} weight="800" style={{ color: '#0B0C14' }}>
            {existing ? 'Save changes' : 'Add to matrix'}
          </T>
        </Press>
        {existing && (
          <Press onPress={remove} style={{ alignItems: 'center', padding: 10 }}>
            <T size={15} style={{ color: colors.danger }}>
              Delete task
            </T>
          </Press>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <T faint size={12} weight="800" style={{ letterSpacing: 1.5 }}>
        {label.toUpperCase()}
      </T>
      {children}
    </View>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.line}>
      <T style={{ flex: 1 }}>{label}</T>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={[styles.chip, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      <T size={13} weight={on ? '700' : '500'} dim={!on}>
        {label}
      </T>
    </Press>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  notes: { color: colors.textDim, fontSize: 16, minHeight: 44 },
  input: {
    color: colors.text,
    fontSize: 15,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  qGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qTile: { width: '48.8%', padding: 14, borderRadius: 18, borderWidth: 1.5, gap: 2 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    minHeight: 50,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)' },
  save: { height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
