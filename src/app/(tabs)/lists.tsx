import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../../components/Backdrop';
import { Glass, Press, Segments, T } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { addItem, clearDone, deleteItem, toggleItem, useListItems, useMembers, type ListItem } from '../../lib/db';
import { colors } from '../../lib/theme';

export default function Lists() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const members = useMembers();
  const items = useListItems();
  const [list, setList] = useState<string>('home');
  const [text, setText] = useState('');

  const options = [
    { key: 'home', label: '🏠 Home' },
    ...members.map((m) => ({ key: m.uid, label: m.uid === user?.uid ? '🙋 Mine' : `💛 ${m.firstName}` })),
  ];

  const { open, done } = useMemo(() => {
    const mine = (items ?? []).filter((i) => i.list === list);
    return { open: mine.filter((i) => !i.done), done: mine.filter((i) => i.done) };
  }, [items, list]);

  const counts = (key: string) => (items ?? []).filter((i) => i.list === key && !i.done).length;

  const submit = () => {
    const parts = text.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length || !user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    parts.forEach((p) => addItem(list, p, user.uid));
    setText('');
  };

  const onLong = (i: ListItem) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Delete'], destructiveButtonIndex: 1, cancelButtonIndex: 0, title: i.text },
      (k) => k === 1 && deleteItem(i.id),
    );

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140, gap: 14 }}
      >
        <T size={32} weight="800" style={{ letterSpacing: -0.8 }}>
          Lists
        </T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Segments
            value={list}
            onChange={setList}
            options={options.map((o) => ({ ...o, label: `${o.label}  ${counts(o.key) || ''}`.trim() }))}
          />
        </ScrollView>

        <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            placeholder="Add items — milk, eggs, bread"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="done"
            submitBehavior="submit"
          />
          <Press onPress={submit} style={styles.addBtn}>
            <T size={22} weight="600" style={{ color: '#0B0C14', marginTop: -2 }}>
              +
            </T>
          </Press>
        </Glass>

        {open.length === 0 && items !== null && (
          <T dim style={{ textAlign: 'center', marginTop: 20 }}>
            List is empty ✨
          </T>
        )}

        <View style={{ gap: 8 }}>
          {open.map((i, idx) => (
            <Animated.View key={i.id} entering={FadeInDown.delay(Math.min(idx, 8) * 30)} exiting={FadeOut} layout={LinearTransition.springify().damping(18)}>
              <Row item={i} onLong={() => onLong(i)} />
            </Animated.View>
          ))}
        </View>

        {done.length > 0 && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
              <T faint size={12} weight="800" style={{ flex: 1, letterSpacing: 1.5 }}>
                IN THE CART · {done.length}
              </T>
              <Press onPress={() => clearDone(done)} style={styles.clear}>
                <T size={12} weight="700" dim>
                  Clear
                </T>
              </Press>
            </View>
            <View style={{ gap: 8 }}>
              {done.map((i) => (
                <Animated.View key={i.id} exiting={FadeOut} layout={LinearTransition.springify().damping(18)}>
                  <Row item={i} onLong={() => onLong(i)} />
                </Animated.View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ item, onLong }: { item: ListItem; onLong: () => void }) {
  return (
    <Press
      haptic="none"
      onPress={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toggleItem(item);
      }}
      onLongPress={onLong}
      style={[styles.row, item.done && { opacity: 0.5 }]}
    >
      <View style={[styles.box, item.done && { backgroundColor: colors.good, borderColor: colors.good }]}>
        {item.done && (
          <T size={12} weight="900" style={{ color: '#0B0C14' }}>
            ✓
          </T>
        )}
      </View>
      <T size={16} weight="500" style={[{ flex: 1 }, item.done && { textDecorationLine: 'line-through' }]}>
        {item.text}
      </T>
    </Press>
  );
}

const styles = StyleSheet.create({
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 8 },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  clear: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
});
