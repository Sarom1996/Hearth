import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Backdrop } from '../components/Backdrop';
import { Ring } from '../components/Ring';
import { Press, T } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function SignIn() {
  const { signIn, error } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setP(0.72), 300);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 30 }]}>
      <Backdrop />
      <Animated.View entering={FadeInUp.duration(900)} style={{ alignItems: 'center' }}>
        <Ring size={170} stroke={14} progress={p} from={colors.warm} to={colors.accent}>
          <T size={58}>🔥</T>
        </Ring>
        <T size={44} weight="800" style={{ marginTop: 28, letterSpacing: -1 }}>
          Hearth
        </T>
        <T dim size={17} style={{ marginTop: 8, textAlign: 'center' }}>
          Money, tasks and lists for our home.
        </T>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(300).duration(800)} style={{ width: '100%', gap: 14 }}>
        {error && (
          <T size={14} style={{ color: colors.danger, textAlign: 'center' }}>
            {error}
          </T>
        )}
        <Press
          haptic="medium"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            await signIn();
            setBusy(false);
          }}
          style={styles.btn}
        >
          {busy ? (
            <ActivityIndicator color="#111" />
          ) : (
            <T size={17} weight="700" style={{ color: '#111' }}>
              Continue with Google
            </T>
          )}
        </Press>
        <T faint size={13} style={{ textAlign: 'center' }}>
          Private — only two Google accounts can enter.
        </T>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  btn: {
    height: 58,
    borderRadius: 20,
    backgroundColor: '#F4F5FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
