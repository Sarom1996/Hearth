import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { emailsToTasks, type EmailDraft } from './ai';
import { isConnected, recentEmails } from './google';
import { getPrefs, setPref } from './prefs';

/**
 * "Inbox assistant": scans recent Gmail and keeps a list of suggested tasks
 * until you add or dismiss them. Lives on this phone only.
 */
type State = { drafts: EmailDraft[]; scanning: boolean; error: string | null; usedAI: boolean; scannedAt: number };

const SEEN_KEY = 'hearth.inbox.seen'; // email ids already turned into tasks or dismissed
const PENDING_KEY = 'hearth.inbox.pending';

let state: State = { drafts: [], scanning: false, error: null, usedAI: false, scannedAt: 0 };
const listeners = new Set<(s: State) => void>();
const emit = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
  if ('drafts' in patch) {
    AsyncStorage.setItem(PENDING_KEY, JSON.stringify(state.drafts)).catch(() => {});
  }
};

let loaded = false;
async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (raw) {
      const drafts = (JSON.parse(raw) as EmailDraft[]).map((d) => ({
        ...d,
        due: d.due ? new Date(d.due) : null,
        remindAt: d.remindAt ? new Date(d.remindAt) : null,
      }));
      emit({ drafts, scannedAt: (await getPrefs()).gmailLastScan });
    }
  } catch {}
}

async function seen(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? '[]'));
  } catch {
    return new Set();
  }
}
export async function markSeen(ids: string[]) {
  const s = await seen();
  ids.forEach((i) => s.add(i));
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-800)));
  emit({ drafts: state.drafts.filter((d) => !ids.includes(d.emailId)) });
}

export async function scanInbox(days = 3, knownEmailIds: string[] = []) {
  if (state.scanning) return;
  emit({ scanning: true, error: null });
  try {
    if (!(await isConnected('gmail'))) throw new Error('Gmail is not connected. Turn it on in Settings → Connections.');
    const skip = await seen();
    knownEmailIds.forEach((i) => skip.add(i));
    const emails = (await recentEmails(days, 40)).filter((e) => !skip.has(e.id));
    const { drafts, usedAI } = await emailsToTasks(emails);
    const keep = state.drafts.filter((d) => !drafts.some((n) => n.emailId === d.emailId) && !skip.has(d.emailId));
    const now = Date.now();
    await setPref('gmailLastScan', now);
    emit({ drafts: [...drafts, ...keep], usedAI, scanning: false, scannedAt: now });
  } catch (e) {
    emit({ scanning: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Scan quietly when the app opens, at most every 6 hours, if you turned that on. */
export async function maybeAutoScan(knownEmailIds: string[]) {
  const p = await getPrefs();
  if (!p.gmailAutoScan || Date.now() - p.gmailLastScan < 6 * 3600000) return;
  await scanInbox(2, knownEmailIds);
}

export function updateDraft(emailId: string, patch: Partial<EmailDraft>) {
  emit({ drafts: state.drafts.map((d) => (d.emailId === emailId ? { ...d, ...patch } : d)) });
}

export function useInbox() {
  const [s, setS] = useState(state);
  useEffect(() => {
    load();
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
