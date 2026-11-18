import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { fb } from './firebase';

export type QuadrantId = 'do' | 'schedule' | 'delegate' | 'drop';

export type Quadrant = {
  id: QuadrantId;
  title: string;
  verb: string;
  hint: string;
  urgent: boolean;
  important: boolean;
  color: string;
  glow: string;
  sf: string;
};

export const QUADRANTS: Quadrant[] = [
  { id: 'do', title: 'Do now', verb: 'Do', hint: 'Urgent · Important', urgent: true, important: true, color: '#FF6B8B', glow: 'rgba(255,107,139,0.20)', sf: 'flame.fill' },
  { id: 'schedule', title: 'Schedule', verb: 'Plan', hint: 'Not urgent · Important', urgent: false, important: true, color: '#8B7CFF', glow: 'rgba(139,124,255,0.20)', sf: 'calendar' },
  { id: 'delegate', title: 'Delegate', verb: 'Hand off', hint: 'Urgent · Not important', urgent: true, important: false, color: '#4FD1C5', glow: 'rgba(79,209,197,0.18)', sf: 'person.2.fill' },
  { id: 'drop', title: 'Drop', verb: 'Drop', hint: 'Not urgent · Not important', urgent: false, important: false, color: '#9AA0B5', glow: 'rgba(154,160,181,0.14)', sf: 'trash' },
];

export const quadrantOf = (t: { urgent: boolean; important: boolean }): QuadrantId =>
  t.urgent && t.important ? 'do' : t.important ? 'schedule' : t.urgent ? 'delegate' : 'drop';

export const quadrantById = (id: QuadrantId) => QUADRANTS.find((q) => q.id === id)!;

export type Task = {
  id: string;
  title: string;
  notes: string;
  urgent: boolean;
  important: boolean;
  due: Date | null;
  /** If true the due has a meaningful time of day, otherwise it's an all-day date. */
  dueHasTime: boolean;
  remindAt: Date | null;
  owner: 'home' | string; // 'home' (shared) or a member uid
  delegatedTo: string; // free text: "plumber", "Sara", ...
  done: boolean;
  doneAt: Date | null;
  effort: 'quick' | 'medium' | 'big' | null;
  createdBy: string;
  createdAt: Date;
  /** Gmail message this task came from ('' if none) */
  sourceEmailId: string;
};

export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'doneAt' | 'done' | 'sourceEmailId'> & { done?: boolean; sourceEmailId?: string };

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
const ts = (d: Date | null) => (d ? Timestamp.fromDate(d) : null);

export function useTasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    const q = query(collection(fb().db, 'tasks'), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) =>
        setTasks(
          snap.docs.map((x) => {
            const v = x.data();
            return {
              id: x.id,
              title: v.title ?? '',
              notes: v.notes ?? '',
              urgent: !!v.urgent,
              important: !!v.important,
              due: toDate(v.due),
              dueHasTime: !!v.dueHasTime,
              remindAt: toDate(v.remindAt),
              owner: v.owner ?? 'home',
              delegatedTo: v.delegatedTo ?? '',
              done: !!v.done,
              doneAt: toDate(v.doneAt),
              effort: v.effort ?? null,
              createdBy: v.createdBy ?? '',
              createdAt: toDate(v.createdAt) ?? new Date(),
              sourceEmailId: v.sourceEmailId ?? '',
            };
          }),
        ),
      () => setTasks([]),
    );
  }, []);
  return tasks;
}

