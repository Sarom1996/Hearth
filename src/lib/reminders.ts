import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { getPrefs, usePrefs } from './prefs';
import { quadrantById, quadrantOf, snoozeTask, updateTask, type Task } from './tasks';

export { REMINDER_PRESETS, reminderFromPreset, type ReminderPreset } from './reminderPresets';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Action buttons on a task reminder (long-press the notification).
Notifications.setNotificationCategoryAsync('task', [
  { identifier: 'done', buttonTitle: '✓ Done', options: { opensAppToForeground: true } },
  { identifier: 'snooze', buttonTitle: '💤 1 hour', options: { opensAppToForeground: true } },
]).catch(() => {});

export async function ensureNotificationPermission() {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return req.granted;
}

export const getNudgesEnabled = async () => (await getPrefs()).nudges;

const idFor = (t: Task) => `task:${t.id}:${t.remindAt!.getTime()}`;

function digestBodies(mine: Task[]) {
  const open = mine.filter((t) => !t.done);
  const doNow = open.filter((t) => quadrantOf(t) === 'do');
  const now = Date.now();
  const overdue = open.filter((t) => t.due && t.due.getTime() < now);
  const top = doNow
    .slice(0, 3)
    .map((t) => `• ${t.title}`)
    .join('\n');
  const am = doNow.length
    ? { title: `🔥 ${doNow.length} to do today`, body: top }
    : {
        title: '☀️ Good morning',
        body: open.length ? `${open.length} open tasks — nothing on fire. Plan one thing from “Schedule”.` : 'Your matrix is clear. Enjoy the day!',
      };
  const pm = open.length
    ? {
        title: `🌙 ${open.length} still open${overdue.length ? ` · ${overdue.length} overdue` : ''}`,
        body: 'Tap for a 1-minute review: swipe right if done, left for tomorrow.',
      }
    : { title: '🌙 All clear', body: 'Nothing left open today. Nice work!' };
  return { am, pm };
}

/**
 * Keeps this iPhone's scheduled notifications in sync with the shared task list.
 * Each phone schedules reminders for its own tasks + shared ("home") tasks,
 * plus a morning digest (8 am) and an evening check-in (8 pm).
 * All local — fires even when the app is closed, no server needed.
 */
export function useReminderSync(tasks: Task[] | null, myUid: string | undefined) {
  const { nudges: nudgePref } = usePrefs();
  useEffect(() => {
    if (!tasks || !myUid) return;
    let cancelled = false;
    (async () => {
      const mine = tasks.filter((t) => t.owner === 'home' || t.owner === myUid);
      const wanted = new Map<string, Task>();
      const now = Date.now();
      for (const t of mine) {
        if (t.done || !t.remindAt || t.remindAt.getTime() <= now) continue;
        wanted.set(idFor(t), t);
      }
      const nudges = await getNudgesEnabled();
      if ((wanted.size > 0 || nudges) && !(await ensureNotificationPermission())) return;
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      if (cancelled) return;

      // Task reminders
      const existing = new Set<string>();
      for (const n of scheduled) {
        if (!n.identifier.startsWith('task:')) continue;
        if (wanted.has(n.identifier)) existing.add(n.identifier);
        else await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
      for (const [id, t] of wanted) {
        if (existing.has(id)) continue;
        const q = quadrantById(quadrantOf(t));
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: t.title,
            body: t.notes ? t.notes.slice(0, 140) : `${q.title} · ${q.hint}`,
            sound: true,
            categoryIdentifier: 'task',
            data: { taskId: t.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: t.remindAt! },
        });
      }

      // Daily digests — rescheduled only when their text changes
      const { am, pm } = digestBodies(mine);
      const digests: [string, { title: string; body: string }, number][] = [
        ['digest:am', am, 8],
        ['digest:pm', pm, 20],
      ];
      for (const [id, content, hour] of digests) {
        const cur = scheduled.find((n) => n.identifier === id);
        if (!nudges) {
          if (cur) await Notifications.cancelScheduledNotificationAsync(id);
          continue;
        }
        if (cur && cur.content.title === content.title && cur.content.body === content.body) continue;
        if (cur) await Notifications.cancelScheduledNotificationAsync(id);
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: { ...content, sound: true, data: { route: '/review' } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 },
        });
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tasks, myUid, nudgePref]);
}

/** Handles taps on notifications and their action buttons (Done / Snooze). */
export function useNotificationRouting(tasks: Task[] | null) {
  const last = Notifications.useLastNotificationResponse();
  const ready = tasks !== null;
  useEffect(() => {
    if (!last || !tasks) return;
    const data = last.notification.request.content.data as { taskId?: string; route?: string };
    const task = data.taskId ? tasks.find((t) => t.id === data.taskId) : undefined;
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
    if (last.actionIdentifier === 'done' && task) {
      updateTask(task.id, { done: true });
    } else if (last.actionIdentifier === 'snooze' && task) {
      snoozeTask(task, '1h');
    } else if (task) {
      router.push({ pathname: '/task', params: { id: task.id } });
    } else if (data.route === '/review') {
      router.push('/review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, ready]);
}
