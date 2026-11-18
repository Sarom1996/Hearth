import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as Crypto from 'expo-crypto';

import { ALLOWED_EMAIL_HASHES, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from './config';
import { fb } from './firebase';

async function allowed(email?: string | null) {
  if (!email) return false;
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, email.trim().toLowerCase());
  return ALLOWED_EMAIL_HASHES.includes(hash.toLowerCase());
}

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    GoogleSignin.configure({
      iosClientId: GOOGLE_IOS_CLIENT_ID,
      webClientId: GOOGLE_WEB_CLIENT_ID,
    });
    const { auth } = fb();
    return onAuthStateChanged(auth, async (u) => {
      if (u && !(await allowed(u.email))) {
        await fbSignOut(auth);
        setError('This Google account is not allowed in Hearth.');
        setUser(null);
      } else {
        setUser(u);
        if (u) {
          // Profile doc lets each of you see the other's name & lists.
          setDoc(
            doc(fb().db, 'users', u.uid),
            {
              name: u.displayName ?? u.email,
              firstName: (u.displayName ?? u.email ?? '').split(' ')[0],
              email: u.email,
              photo: u.photoURL ?? null,
              lastSeen: serverTimestamp(),
            },
            { merge: true },
          ).catch(() => {});
        }
      }
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const res = await GoogleSignin.signIn();
      if (isCancelledResponse(res)) return;
      const { idToken, user: gUser } = res.data;
      if (!(await allowed(gUser.email))) {
        await GoogleSignin.signOut();
        setError(`${gUser.email} is not allowed in Hearth.`);
        return;
      }
      if (!idToken) throw new Error('Google did not return an ID token.');
      await signInWithCredential(fb().auth, GoogleAuthProvider.credential(idToken));
    } catch (e) {
      if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    await GoogleSignin.signOut().catch(() => {});
    await fbSignOut(fb().auth);
  }, []);

  const value = useMemo(() => ({ user, loading, error, signIn, signOut }), [user, loading, error, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
