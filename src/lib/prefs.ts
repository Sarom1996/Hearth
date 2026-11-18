import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

/**
 * Per-phone settings (each of you can choose differently).
 * Shared household settings (like the budget) live in Firestore instead.
 */
export type Prefs = {
  nudges: boolean; // 8 am / 8 pm digests
  gmailAutoScan: boolean; // scan Gmail when the app opens (max every 6 h)
  gmailLastScan: number; // epoch ms
  calendarAgenda: boolean; // show today's calendar on Home
  calendarAddTasks: boolean; // put timed tasks into Google Calendar
};

const DEFAULTS: Prefs = {
  nudges: true,
  gmailAutoScan: false,
  gmailLastScan: 0,
  calendarAgenda: true,
  calendarAddTasks: false,
};

const KEY = 'hearth.prefs.v1';
let cache: Prefs | null = null;
const listeners = new Set<(p: Prefs) => void>();

export async function getPrefs(): Promise<Prefs> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    cache = { ...DEFAULTS };
  }
  // migrate the earlier stand-alone nudge switch
  const old = await AsyncStorage.getItem('hearth.nudges').catch(() => null);
  if (old === 'off') cache!.nudges = false;
  return cache!;
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  const next = { ...(await getPrefs()), [key]: value };
  cache = next;
  listeners.forEach((l) => l(next));
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(cache ?? DEFAULTS);
  useEffect(() => {
    getPrefs().then(setPrefs);
    listeners.add(setPrefs);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);
  return prefs;
}

/* ───────── Claude API key — kept in the iPhone Keychain, never in the code ───────── */

const AI_KEY = 'hearth.anthropicKey';
let aiKeyCache: string | null = null;

export async function loadAiKey() {
  aiKeyCache = (await SecureStore.getItemAsync(AI_KEY).catch(() => null)) ?? null;
  return aiKeyCache;
}
export const getAiKeySync = () => aiKeyCache;
export async function saveAiKey(key: string | null) {
  if (key) await SecureStore.setItemAsync(AI_KEY, key.trim());
  else await SecureStore.deleteItemAsync(AI_KEY);
  aiKeyCache = key ? key.trim() : null;
}
