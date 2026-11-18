export const colors = {
  bg: '#07080F',
  bg2: '#0E1022',
  card: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(255,255,255,0.10)',
  text: '#F4F5FB',
  textDim: 'rgba(244,245,251,0.62)',
  textFaint: 'rgba(244,245,251,0.38)',
  accent: '#8B7CFF', // violet
  accent2: '#4FD1C5', // teal
  warm: '#FFB86B', // amber
  danger: '#FF6B8B',
  good: '#5BE49B',
};

export const radius = { sm: 12, md: 18, lg: 26, xl: 34 };
export const space = (n: number) => n * 4;

export type Category = { id: string; label: string; emoji: string; color: string };

export const EXPENSE_CATEGORIES: Category[] = [
  { id: 'groceries', label: 'Groceries', emoji: '🛒', color: '#5BE49B' },
  { id: 'dining', label: 'Dining', emoji: '🍜', color: '#FFB86B' },
  { id: 'coffee', label: 'Coffee', emoji: '☕️', color: '#C79A6B' },
  { id: 'transport', label: 'Transport', emoji: '🚗', color: '#5AA9FF' },
  { id: 'home', label: 'Home', emoji: '🏠', color: '#8B7CFF' },
  { id: 'bills', label: 'Bills', emoji: '🧾', color: '#A0A8C0' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️', color: '#FF7AD9' },
  { id: 'health', label: 'Health', emoji: '💊', color: '#4FD1C5' },
  { id: 'fun', label: 'Fun', emoji: '🎬', color: '#FF6B8B' },
  { id: 'travel', label: 'Travel', emoji: '✈️', color: '#62E0FF' },
  { id: 'gifts', label: 'Gifts', emoji: '🎁', color: '#FFD86B' },
  { id: 'other', label: 'Other', emoji: '✨', color: '#9AA0B5' },
];

export const INCOME_CATEGORIES: Category[] = [
  { id: 'salary', label: 'Salary', emoji: '💼', color: '#5BE49B' },
  { id: 'side', label: 'Side income', emoji: '🧠', color: '#4FD1C5' },
  { id: 'refund', label: 'Refund', emoji: '↩️', color: '#5AA9FF' },
  { id: 'gift-in', label: 'Gift', emoji: '🎁', color: '#FFD86B' },
  { id: 'other-in', label: 'Other', emoji: '✨', color: '#9AA0B5' },
];

const ALL = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
export const categoryById = (id: string): Category =>
  ALL.find((c) => c.id === id) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
