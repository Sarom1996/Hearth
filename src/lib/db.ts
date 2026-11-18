import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_MONTHLY_BUDGET } from './config';
import { fb } from './firebase';

/* ───────── Types ───────── */

export type TxnType = 'expense' | 'income';
/** Who the money was for: the shared home, or one of you (uid). */
export type ForWhom = 'home' | string;

export type Txn = {
  id: string;
  type: TxnType;
  amount: number; // cents, always positive
  category: string;
  note: string;
  date: Date;
  forWhom: ForWhom;
  createdBy: string;
  createdByName: string;
};

export type Member = { uid: string; name: string; firstName: string; email: string; photo: string | null };

export type ListItem = {
  id: string;
  list: 'home' | string; // 'home' or a member uid
  text: string;
  done: boolean;
  createdBy: string;
  createdAt: Date;
};

const d = (v: unknown) => (v instanceof Timestamp ? v.toDate() : new Date());

/* ───────── Members ───────── */

export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(
    () =>
      onSnapshot(collection(fb().db, 'users'), (snap) =>
        setMembers(
          snap.docs
            .map((x) => ({ uid: x.id, ...(x.data() as Omit<Member, 'uid'>) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      ),
    [],
  );
  return members;
}

/* ───────── Transactions ───────── */

export function useTransactions(start: Date, end: Date) {
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const s = start.getTime();
  const e = end.getTime();
  useEffect(() => {
    setTxns(null);
    const q = query(
      collection(fb().db, 'transactions'),
      where('date', '>=', Timestamp.fromMillis(s)),
      where('date', '<', Timestamp.fromMillis(e)),
      orderBy('date', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) =>
        setTxns(
          snap.docs.map((x) => {
            const v = x.data();
            return {
              id: x.id,
              type: v.type,
              amount: v.amount,
              category: v.category,
              note: v.note ?? '',
              date: d(v.date),
              forWhom: v.forWhom ?? 'home',
              createdBy: v.createdBy,
              createdByName: v.createdByName ?? '',
            } as Txn;
          }),
        ),
      () => setTxns([]),
    );
  }, [s, e]);
  return txns;
}

export function summarize(txns: Txn[] | null) {
  const out = { spent: 0, earned: 0, byCategory: new Map<string, number>() };
  for (const t of txns ?? []) {
    if (t.type === 'income') out.earned += t.amount;
    else {
      out.spent += t.amount;
      out.byCategory.set(t.category, (out.byCategory.get(t.category) ?? 0) + t.amount);
    }
  }
  const categories = [...out.byCategory.entries()]
    .map(([id, cents]) => ({ id, cents }))
    .sort((a, b) => b.cents - a.cents);
  return { spent: out.spent, earned: out.earned, net: out.earned - out.spent, categories };
}

export function useSummary(start: Date, end: Date) {
  const txns = useTransactions(start, end);
  return useMemo(() => ({ txns, ...summarize(txns) }), [txns]);
}

export async function addTxn(t: Omit<Txn, 'id'>) {
  await addDoc(collection(fb().db, 'transactions'), {
    ...t,
    date: Timestamp.fromDate(t.date),
    createdAt: serverTimestamp(),
  });
}

export const deleteTxn = (id: string) => deleteDoc(doc(fb().db, 'transactions', id));

/* ───────── Shopping lists ───────── */

export function useListItems() {
  const [items, setItems] = useState<ListItem[] | null>(null);
  useEffect(() => {
    const q = query(collection(fb().db, 'listItems'), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) =>
        setItems(
          snap.docs.map((x) => {
            const v = x.data();
            return {
              id: x.id,
              list: v.list,
              text: v.text,
              done: !!v.done,
              createdBy: v.createdBy,
              createdAt: d(v.createdAt),
            };
          }),
        ),
      () => setItems([]),
    );
  }, []);
  return items;
}

export const addItem = (list: string, text: string, uid: string) =>
  addDoc(collection(fb().db, 'listItems'), {
    list,
    text: text.trim(),
    done: false,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

export const toggleItem = (item: ListItem) =>
  updateDoc(doc(fb().db, 'listItems', item.id), { done: !item.done, doneAt: serverTimestamp() });

export const deleteItem = (id: string) => deleteDoc(doc(fb().db, 'listItems', id));

export async function clearDone(items: ListItem[]) {
  const batch = writeBatch(fb().db);
  items.filter((i) => i.done).forEach((i) => batch.delete(doc(fb().db, 'listItems', i.id)));
  await batch.commit();
}

/* ───────── Shared settings ───────── */

export function useBudget() {
  const [budget, setBudget] = useState(DEFAULT_MONTHLY_BUDGET * 100);
  useEffect(
    () =>
      onSnapshot(doc(fb().db, 'settings', 'home'), (s) => {
        const v = s.data()?.monthlyBudget;
        if (typeof v === 'number') setBudget(v);
      }),
    [],
  );
  return budget;
}

export const saveBudget = (cents: number) =>
  setDoc(doc(fb().db, 'settings', 'home'), { monthlyBudget: cents }, { merge: true });
