/**
 * Documents — your Google Drive, organised into a "Hearth" folder with category sub-folders.
 * Files never leave Google: the phone talks to Drive directly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { aiEnabled, claude } from './ai';
import { api, googleToken } from './google';

export type DocCategory = { id: string; label: string; emoji: string; color: string; words: RegExp };

export const DOC_CATEGORIES: DocCategory[] = [
  { id: 'bills', label: 'Bills & receipts', emoji: '🧾', color: '#FFB86B', words: /bill|invoice|receipt|statement|hydro|utility|phone|internet|order/i },
  { id: 'home', label: 'Home & lease', emoji: '🏠', color: '#8B7CFF', words: /lease|rent|mortgage|strata|home|apartment|landlord|insurance.*home|moving/i },
  { id: 'car', label: 'Car', emoji: '🚗', color: '#5AA9FF', words: /car|vehicle|icbc|saaq|registration|licen[cs]e plate|auto|tire|mechanic/i },
  { id: 'health', label: 'Health', emoji: '🩺', color: '#4FD1C5', words: /health|medical|doctor|dental|clinic|prescription|lab|msp|ramq|vaccin/i },
  { id: 'money', label: 'Taxes & finance', emoji: '💼', color: '#5BE49B', words: /tax|t4|t5|noa|cra|rrsp|tfsa|fhsa|bank|investment|pay ?stub|payslip|salary/i },
  { id: 'ids', label: 'IDs & travel', emoji: '🛂', color: '#FF7AD9', words: /passport|visa|permit|pr card|citizenship|id card|driver|birth|marriage|ticket|boarding|itinerary|hotel/i },
  { id: 'work', label: 'Work & study', emoji: '💻', color: '#62E0FF', words: /resume|cv|cover letter|offer|contract|employment|degree|transcript|diploma|certificate/i },
  { id: 'other', label: 'Other', emoji: '📁', color: '#9AA0B5', words: /$^/ },
];
export const docCategory = (id: string) => DOC_CATEGORIES.find((c) => c.id === id) ?? DOC_CATEGORIES[DOC_CATEGORIES.length - 1];

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: Date;
  size: number;
  webViewLink: string;
  parents: string[];
};

const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'files(id,name,mimeType,modifiedTime,size,webViewLink,parents)';
const D = 'https://www.googleapis.com/drive/v3';
const q = (s: string) => encodeURIComponent(s);
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const toFile = (f: any): DriveFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  modifiedTime: new Date(f.modifiedTime),
  size: Number(f.size ?? 0),
  webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  parents: f.parents ?? [],
});

/* ───────── Folder setup ───────── */

const FOLDERS_KEY = 'hearth.drive.folders';
export type Folders = { root: string } & Record<string, string>;
let folders: Folders | null = null;

async function findOrCreateFolder(name: string, parent: string) {
  const found = await api<{ files: { id: string }[] }>(
    `${D}/files?q=${q(`name='${esc(name)}' and mimeType='${FOLDER}' and '${parent}' in parents and trashed=false`)}&fields=files(id)`,
  );
  if (found.files?.[0]) return found.files[0].id;
  const made = await api<{ id: string }>(`${D}/files?fields=id`, {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
  });
  return made.id;
}

/** Creates (once) "My Drive / Hearth / <category>" folders and remembers their ids. */
export async function ensureFolders(): Promise<Folders> {
  if (folders) return folders;
  const cached = await AsyncStorage.getItem(FOLDERS_KEY).catch(() => null);
  if (cached) {
    folders = JSON.parse(cached);
    // make sure the root still exists (could have been deleted in Drive)
    const ok = await api<{ trashed: boolean }>(`${D}/files/${folders!.root}?fields=trashed`).catch(() => null);
    if (ok && !ok.trashed) return folders!;
  }
  const root = await findOrCreateFolder('Hearth', 'root');
  const out: Folders = { root };
  for (const c of DOC_CATEGORIES) out[c.id] = await findOrCreateFolder(`${c.emoji} ${c.label}`, root);
  folders = out;
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(out));
  return out;
}

export const categoryOfFolder = (folderId: string) =>
  folders ? (Object.entries(folders).find(([k, v]) => v === folderId && k !== 'root')?.[0] ?? null) : null;

/* ───────── Listing ───────── */

