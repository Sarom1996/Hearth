import { CURRENCY, LOCALE } from './config';

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });
const moneyRound = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

/** Amounts are stored as integer cents to avoid floating-point drift. */
export const fmt = (cents: number) => money.format(cents / 100);
export const fmtRound = (cents: number) => moneyRound.format(Math.round(cents / 100));

export type Period = 'day' | 'week' | 'month';

export function periodRange(period: Period, offset = 0, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'day') {
    start.setDate(start.getDate() + offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (period === 'week') {
    // Weeks start on Monday.
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  start.setDate(1);
  start.setMonth(start.getMonth() + offset);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export function periodLabel(period: Period, offset: number) {
  const { start, end } = periodRange(period, offset);
  if (period === 'day') {
    if (offset === 0) return 'Today';
    if (offset === -1) return 'Yesterday';
    return start.toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (period === 'week') {
    if (offset === 0) return 'This week';
    if (offset === -1) return 'Last week';
    const last = new Date(end.getTime() - 1);
    const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString(LOCALE, o)} – ${last.toLocaleDateString(LOCALE, o)}`;
  }
  if (offset === 0) return 'This month';
  return start.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

export function dayHeading(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - x.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(LOCALE, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
