# 🔥 Hearth

A private iPhone app for Arash & family — money, Eisenhower-matrix tasks, shopping lists and reminders, with voice input.

## What's inside

| Tab | What it does |
|---|---|
| **Home** | Monthly budget ring, quick actions (expense, income, 🎙️ talk, list), today's focus, week vs last week |
| **Focus** | Eisenhower Matrix. Drag tasks between quadrants (long-press), swipe → done, ← snooze, ▶︎ Review mode, 🪄 AI re-sort, 🎙️ voice |
| **Money** | Day / week / month wrap-ups, category donut + bars, filters (home / each person), every transaction |
| **Lists** | Home list + one per person, live-synced; type several items with commas |

**Ask Hearth (🎙️ / ✨)** — one sentence can create expenses, shopping items and tasks with reminders at once.
Speech-to-text runs on the iPhone. Sorting uses Claude if an API key is set, otherwise an offline parser.

**Reminders** are local iPhone notifications (no server): per-task reminders with ✓ Done / 💤 1 hour buttons,
plus an 8 am focus digest and 8 pm check-in that opens Review mode.

## Stack

Expo SDK 58 (React Native 0.88) · Expo Router native tabs · Reanimated 4 · Firebase Auth (Google) + Firestore ·
expo-notifications · expo-speech-recognition · Claude API (optional).

## Settings to fill in

`src/lib/config.ts` — allowed emails, Firebase web config, Google iOS/Web client IDs, optional Claude API key.
`app.json` → `@react-native-google-signin/google-signin` → `iosUrlScheme` (the REVERSED_CLIENT_ID).
`firestore.rules` → paste into Firebase console → Firestore → Rules (same two emails).

## Data model (Firestore)

- `users/{uid}` — name, email, photo
- `transactions/{id}` — type, amount (cents), category, note, date, forWhom ('home' | uid), createdBy
- `listItems/{id}` — list ('home' | uid), text, done
- `tasks/{id}` — title, notes, urgent, important, due, dueHasTime, remindAt, owner, delegatedTo, effort, done
- `settings/home` — monthlyBudget (cents)

## Build

Pushed to GitHub → built in Expo's cloud → delivered through TestFlight. No Mac needed.
