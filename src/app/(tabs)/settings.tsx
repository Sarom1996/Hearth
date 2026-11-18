import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../../components/Backdrop';
import { Press, T } from '../../components/ui';
import { aiEnabled, claude } from '../../lib/ai';
import { useAuth } from '../../lib/auth';
import { saveBudget, useBudget, useMembers } from '../../lib/db';
import { connect, disconnectAll, useGoogleConnection, type Service } from '../../lib/google';
import { useInbox } from '../../lib/inbox';
import { getAiKeySync, saveAiKey, setPref, usePrefs } from '../../lib/prefs';
import { ensureNotificationPermission } from '../../lib/reminders';
import { colors } from '../../lib/theme';

const APPLE_PAY_URL = 'hearth://add-expense?amount=[Amount]&merchant=[Merchant]&card=[Card]';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const members = useMembers();
  const budget = useBudget();
  const prefs = usePrefs();
  const inbox = useInbox();
  const gmail = useGoogleConnection('gmail');
  const cal = useGoogleConnection('calendar');
  const drive = useGoogleConnection('drive');

  const [budgetText, setBudgetText] = useState('');
  useEffect(() => setBudgetText(String(Math.round(budget / 100))), [budget]);

  const [keyText, setKeyText] = useState('');
  const [hasKey, setHasKey] = useState(aiEnabled());
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState<Service | null>(null);

  const doConnect = async (s: Service, refresh: () => void) => {
    setBusy(s);
    try {
      const ok = await connect(s);
      if (!ok) Alert.alert('Not connected', 'Google permission was not granted.');
    } catch (e) {
      Alert.alert('Could not connect', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const saveKey = async () => {
    if (!keyText.trim().startsWith('sk-')) {
      Alert.alert('That doesn’t look like a Claude API key', 'Keys start with “sk-ant-”.');
      return;
    }
    await saveAiKey(keyText);
    setKeyText('');
    setHasKey(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const testKey = async () => {
    setTesting(true);
    try {
      const r = await claude('Reply with exactly: OK', 'ping');
      Alert.alert('Claude is connected ✅', r.trim().slice(0, 60));
    } catch (e) {
      Alert.alert('Claude test failed', e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const lastScan = prefs.gmailLastScan
    ? new Date(prefs.gmailLastScan).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : 'never';

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140, gap: 16 }}
      >
        <T size={32} weight="800" style={{ letterSpacing: -0.8 }}>
          Settings
        </T>

        {/* Account */}
        <Section>
          <View style={styles.row}>
            {user?.photoURL ? <Image source={{ uri: user.photoURL }} style={styles.avatar} /> : <View style={[styles.avatar, { backgroundColor: colors.accent }]} />}
            <View style={{ flex: 1 }}>
              <T size={17} weight="700">
                {user?.displayName}
              </T>
              <T dim size={13}>
                {user?.email}
              </T>
            </View>
          </View>
        </Section>

        {/* Connections */}
        <Label>Connections</Label>
        <Section>
          <Service_
            icon="📧"
            title="Gmail"
            subtitle={gmail.connected ? `Read-only · last scan ${lastScan}` : 'Turn emails into tasks & reminders'}
            connected={gmail.connected}
            busy={busy === 'gmail'}
            onConnect={() => doConnect('gmail', gmail.refresh)}
          />
          {gmail.connected && (
            <>
              <Toggle label="Scan automatically" hint="When you open Hearth, at most every 6 hours" value={prefs.gmailAutoScan} onChange={(v) => setPref('gmailAutoScan', v)} />
              <Press onPress={() => router.push('/inbox')} style={styles.linkRow}>
                <T size={15}>📬 Open inbox assistant</T>
                <T dim size={13}>
                  {inbox.drafts.length ? `${inbox.drafts.length} waiting ›` : '›'}
                </T>
              </Press>
            </>
          )}
          <Divider />
          <Service_
            icon="📅"
            title="Google Calendar"
            subtitle={cal.connected ? 'Agenda on Home · add tasks to calendar' : 'See your agenda, send tasks to calendar'}
            connected={cal.connected}
            busy={busy === 'calendar'}
            onConnect={() => doConnect('calendar', cal.refresh)}
          />
          {cal.connected && (
            <>
              <Toggle label="Show today’s agenda on Home" value={prefs.calendarAgenda} onChange={(v) => setPref('calendarAgenda', v)} />
              <Toggle label="Add timed tasks to my calendar" hint="When you save a task with a time" value={prefs.calendarAddTasks} onChange={(v) => setPref('calendarAddTasks', v)} />
            </>
          )}
          <Divider />
          <Service_
            icon="🗂️"
            title="Google Drive"
            subtitle={drive.connected ? 'Documents page · Hearth folder in your Drive' : 'Upload, find and sort your documents'}
            connected={drive.connected}
            busy={busy === 'drive'}
            onConnect={() => doConnect('drive', drive.refresh)}
          />
          {drive.connected && (
            <Press onPress={() => router.push('/docs')} style={styles.linkRow}>
              <T size={15}>🗂️ Open documents</T>
              <T dim>›</T>
            </Press>
          )}
          {(gmail.connected || cal.connected || drive.connected) && (
            <Press
              onPress={() =>
                Alert.alert('Remove Google access?', 'Hearth will no longer access Gmail, Calendar or Drive. You can reconnect anytime.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                      await disconnectAll();
                      gmail.refresh();
                      cal.refresh();
                      drive.refresh();
                    },
                  },
                ])
              }
              style={{ paddingTop: 4 }}
            >
              <T size={13} style={{ color: colors.danger }}>
                Remove Google access
              </T>
            </Press>
          )}
        </Section>

        {/* AI */}
        <Label>Claude AI</Label>
        <Section>
          <T dim size={13}>
            {hasKey
              ? 'Connected. Used for “Ask Hearth”, the inbox assistant and matrix re-sorting. Your key is stored in this iPhone’s Keychain.'
              : 'Optional. Makes voice input, email reading and sorting much smarter. Get a key at console.anthropic.com → API keys.'}
          </T>
          {!hasKey ? (
            <View style={styles.row}>
              <TextInput
                value={keyText}
                onChangeText={setKeyText}
                placeholder="sk-ant-…"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { flex: 1 }]}
              />
              <Press onPress={saveKey} style={styles.btn}>
                <T size={14} weight="700" style={{ color: '#0B0C14' }}>
                  Save
                </T>
              </Press>
            </View>
          ) : (
            <View style={styles.row}>
              <Press onPress={testKey} style={[styles.btn, { flex: 1 }]}>
                {testing ? <ActivityIndicator color="#0B0C14" /> : <T size={14} weight="700" style={{ color: '#0B0C14' }}>Test connection</T>}
              </Press>
              <Press
                onPress={async () => {
                  await saveAiKey(null);
                  setHasKey(!!getAiKeySync() || aiEnabled());
                }}
                style={[styles.btn, { backgroundColor: 'rgba(255,107,139,0.15)' }]}
              >
                <T size={14} weight="700" style={{ color: colors.danger }}>
                  Remove key
                </T>
              </Press>
            </View>
          )}
        </Section>

        {/* Apple Pay */}
        <Label>Apple Pay auto-capture</Label>
        <Section>
          <T dim size={13}>
            Log every Apple Pay tap as an expense. In the Shortcuts app: Automation → + → Transaction (Wallet) → your cards → Run
            Immediately → add “Open URL” with this address, replacing the [brackets] with Shortcut Input → Amount / Merchant / Card.
          </T>
          <Press
            onPress={async () => {
              await Clipboard.setStringAsync(APPLE_PAY_URL);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
            style={styles.codeBox}
          >
            <T size={12} style={{ fontFamily: 'Menlo' }}>
              {APPLE_PAY_URL}
            </T>
            <T size={11} faint style={{ marginTop: 6 }}>
              Tap to copy
            </T>
          </Press>
        </Section>

        {/* Money */}
        <Label>Money</Label>
        <Section>
          <T dim size={13}>
            Monthly budget (CAD), shared by both of you
          </T>
          <View style={styles.row}>
            <TextInput value={budgetText} onChangeText={setBudgetText} keyboardType="number-pad" style={[styles.input, { flex: 1, fontSize: 20, fontWeight: '700' }]} />
            <Press
              onPress={() => {
                const n = parseInt(budgetText, 10);
                if (n > 0) {
                  saveBudget(n * 100);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              }}
              style={styles.btn}
            >
              <T size={14} weight="700" style={{ color: '#0B0C14' }}>
                Save
              </T>
            </Press>
          </View>
        </Section>

        {/* Notifications */}
        <Label>Notifications</Label>
        <Section>
          <Toggle label="Daily nudges" hint="8 am focus digest · 8 pm check-in" value={prefs.nudges} onChange={(v) => setPref('nudges', v)} />
          <Press
            onPress={async () => {
              if (!(await ensureNotificationPermission())) {
                Alert.alert('Notifications are off', 'Turn them on in iPhone Settings → Hearth → Notifications.');
                return;
              }
              await Notifications.scheduleNotificationAsync({
                content: { title: '🔥 Hearth', body: 'Notifications are working.', sound: true },
                trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
              });
            }}
            style={styles.linkRow}
          >
            <T size={15}>Send a test notification</T>
            <T dim>›</T>
          </Press>
        </Section>

        {/* Household */}
        <Label>Household</Label>
        <Section>
          {members.map((m) => (
            <View key={m.uid} style={styles.row}>
              {m.photo ? <Image source={{ uri: m.photo }} style={styles.small} /> : <View style={[styles.small, { backgroundColor: colors.accent2 }]} />}
              <View style={{ flex: 1 }}>
                <T size={15} weight="600">
                  {m.name}
                  {m.uid === user?.uid ? ' (you)' : ''}
                </T>
                <T faint size={12}>
                  {m.email}
                </T>
              </View>
            </View>
          ))}
        </Section>

        {/* Privacy */}
        <Label>Privacy</Label>
        <Section>
          <T dim size={13}>
            • Your data lives in your own Firebase project, readable only by your two Google accounts.{'\n'}• Gmail and Calendar are read
            directly by this iPhone; nothing is copied anywhere except the tasks you approve.{'\n'}• Voice is transcribed on the iPhone.
            {'\n'}• Claude (if you add a key) only receives the text you dictate, email senders/subjects/previews, and task titles — never
            your money data.
          </T>
        </Section>

        <Press
          onPress={() =>
            Alert.alert('Sign out?', '', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
            ])
          }
          style={[styles.btn, { backgroundColor: 'rgba(255,107,139,0.15)', height: 52 }]}
        >
          <T weight="700" style={{ color: colors.danger }}>
            Sign out
          </T>
        </Press>
        <T faint size={12} style={{ textAlign: 'center' }}>
          Hearth {Constants.expoConfig?.version ?? ''}
        </T>
      </ScrollView>
    </View>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <T faint size={12} weight="800" style={{ letterSpacing: 1.5, marginBottom: -8, marginLeft: 4 }}>
      {String(children).toUpperCase()}
    </T>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 }} />;
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <T size={15}>{label}</T>
        {!!hint && (
          <T faint size={12}>
            {hint}
          </T>
        )}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent }} />
    </View>
  );
}

function Service_({
  icon,
  title,
  subtitle,
  connected,
  busy,
  onConnect,
}: {
  icon: string;
  title: string;
  subtitle: string;
  connected: boolean | null;
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <View style={styles.row}>
      <T size={24}>{icon}</T>
      <View style={{ flex: 1 }}>
        <T size={16} weight="700">
          {title}
        </T>
        <T faint size={12}>
          {subtitle}
        </T>
      </View>
      {connected === null ? (
        <ActivityIndicator color={colors.textDim} />
      ) : connected ? (
        <View style={[styles.badge, { backgroundColor: 'rgba(91,228,155,0.15)' }]}>
          <T size={12} weight="800" style={{ color: colors.good }}>
            ✓ On
          </T>
        </View>
      ) : (
        <Press onPress={onConnect} style={[styles.badge, { backgroundColor: colors.accent }]}>
          {busy ? <ActivityIndicator color={colors.text} size="small" /> : <T size={13} weight="800">Connect</T>}
        </Press>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  small: { width: 36, height: 36, borderRadius: 18 },
  input: { color: colors.text, fontSize: 15, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  btn: { paddingHorizontal: 18, height: 46, borderRadius: 14, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, minWidth: 64, alignItems: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  codeBox: { padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.35)' },
});
