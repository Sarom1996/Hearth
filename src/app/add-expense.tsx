import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { Press, Segments, T } from '../components/ui';
import { useAuth } from '../lib/auth';
import { guessCategory } from '../lib/ai';
import { addTxn, useMembers, type TxnType } from '../lib/db';
import { fmt } from '../lib/format';
import { colors, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/theme';

/** "CA$1,234.50" → "1234.50", "12,50 $" → "12.50" */
function parseWalletAmount(v?: string) {
  if (!v) return '';
  let x = v.replace(/[^0-9.,]/g, '');
  x = x.includes('.') ? x.replace(/,/g, '') : x.replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const n = parseFloat(x);
  return isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : '';
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function AddExpense() {
  // Also opened by the Apple Pay automation: hearth://add-expense?amount=CA$12.50&merchant=Starbucks&card=Visa
  const params = useLocalSearchParams<{ type?: TxnType; amount?: string; merchant?: string; card?: string }>();
  const fromWallet = !!params.amount;
  const walletAmount = parseWalletAmount(params.amount);
  const walletNote = [params.merchant, params.card ? `(${params.card})` : ''].filter(Boolean).join(' ');
  const { user } = useAuth();
  const members = useMembers();
  const [type, setType] = useState<TxnType>(params.type === 'income' ? 'income' : 'expense');
  const [raw, setRaw] = useState(walletAmount);
  const [category, setCategory] = useState(
    type === 'income' ? 'salary' : fromWallet ? guessCategory(params.merchant ?? '') : 'groceries',
  );
  const [note, setNote] = useState(walletNote);
  const [forWhom, setForWhom] = useState<string>('home');
  const [date, setDate] = useState(new Date());
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const cents = Math.round(parseFloat(raw || '0') * 100);

  const press = (k: string) => {
    Haptics.selectionAsync();
    setRaw((r) => {
      if (k === '⌫') return r.slice(0, -1);
      if (k === '.' && r.includes('.')) return r;
      if (r.includes('.') && r.split('.')[1].length >= 2) return r;
      if (r.replace('.', '').length >= 7) return r;
      if (r === '0' && k !== '.') return k;
      return r + k;
    });
  };

  const save = async () => {
    if (!user || cents <= 0) {
      shake.value = withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
    await addTxn({
      type,
      amount: cents,
      category,
      note: note.trim(),
      date,
      forWhom,
      createdBy: user.uid,
      createdByName: user.displayName ?? user.email ?? '',
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg2 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 26, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 14 }}>
          <Segments<TxnType>
            value={type}
            onChange={(t) => {
              setType(t);
              setCategory(t === 'income' ? 'salary' : 'groceries');
            }}
            options={[
              { key: 'expense', label: 'Expense' },
              { key: 'income', label: 'Income' },
            ]}
          />
          {fromWallet && (
            <T size={12} weight="700" style={{ color: colors.accent2, letterSpacing: 1 }}>
               APPLE PAY · CHECK AND SAVE
            </T>
          )}
          <Animated.View style={shakeStyle}>
            <T size={56} weight="800" style={{ letterSpacing: -2, color: type === 'income' ? colors.good : colors.text }}>
              {fmt(cents)}
            </T>
          </Animated.View>
        </View>

        {/* Categories */}
        <View style={styles.cats}>
          {cats.map((c) => {
            const on = c.id === category;
            return (
              <Press
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.cat, { borderColor: on ? c.color : 'transparent', backgroundColor: on ? c.color + '26' : 'rgba(255,255,255,0.05)' }]}
              >
                <T size={22}>{c.emoji}</T>
                <T size={11} weight={on ? '700' : '500'} dim={!on} numberOfLines={1}>
                  {c.label}
                </T>
              </Press>
            );
          })}
        </View>

        <View style={styles.rowWrap}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Note (e.g. Costco, Uber home)"
            placeholderTextColor={colors.textFaint}
            style={styles.note}
          />
          <DateTimePicker value={date} mode="date" display="compact" themeVariant="dark" accentColor={colors.accent} maximumDate={new Date()} onValueChange={(_, d) => setDate(d)} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[{ uid: 'home', label: '🏠 For home' }, ...members.map((m) => ({ uid: m.uid, label: m.uid === user?.uid ? '🙋 For me' : `💛 For ${m.firstName}` }))].map((o) => (
            <Press
              key={o.uid}
              onPress={() => setForWhom(o.uid)}
              style={[styles.pill, forWhom === o.uid && { backgroundColor: colors.accent }]}
            >
              <T size={13} weight="600" dim={forWhom !== o.uid}>
                {o.label}
              </T>
            </Press>
          ))}
        </ScrollView>

        {/* Keypad */}
        <View style={styles.pad}>
          {KEYS.map((k) => (
            <Press key={k} haptic="none" onPress={() => press(k)} style={styles.key}>
              <T size={26} weight="500">
                {k}
              </T>
            </Press>
          ))}
        </View>

        <Press haptic="none" onPress={save} style={[styles.save, { backgroundColor: type === 'income' ? colors.good : colors.text }]}>
          <T size={17} weight="800" style={{ color: '#0B0C14' }}>
            Save {type}
          </T>
        </Press>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  cat: { width: '23%', aspectRatio: 1.05, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 4 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  note: { flex: 1, color: colors.text, fontSize: 15, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  key: { width: '31.5%', height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  save: { height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
});
