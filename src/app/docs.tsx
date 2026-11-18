import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../components/Backdrop';
import { Glass, Press, T } from '../components/ui';
import { aiEnabled } from '../lib/ai';
import {
  DOC_CATEGORIES,
  docCategory,
  ensureFolders,
  fileIcon,
  fmtSize,
  folderCounts,
  guessDocCategory,
  listFolder,
  moveFile,
  renameFile,
  searchDrive,
  suggestSort,
  trashFile,
  unsortedRecent,
  uploadFile,
  type DriveFile,
  type Folders,
  type SortSuggestion,
} from '../lib/drive';
import { connect, useGoogleConnection } from '../lib/google';
import { colors } from '../lib/theme';

type Pending = { uri: string; name: string; mimeType: string; category: string };

export default function Docs() {
  const insets = useSafeAreaInsets();
  const drive = useGoogleConnection('drive');
  const [folders, setFolders] = useState<Folders | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null); // category id
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [unsorted, setUnsorted] = useState<DriveFile[] | null>(null);
  const [suggest, setSuggest] = useState<SortSuggestion[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DriveFile[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const f = await ensureFolders();
      setFolders(f);
      const [c, u] = await Promise.all([folderCounts(f), unsortedRecent(f)]);
      setCounts(c);
      setUnsorted(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (drive.connected) refresh();
  }, [drive.connected, refresh]);

  useEffect(() => {
    if (!open || !folders) return;
    setFiles(null);
    listFolder(folders[open]).then(setFiles).catch(() => setFiles([]));
  }, [open, folders]);

  /* ───── Upload ───── */
  const pick = async (source: 'camera' | 'photos' | 'files') => {
    try {
      if (source === 'files') {
        const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        setPending({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? 'application/octet-stream', category: guessDocCategory(a.name) });
        return;
      }
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert('Camera is off', 'Allow camera access in iPhone Settings → Hearth.');
      }
      const r =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const stamp = new Date().toISOString().slice(0, 10);
      setPending({ uri: a.uri, name: a.fileName ?? `Scan ${stamp}.jpg`, mimeType: a.mimeType ?? 'image/jpeg', category: open ?? 'other' });
    } catch (e) {
      Alert.alert('Could not open', e instanceof Error ? e.message : String(e));
    }
  };

  const doUpload = async () => {
    if (!pending || !folders) return;
    setBusy('upload');
    try {
      await uploadFile(pending.uri, pending.name.trim() || 'Document', pending.mimeType, folders[pending.category]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPending(null);
      setCounts((c) => ({ ...c, [pending.category]: (c[pending.category] ?? 0) + 1 }));
      if (open === pending.category) listFolder(folders[open]).then(setFiles);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /* ───── File actions ───── */
  const fileMenu = (f: DriveFile) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: f.name, options: ['Cancel', 'Open', 'Move to…', 'Rename', 'Move to trash'], cancelButtonIndex: 0, destructiveButtonIndex: 4 },
      async (i) => {
        if (i === 1) Linking.openURL(f.webViewLink);
        if (i === 2) moveMenu(f);
        if (i === 3)
          Alert.prompt('Rename', undefined, async (name) => {
            if (name?.trim()) {
              await renameFile(f.id, name.trim());
              reloadOpen();
            }
          }, 'plain-text', f.name);
        if (i === 4) {
          await trashFile(f.id);
          reloadOpen();
          refresh();
        }
      },
    );
  };

  const moveMenu = (f: DriveFile) => {
    if (!folders) return;
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Move “${f.name}” to`, options: ['Cancel', ...DOC_CATEGORIES.map((c) => `${c.emoji} ${c.label}`)], cancelButtonIndex: 0 },
      async (i) => {
        if (i <= 0) return;
        await moveFile(f, folders[DOC_CATEGORIES[i - 1].id]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        reloadOpen();
        refresh();
      },
    );
  };

  const reloadOpen = () => {
    if (open && folders) listFolder(folders[open]).then(setFiles);
  };

  const runSmartSort = async () => {
    if (!unsorted?.length) return;
    setBusy('sort');
    setSuggest(await suggestSort(unsorted.slice(0, 12)));
    setBusy(null);
  };

  const applySort = async () => {
    if (!suggest || !folders || !unsorted) return;
    setBusy('apply');
    for (const s of suggest) {
      const f = unsorted.find((x) => x.id === s.fileId);
      if (!f) continue;
      await moveFile(f, folders[s.category]).catch(() => {});
      if (s.newName) await renameFile(f.id, s.newName).catch(() => {});
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSuggest(null);
    setBusy(null);
    refresh();
  };

  const runSearch = async () => {
    if (!query.trim()) return setResults(null);
    setBusy('search');
    setResults(await searchDrive(query.trim()).catch(() => []));
    setBusy(null);
  };

  const cat = open ? docCategory(open) : null;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 80, gap: 14 }}>
        {/* Header */}
        <View style={styles.row}>
          <Press onPress={() => (open ? setOpen(null) : router.back())} style={styles.back}>
            <T size={18}>‹</T>
          </Press>
          <View style={{ flex: 1 }}>
            <T size={30} weight="800" style={{ letterSpacing: -0.8 }}>
              {cat ? `${cat.emoji} ${cat.label}` : 'Documents'}
            </T>
            <T dim size={13}>
              Google Drive › Hearth{cat ? ` › ${cat.label}` : ''}
            </T>
          </View>
        </View>

        {drive.connected === false && (
          <Glass style={{ gap: 10 }}>
            <T size={16} weight="700">
              Connect Google Drive
            </T>
            <T dim size={13}>
              Hearth creates a “Hearth” folder in your Drive with tidy sub-folders (Bills, Health, Car, Taxes…). Your files stay in your own
              Drive.
            </T>
            <Press
              onPress={async () => {
                setBusy('connect');
                await connect('drive').catch(() => {});
                setBusy(null);
                drive.refresh();
              }}
              style={styles.primary}
            >
              {busy === 'connect' ? <ActivityIndicator color="#0B0C14" /> : <T weight="800" style={{ color: '#0B0C14' }}>Connect Drive</T>}
            </Press>
          </Glass>
        )}

        {drive.connected && (
          <>
            {/* Upload */}
            <View style={[styles.row, { gap: 10 }]}>
              <UploadBtn emoji="📷" label="Scan" onPress={() => pick('camera')} />
              <UploadBtn emoji="🖼️" label="Photo" onPress={() => pick('photos')} />
              <UploadBtn emoji="📄" label="File" onPress={() => pick('files')} />
            </View>

            {pending && (
              <Animated.View entering={FadeInDown}>
                <Glass style={{ gap: 10 }}>
                  <T faint size={12} weight="800" style={{ letterSpacing: 1.5 }}>
                    UPLOAD
                  </T>
                  <TextInput value={pending.name} onChangeText={(name) => setPending({ ...pending, name })} style={styles.input} />
                  <View style={styles.chips}>
                    {DOC_CATEGORIES.map((c) => {
                      const on = c.id === pending.category;
                      return (
                        <Press key={c.id} onPress={() => setPending({ ...pending, category: c.id })} style={[styles.chip, on && { backgroundColor: c.color + '33', borderColor: c.color }]}>
                          <T size={12} weight={on ? '800' : '500'} dim={!on}>
                            {c.emoji} {c.label}
                          </T>
                        </Press>
                      );
                    })}
                  </View>
                  <View style={styles.row}>
                    <Press onPress={() => setPending(null)} style={[styles.btn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                      <T dim>Cancel</T>
                    </Press>
                    <Press onPress={doUpload} style={[styles.btn, { flex: 1, backgroundColor: colors.accent }]}>
                      {busy === 'upload' ? <ActivityIndicator color={colors.text} /> : <T weight="800">Upload to Drive</T>}
                    </Press>
                  </View>
                </Glass>
              </Animated.View>
            )}

            {/* Search */}
            {!open && (
              <View style={[styles.row, styles.search]}>
                <T faint>🔍</T>
                <TextInput
                  value={query}
                  onChangeText={(v) => {
                    setQuery(v);
                    if (!v) setResults(null);
                  }}
                  onSubmitEditing={runSearch}
                  returnKeyType="search"
                  placeholder="Search all of Drive (names and text)"
                  placeholderTextColor={colors.textFaint}
                  style={{ flex: 1, color: colors.text, fontSize: 15 }}
                />
                {busy === 'search' && <ActivityIndicator color={colors.textDim} />}
              </View>
            )}

            {error && (
              <T size={13} style={{ color: colors.danger }}>
                {error}
              </T>
            )}

            {results && (
              <FileList title={`${results.length} result${results.length === 1 ? '' : 's'}`} files={results} onPress={(f) => Linking.openURL(f.webViewLink)} onLong={fileMenu} />
            )}

            {/* Folder grid */}
            {!open && !results && (
              <View style={styles.grid}>
                {DOC_CATEGORIES.map((c, i) => (
                  <Animated.View key={c.id} entering={FadeIn.delay(i * 40)} style={{ width: '48.5%' }}>
                    <Press onPress={() => setOpen(c.id)} style={[styles.folder, { borderColor: c.color + '55' }]}>
                      <T size={30}>{c.emoji}</T>
                      <T size={15} weight="700" style={{ marginTop: 8 }}>
                        {c.label}
                      </T>
                      <T faint size={12}>
                        {folders ? `${counts[c.id] ?? 0} file${counts[c.id] === 1 ? '' : 's'}` : '…'}
                      </T>
                    </Press>
                  </Animated.View>
                ))}
              </View>
            )}

            {/* Inside a folder */}
            {open &&
              (files === null ? (
                <ActivityIndicator color={colors.textDim} style={{ marginTop: 30 }} />
              ) : files.length === 0 ? (
                <T dim style={{ textAlign: 'center', marginTop: 30 }}>
                  Empty — use Scan, Photo or File above to add something here.
                </T>
              ) : (
                <FileList files={files} onPress={(f) => Linking.openURL(f.webViewLink)} onLong={fileMenu} />
              ))}

            {/* Unsorted / smart sort */}
            {!open && !results && unsorted && unsorted.length > 0 && (
              <Glass style={{ gap: 10 }}>
                <View style={styles.row}>
                  <T size={17} weight="700" style={{ flex: 1 }}>
                    📥 Recent, not sorted
                  </T>
                  {!suggest && (
                    <Press onPress={runSmartSort} style={[styles.pill, { backgroundColor: colors.accent }]}>
                      {busy === 'sort' ? <ActivityIndicator color={colors.text} size="small" /> : <T size={13} weight="800">✨ Sort for me</T>}
                    </Press>
                  )}
                </View>
                {unsorted.slice(0, suggest ? 12 : 6).map((f) => {
                  const s = suggest?.find((x) => x.fileId === f.id);
                  const c = s ? docCategory(s.category) : null;
                  return (
                    <Animated.View key={f.id} layout={LinearTransition}>
                      <Press haptic="none" onPress={() => (s ? cycleSuggestion(f.id) : moveMenu(f))} style={styles.fileRow}>
                        <T size={20}>{fileIcon(f.mimeType)}</T>
                        <View style={{ flex: 1 }}>
                          <T size={14} weight="600" numberOfLines={1}>
                            {s?.newName ?? f.name}
                          </T>
                          {c ? (
                            <T size={12} style={{ color: c.color }}>
                              → {c.emoji} {c.label} (tap to change)
                            </T>
                          ) : (
                            <T faint size={12}>
                              {f.modifiedTime.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} · tap to file
                            </T>
                          )}
                        </View>
                      </Press>
                    </Animated.View>
                  );
                })}
                {suggest && (
                  <View style={styles.row}>
                    <Press onPress={() => setSuggest(null)} style={[styles.btn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                      <T dim>Cancel</T>
                    </Press>
                    <Press onPress={applySort} style={[styles.btn, { flex: 1, backgroundColor: colors.accent }]}>
                      {busy === 'apply' ? <ActivityIndicator color={colors.text} /> : <T weight="800">Move {suggest.length} files</T>}
                    </Press>
                  </View>
                )}
                <T faint size={11}>
                  {aiEnabled() ? 'Claude sees file names only, never contents.' : 'Sorted by file name keywords. Add a Claude key in Settings for smarter names.'}
                </T>
              </Glass>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  function cycleSuggestion(fileId: string) {
    Haptics.selectionAsync();
    setSuggest((ss) =>
      ss!.map((s) => {
        if (s.fileId !== fileId) return s;
        const i = DOC_CATEGORIES.findIndex((c) => c.id === s.category);
        return { ...s, category: DOC_CATEGORIES[(i + 1) % DOC_CATEGORIES.length].id };
      }),
    );
  }
}

function UploadBtn({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.upload}>
      <T size={24}>{emoji}</T>
      <T size={12} weight="700" dim style={{ marginTop: 4 }}>
        {label}
      </T>
    </Press>
  );
}

function FileList({ files, title, onPress, onLong }: { files: DriveFile[]; title?: string; onPress: (f: DriveFile) => void; onLong: (f: DriveFile) => void }) {
  return (
    <Glass style={{ padding: 6 }}>
      {title && (
        <T faint size={12} weight="800" style={{ letterSpacing: 1.5, padding: 10 }}>
          {title.toUpperCase()}
        </T>
      )}
      {files.map((f, i) => (
        <Press key={f.id} haptic="none" onPress={() => onPress(f)} onLongPress={() => onLong(f)} style={[styles.fileRow, i > 0 && styles.sep]}>
          <T size={22}>{fileIcon(f.mimeType)}</T>
          <View style={{ flex: 1 }}>
            <T size={15} weight="600" numberOfLines={1}>
              {f.name}
            </T>
            <T faint size={12}>
              {f.modifiedTime.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
              {f.size ? ` · ${fmtSize(f.size)}` : ''}
            </T>
          </View>
          <Press onPress={() => onLong(f)} style={{ padding: 6 }}>
            <T dim size={18}>
              ⋯
            </T>
          </Press>
        </Press>
      ))}
    </Glass>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  primary: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  upload: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  search: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  folder: { padding: 16, borderRadius: 22, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.05)', minHeight: 118 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  input: { color: colors.text, fontSize: 15, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btn: { height: 48, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
});
