import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Press, Segments, T } from '../components/ui';
import { aiEnabled } from '../lib/ai';
import { useAuth } from '../lib/auth';
import { connect, gmailLink, useGoogleConnection } from '../lib/google';
import { markSeen, scanInbox, updateDraft, useInbox } from '../lib/inbox';
import { addTask, QUADRANTS, quadrantById, quadrantOf, useTasks } from '../lib/tasks';
import { colors } from '../lib/theme';

type Range = '1' | '3' | '7';

export default function Inbox() {
  const { user } = useAuth();
  const gmail = useGoogleConnection('gmail');
  const inbox = useInbox();
  const tasks = useTasks();
  const [range, setRange] = useState<Range>('3');
  const [connecting, setConnecting] = useState(false);
  const known = useMemo(() => (tasks ?? []).map((t) => t.sourceEmailId).filter(Boolean), [tasks]);

  const cycle = (emailId: string) => {
    const d = inbox.drafts.find((x) => x.emailId === emailId);
    if (!d) return;
    const i = QUADRANTS.findIndex((q) => q.id === quadrantOf(d));
    const n = QUADRANTS[(i + 1) % 4];
    Haptics.selectionAsync();
    updateDraft(emailId, { urgent: n.urgent, important: n.important });
  };

  const add = async (ids: string[]) => {
    if (!user) return;
    const picked = inbox.drafts.filter((d) => ids.includes(d.emailId));
    await Promise.all(
      picked.map((d) =>
        addTask({
          title: d.title,
          notes: d.notes,
          urgent: d.urgent,
          important: d.important,
          due: d.due,
          dueHasTime: d.dueHasTime,
          remindAt: d.remindAt,
          owner: user.uid,
          delegatedTo: d.delegatedTo,
          effort: d.effort,
          createdBy: user.uid,
          sourceEmailId: d.emailId,
        }),
      ),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await markSeen(ids);
  };

  const last = inbox.scannedAt
    ? new Date(inbox.scannedAt).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : 'never';

  return (
    <ScrollView style={{ backgroundColor: colors.bg2 }} contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 14, paddingBottom: 60 }}>
      <View>
        <T size={28} weight="800" style={{ letterSpacing: -0.6 }}>
          📬 Inbox assistant
        </T>
        <T dim size={14} style={{ marginTop: 4 }}>
          Finds bills, appointments, deadlines and replies in your recent Gmail and turns them into tasks with reminders. You approve
          each one.
        </T>
      </View>

      {gmail.connected === false && (
        <View style={styles.card}>
          <T size={15} weight="700">
            Connect Gmail first
          </T>
          <T dim size={13}>
            Google will ask you to allow Hearth to read your email (read-only). Hearth never sends, deletes or changes anything.
          </T>
          <Press
            onPress={async () => {
              setConnecting(true);
              await connect('gmail').catch(() => {});
              setConnecting(false);
              gmail.refresh();
            }}
            style={styles.primary}
          >
            {connecting ? <ActivityIndicator color="#0B0C14" /> : <T weight="800" style={{ color: '#0B0C14' }}>Connect Gmail</T>}
          </Press>
        </View>
      )}

      {gmail.connected && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Segments<Range>
              value={range}
              onChange={setRange}
              options={[
                { key: '1', label: 'Today' },
                { key: '3', label: '3 days' },
                { key: '7', label: 'Week' },
              ]}
            />
          </View>
          <Press haptic="medium" onPress={() => scanInbox(Number(range), known)} disabled={inbox.scanning} style={styles.primary}>
            {inbox.scanning ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <ActivityIndicator color="#0B0C14" />
                <T weight="800" style={{ color: '#0B0C14' }}>
                  Reading your inbox…
                </T>
              </View>
            ) : (
              <T weight="800" style={{ color: '#0B0C14' }}>
                Scan my email
              </T>
            )}
          </Press>
          <T faint size={12}>
            Last scan: {last} · {aiEnabled() ? 'Claude reads sender, subject and preview only' : 'On-device rules (add a Claude key in Settings for smarter results)'}
          </T>
        </>
      )}

      {inbox.error && (
        <T size={13} style={{ color: colors.danger }}>
          {inbox.error}
        </T>
      )}

      {inbox.drafts.length > 0 && (
        <Animated.View layout={LinearTransition} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T faint size={12} weight="800" style={{ letterSpacing: 1.5, flex: 1 }}>
              {inbox.drafts.length} SUGGESTION{inbox.drafts.length === 1 ? '' : 'S'}
            </T>
            <Press onPress={() => add(inbox.drafts.map((d) => d.emailId))} style={styles.pill}>
              <T size={13} weight="700">
                Add all
              </T>
            </Press>
          </View>
          {inbox.drafts.map((d, i) => {
            const q = quadrantById(quadrantOf(d));
            return (
              <Animated.View key={d.emailId} entering={FadeInDown.delay(i * 50)} exiting={FadeOut} layout={LinearTransition} style={[styles.draft, { borderColor: q.color + '66' }]}>
                <T size={16} weight="700">
                  {d.title}
                </T>
                <Press haptic="none" onPress={() => Linking.openURL(gmailLink(d.emailId)).catch(() => {})}>
                  <T size={12} dim numberOfLines={2}>
                    ✉️ {d.from} — {d.subject}
                  </T>
                </Press>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {d.due && (
                    <T size={12} dim>
                      📅 {d.due.toLocaleString('en-CA', d.dueHasTime ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric' })}
                    </T>
                  )}
                  {d.remindAt && d.remindAt.getTime() > Date.now() && (
                    <T size={12} dim>
                      🔔 {d.remindAt.toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                    </T>
                  )}
                </View>
                {!!d.why && (
                  <T size={12} faint>
                    {d.why}
                  </T>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Press onPress={() => cycle(d.emailId)} style={[styles.qChip, { backgroundColor: q.glow }]}>
                    <T size={12} weight="800" style={{ color: q.color }}>
                      {q.title} ⇄
                    </T>
                  </Press>
                  <View style={{ flex: 1 }} />
                  <Press onPress={() => markSeen([d.emailId])} style={styles.pill}>
                    <T size={13} dim>
                      Ignore
                    </T>
                  </Press>
                  <Press onPress={() => add([d.emailId])} style={[styles.pill, { backgroundColor: colors.accent }]}>
                    <T size={13} weight="700">
                      Add
                    </T>
                  </Press>
                </View>
              </Animated.View>
            );
          })}
        </Animated.View>
      )}

      {gmail.connected && !inbox.scanning && inbox.scannedAt > 0 && inbox.drafts.length === 0 && !inbox.error && (
        <T dim style={{ textAlign: 'center', marginTop: 10 }}>
          Nothing needs your action right now. ✨
        </T>
      )}

      <Press onPress={() => router.back()} style={{ alignItems: 'center', padding: 10 }}>
        <T dim>Done</T>
      </Press>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', gap: 10 },
  primary: { height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  draft: { padding: 14, borderRadius: 20, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.04)', gap: 8 },
  qChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
});
