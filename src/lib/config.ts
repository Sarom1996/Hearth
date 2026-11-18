/**
 * ─────────────────────────────────────────────────────────────
 *  HEARTH — personal settings
 *  Fill these in once (Claude will do it with you). Nothing
 *  here is a password: Firebase web keys are public by design,
 *  and the real protection is the Firestore security rules.
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Only these Google accounts can open the app.
 * Stored as SHA-256 hashes of the lowercase email, so the addresses
 * themselves never appear in the code. (The real lock is the Firestore rules.)
 */
export const ALLOWED_EMAIL_HASHES: string[] = [
  '9d05016af5f5a277da6c0682e8bc0a8ca9b0bf857bf533096c1bfd025e26bbfa',
  '84d0d3d2a64f975e71a0d0c768cdd5a971e99ede1139ddd1a9bd233f0fa6402a',
];

/** Firebase console → Project settings → Your apps → Web app config */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDeGR5FN1r-G0ML7jJbHGtzzjnqjDbNwzk',
  authDomain: 'ours-eee56.firebaseapp.com',
  projectId: 'ours-eee56',
  storageBucket: 'ours-eee56.firebasestorage.app',
  messagingSenderId: '623992148318',
  appId: '1:623992148318:web:778fc1a8f4b9af692affcf',
};

/** From GoogleService-Info.plist (CLIENT_ID) and the Web OAuth client. */
export const GOOGLE_IOS_CLIENT_ID = '623992148318-cl9bfqeepatd9fram9p8jgaqfslqo6v8.apps.googleusercontent.com';
export const GOOGLE_WEB_CLIENT_ID = '623992148318-snkpu1csvafd1d4tauna3g33tt6cdle5.apps.googleusercontent.com';

/**
 * Optional — Claude API key (console.anthropic.com) for "✨ Ask AI" in the matrix.
 * Leave as REPLACE_ME to use the built-in offline parser instead.
 */
export const ANTHROPIC_API_KEY = 'REPLACE_ME';
export const ANTHROPIC_MODEL = 'claude-haiku-5-5';

/** Money settings */
export const CURRENCY = 'CAD';
export const LOCALE = 'en-CA';
/** Monthly spending budget shown on the home ring (dollars). Editable in-app later. */
export const DEFAULT_MONTHLY_BUDGET = 3000;

export const isConfigured = () =>
  !FIREBASE_CONFIG.apiKey.includes('REPLACE_ME') &&
  !GOOGLE_IOS_CLIENT_ID.includes('REPLACE_ME') &&
  ALLOWED_EMAIL_HASHES.length > 0;
