/**
 * Your own Google data, read directly from this iPhone with your permission.
 * Nothing passes through any server of ours — the phone talks to Google directly.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useCallback, useEffect, useState } from 'react';

export const SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  drive: 'https://www.googleapis.com/auth/drive',
} as const;
export type Service = keyof typeof SCOPES;

async function ensureUser() {
  let u = GoogleSignin.getCurrentUser();
  if (!u) {
    const res = await GoogleSignin.signInSilently();
    u = res.type === 'success' ? res.data : null;
  }
  return u;
}

export async function googleToken() {
  await ensureUser();
  return (await GoogleSignin.getTokens()).accessToken;
}

export async function isConnected(service: Service) {
  const u = await ensureUser().catch(() => null);
  return !!u?.scopes?.includes(SCOPES[service]);
}

/** Shows Google's own permission screen for this service. */
export async function connect(service: Service) {
  if (!(await ensureUser().catch(() => null))) await GoogleSignin.signIn();
  const res = await GoogleSignin.addScopes({ scopes: [SCOPES[service]] });
  return !!res && res.type === 'success' && !!res.data.scopes?.includes(SCOPES[service]);
}

/** Removes ALL extra Google permissions from Hearth (you stay signed in to the app). */
export async function disconnectAll() {
  await GoogleSignin.revokeAccess().catch(() => {});
}

export function useGoogleConnection(service: Service) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const refresh = useCallback(() => {
    isConnected(service).then(setConnected).catch(() => setConnected(false));
  }, [service]);
  useEffect(refresh, [refresh]);
  return { connected, refresh };
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  await ensureUser();
  const { accessToken } = await GoogleSignin.getTokens();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Google access expired or was removed — reconnect in Settings.');
  if (!res.ok) throw new Error(`Google error ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ───────── Gmail ───────── */

export type EmailSummary = { id: string; from: string; subject: string; date: Date; snippet: string };

/**
 * Recent personal emails (skips promotions & social tabs, chats and sent mail).
 * Reads only sender, subject, date and Google's short preview — never attachments.
 */
export async function recentEmails(days = 3, max = 30): Promise<EmailSummary[]> {
  const q = encodeURIComponent(`newer_than:${days}d -category:promotions -category:social -in:chats -in:sent`);
  const list = await api<{ messages?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: EmailSummary[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const chunk = await Promise.all(
      ids.slice(i, i + 6).map((id) =>
        api<{ id: string; snippet: string; internalDate: string; payload: { headers: { name: string; value: string }[] } }>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        ).catch(() => null),
      ),
    );
    for (const m of chunk) {
      if (!m) continue;
      const h = (n: string) => m.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? '';
      out.push({
        id: m.id,
        from: h('from').replace(/<.*>/, '').replace(/"/g, '').trim() || h('from'),
        subject: h('subject'),
        date: new Date(Number(m.internalDate)),
        snippet: decodeEntities(m.snippet ?? ''),
      });
    }
  }
  return out;
}

const decodeEntities = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export const gmailLink = (id: string) => `googlegmail:///cv=${id}`;

/* ───────── Google Calendar ───────── */

export type CalEvent = { id: string; title: string; start: Date; end: Date; allDay: boolean; location: string };

export async function calendarEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const p = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const res = await api<{ items?: any[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
  return (res.items ?? [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const allDay = !!e.start?.date;
      return {
        id: e.id,
        title: e.summary ?? '(no title)',
        start: new Date(allDay ? `${e.start.date}T00:00:00` : e.start.dateTime),
        end: new Date(allDay ? `${e.end.date}T00:00:00` : e.end.dateTime),
        allDay,
        location: e.location ?? '',
      };
    });
}

/** Puts a task into your Google Calendar (30-min block, or all-day). */
export async function addToCalendar(t: { title: string; notes: string; due: Date; dueHasTime: boolean }) {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const body = t.dueHasTime
    ? { start: { dateTime: t.due.toISOString() }, end: { dateTime: new Date(t.due.getTime() + 30 * 60000).toISOString() } }
    : { start: { date: ymd(t.due) }, end: { date: ymd(new Date(t.due.getTime() + 86400000)) } };
  return api<{ id: string; htmlLink: string }>('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({ summary: t.title, description: `${t.notes ? t.notes + '\n\n' : ''}Added from Hearth`, ...body }),
  });
}

export function useTodayAgenda(enabled: boolean) {
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      if (!(await isConnected('calendar'))) return;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 2 * 86400000); // today + tomorrow
      const ev = await calendarEvents(start, end);
      if (alive) setEvents(ev);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return events;
}