export async function addTask(t: TaskInput) {
  const ref = await addDoc(collection(fb().db, 'tasks'), {
    ...t,
    sourceEmailId: t.sourceEmailId ?? '',
    done: t.done ?? false,
    due: ts(t.due),
    remindAt: ts(t.remindAt),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function updateTask(id: string, patch: Partial<TaskInput> & { done?: boolean }) {
  const data: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp() };
  if ('due' in patch) data.due = ts(patch.due ?? null);
  if ('remindAt' in patch) data.remindAt = ts(patch.remindAt ?? null);
  if ('done' in patch) data.doneAt = patch.done ? serverTimestamp() : deleteField();
  return updateDoc(doc(fb().db, 'tasks', id), data);
}

export const moveTask = (id: string, q: QuadrantId) => {
  const { urgent, important } = quadrantById(q);
  return updateTask(id, { urgent, important });
};

export const deleteTask = (id: string) => deleteDoc(doc(fb().db, 'tasks', id));

/* ───────── Sorting ───────── */

export type SortKey = 'smart' | 'due' | 'newest' | 'az';
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'smart', label: 'Smart' },
  { key: 'due', label: 'Due date' },
  { key: 'newest', label: 'Newest' },
  { key: 'az', label: 'A–Z' },
];

const far = 8.64e15;
const effortRank = { quick: 0, medium: 1, big: 2 } as const;

export function sortTasks(list: Task[], key: SortKey) {
  const out = [...list];
  switch (key) {
    case 'due':
      return out.sort((a, b) => (a.due?.getTime() ?? far) - (b.due?.getTime() ?? far));
    case 'newest':
      return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    case 'az':
      return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'smart':
    default:
      // Overdue first, then soonest due, then quick wins, then newest.
      return out.sort((a, b) => {
        const ad = a.due?.getTime() ?? far;
        const bd = b.due?.getTime() ?? far;
        if (ad !== bd) return ad - bd;
        const ae = a.effort ? effortRank[a.effort] : 1;
        const be = b.effort ? effortRank[b.effort] : 1;
        if (ae !== be) return ae - be;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }
}

/* ───────── Due helpers ───────── */

export function dueInfo(t: Pick<Task, 'due' | 'dueHasTime' | 'done'>, now = new Date()) {
  if (!t.due) return null;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(t.due);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - startToday.getTime()) / 86400000);
  const overdue = !t.done && (t.dueHasTime ? t.due.getTime() < now.getTime() : days < 0);
  const time = t.dueHasTime ? t.due.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '';
  let label: string;
  if (days === 0) label = time ? `Today ${time}` : 'Today';
  else if (days === 1) label = time ? `Tomorrow ${time}` : 'Tomorrow';
  else if (days === -1) label = 'Yesterday';
  else if (days > 1 && days < 7) label = t.due.toLocaleDateString('en-CA', { weekday: 'short' }) + (time ? ` ${time}` : '');
  else label = t.due.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const tone: 'overdue' | 'soon' | 'later' = overdue ? 'overdue' : days <= 1 ? 'soon' : 'later';
  return { label, tone, days };
}

/* ───────── Snooze ───────── */

export type SnoozeKey = '1h' | '3h' | 'tonight' | 'tomorrow' | 'nextweek';
export const SNOOZES: { key: SnoozeKey; label: string }[] = [
  { key: '1h', label: 'In 1 hour' },
  { key: '3h', label: 'Later today (+3 h)' },
  { key: 'tonight', label: 'Tonight 7 pm' },
  { key: 'tomorrow', label: 'Tomorrow 9 am' },
  { key: 'nextweek', label: 'Next Monday 9 am' },
];

export function snoozeTime(key: SnoozeKey, now = new Date()) {
  const d = new Date(now);
  switch (key) {
    case '1h':
      return new Date(now.getTime() + 3600000);
    case '3h':
      return new Date(now.getTime() + 3 * 3600000);
    case 'tonight':
      d.setHours(19, 0, 0, 0);
      return d.getTime() > now.getTime() ? d : new Date(now.getTime() + 3600000);
    case 'tomorrow':
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    case 'nextweek':
      d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
      d.setHours(9, 0, 0, 0);
      return d;
  }
}

/** Push the reminder (and an already-passed due date) to a later time. */
export function snoozeTask(t: Task, key: SnoozeKey) {
  const at = snoozeTime(key);
  const patch: Partial<TaskInput> = { remindAt: at };
  if (t.due && t.due.getTime() < at.getTime()) {
    patch.due = at;
    patch.dueHasTime = true;
  }
  return updateTask(t.id, patch);
}