export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const r = await api<{ files: any[] }>(
    `${D}/files?q=${q(`'${folderId}' in parents and trashed=false and mimeType!='${FOLDER}'`)}&orderBy=modifiedTime desc&pageSize=200&fields=${FIELDS}`,
  );
  return (r.files ?? []).map(toFile);
}

export async function folderCounts(f: Folders): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    DOC_CATEGORIES.map(async (c) => {
      const r = await api<{ files: { id: string }[] }>(
        `${D}/files?q=${q(`'${f[c.id]}' in parents and trashed=false`)}&pageSize=200&fields=files(id)`,
      ).catch(() => ({ files: [] }));
      out[c.id] = r.files?.length ?? 0;
    }),
  );
  return out;
}

/** Your most recent Drive files that are NOT already sorted into a Hearth folder. */
export async function unsortedRecent(f: Folders, max = 15): Promise<DriveFile[]> {
  const sorted = new Set(Object.values(f));
  const r = await api<{ files: any[] }>(
    `${D}/files?q=${q(`trashed=false and mimeType!='${FOLDER}' and 'me' in owners`)}&orderBy=modifiedTime desc&pageSize=40&fields=${FIELDS}`,
  );
  return (r.files ?? [])
    .map(toFile)
    .filter((x) => !x.parents.some((p) => sorted.has(p) && p !== f.root))
    .slice(0, max);
}

export async function searchDrive(text: string): Promise<DriveFile[]> {
  const r = await api<{ files: any[] }>(
    `${D}/files?q=${q(`trashed=false and mimeType!='${FOLDER}' and (name contains '${esc(text)}' or fullText contains '${esc(text)}')`)}&pageSize=30&fields=${FIELDS}`,
  );
  return (r.files ?? []).map(toFile);
}

/* ───────── Changes ───────── */

export async function moveFile(file: DriveFile, toFolder: string) {
  const remove = file.parents.join(',');
  return api(`${D}/files/${file.id}?addParents=${toFolder}${remove ? `&removeParents=${remove}` : ''}&fields=id,parents`, {
    method: 'PATCH',
    body: '{}',
  });
}

export const renameFile = (id: string, name: string) =>
  api(`${D}/files/${id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ name }) });

export const trashFile = (id: string) => api(`${D}/files/${id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });

/** Uploads a photo/PDF/file from the phone into a folder (resumable upload). */
export async function uploadFile(uri: string, name: string, mimeType: string, folderId: string) {
  const token = await googleToken();
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const location = start.headers.get('location') ?? start.headers.get('Location');
  if (!start.ok || !location) throw new Error(`Upload could not start (${start.status})`);
  const blob = await (await fetch(uri)).blob();
  const put = await fetch(location, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: blob });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return (await put.json()) as { id: string };
}

/* ───────── Sorting help ───────── */

export function guessDocCategory(name: string) {
  return (DOC_CATEGORIES.find((c) => c.words.test(name)) ?? DOC_CATEGORIES[DOC_CATEGORIES.length - 1]).id;
}

export type SortSuggestion = { fileId: string; category: string; newName: string | null };

/** Suggests a folder (and a clearer name) for each file — uses Claude when available, else keyword rules. File names only. */
export async function suggestSort(files: DriveFile[]): Promise<SortSuggestion[]> {
  if (aiEnabled() && files.length) {
    try {
      const sys = `You file personal documents. Categories: ${DOC_CATEGORIES.map((c) => `${c.id} (${c.label})`).join(', ')}.
For each file name return ONLY JSON {"files":[{"id":string,"category":string,"newName":string|null}]}.
newName: a clearer name like "2026-11 BC Hydro bill.pdf" keeping the extension, or null if already clear.`;
      const raw = await claude(sys, JSON.stringify(files.map((f) => ({ id: f.id, name: f.name, modified: f.modifiedTime.toISOString().slice(0, 10) }))));
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const valid = new Set(DOC_CATEGORIES.map((c) => c.id));
      return (json.files ?? [])
        .filter((x: any) => files.some((f) => f.id === x.id))
        .map((x: any) => ({ fileId: x.id, category: valid.has(x.category) ? x.category : 'other', newName: x.newName || null }));
    } catch {
      // fall back
    }
  }
  return files.map((f) => ({ fileId: f.id, category: guessDocCategory(f.name), newName: null }));
}

export function fileIcon(mime: string) {
  if (mime.includes('pdf')) return '📕';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('presentation')) return '📽️';
  if (mime.includes('document') || mime.includes('word')) return '📄';
  return '📎';
}

export const fmtSize = (b: number) => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
