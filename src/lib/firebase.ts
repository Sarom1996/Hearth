import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, type FirebaseApp } from 'firebase/app';
// `getReactNativePersistence` only exists in the React Native build of @firebase/auth
// (the same module `firebase/auth` re-exports at runtime).
import { getReactNativePersistence } from '@firebase/auth';
import { initializeAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, type Firestore } from 'firebase/firestore';

import { FIREBASE_CONFIG } from './config';

type FB = { app: FirebaseApp; auth: Auth; db: Firestore };
let instance: FB | null = null;

/**
 * Lazily initialise Firebase, so the app can still show the setup
 * screen (instead of crashing) while config.ts has placeholders.
 */
export function fb(): FB {
  if (instance) return instance;
  const app = initializeApp(FIREBASE_CONFIG);
  instance = {
    app,
    // Keeps you signed in between app launches.
    auth: initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) }),
    // Long polling is the most reliable transport inside React Native.
    db: initializeFirestore(app, { experimentalForceLongPolling: true }),
  };
  return instance;
}
