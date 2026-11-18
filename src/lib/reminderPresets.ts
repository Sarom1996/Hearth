export type ReminderPreset = 'none' | 'at' | '15m' | '1h' | '1d' | 'morning';
export const REMINDER_PRESETS: { key: ReminderPreset; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'at', label: 'At due time' },
  { key: '15m', label: '15 min before' },
  { key: '1h', label: '1 hour before' },
  { key: '1d', label: '1 day before' },
  { key: 'morning', label: 'Morning of (8 am)' },
];

export function reminderFromPreset(due: Date | null, preset: ReminderPreset, dueHasTime: boolean): Date | null {
  if (!due || preset === 'none') return null;
  const d = new Date(due);
  if (!dueHasTime && preset !== '1d') {
    d.setHours(8, 0, 0, 0); // all-day items remind at 8 am
    return d;
  }
  switch (preset) {
    case 'at':
      return d;
    case '15m':
      return new Date(d.getTime() - 15 * 60000);
    case '1h':
      return new Date(d.getTime() - 3600000);
    case '1d': {
      const x = new Date(d.getTime() - 86400000);
      if (!dueHasTime) x.setHours(18, 0, 0, 0);
      return x;
    }
    case 'morning':
      d.setHours(8, 0, 0, 0);
      return d;
  }
}
