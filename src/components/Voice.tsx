import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../lib/theme';
import { Press, T } from './ui';

/** Words that help the recogniser with this household's vocabulary. */
const HINTS = ['Costco', 'Hearth', 'groceries', 'hydro', 'Eisenhower', 'delegate', 'schedule', 'remind me'];

/**
 * On-device speech-to-text (Apple's speech recogniser).
 * `text` = what was there before you started + what you are saying now.
 */
export function useDictation(initial = '') {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const base = useRef(initial);
  const level = useSharedValue(0);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    level.value = withTiming(0);
  });
  useSpeechRecognitionEvent('result', (e) => {
    const heard = e.results[0]?.transcript ?? '';
    setText(base.current ? `${base.current} ${heard}` : heard);
  });
  useSpeechRecognitionEvent('volumechange', (e) => {
    level.value = withTiming(Math.max(0, Math.min(1, (e.value + 2) / 12)), { duration: 90 });
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (e.error !== 'aborted' && e.error !== 'no-speech') setError(e.message);
    setListening(false);
  });

  const start = useCallback(async () => {
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone / speech permission is off. Enable it in iPhone Settings → Hearth.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setText((t) => {
      base.current = t.trim();
      return t;
    });
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      contextualStrings: HINTS,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
    });
  }, []);

  const stop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ExpoSpeechRecognitionModule.stop();
  }, []);

  useEffect(() => () => ExpoSpeechRecognitionModule.abort(), []);

  return { listening, text, setText, error, start, stop, level };
}

/** Big glowing mic with a live voice-level halo. Tap to start/stop. */
export function MicButton({
  listening,
  onPress,
  level,
  size = 76,
}: {
  listening: boolean;
  onPress: () => void;
  level: ReturnType<typeof useDictation>['level'];
  size?: number;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = listening ? withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1) : withTiming(0);
  }, [listening, pulse]);

  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + level.value * 0.6 }],
    opacity: listening ? 0.35 + level.value * 0.4 : 0,
  }));
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.9 }],
    opacity: listening ? 0.5 * (1 - pulse.value) : 0,
  }));
  const core = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(listening ? 1.08 : 1) }],
  }));

  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent }, ring]} />
      <Animated.View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent2 }, halo]} />
      <Press haptic="none" onPress={onPress}>
        <Animated.View
          style={[
            styles.circle,
            styles.core,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: listening ? colors.danger : colors.accent },
            core,
          ]}
        >
          <T size={size * 0.4}>{listening ? '■' : '🎙️'}</T>
        </Animated.View>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  core: {
    position: 'relative',
    shadowColor: colors.accent,
    shadowOpacity: 0.7,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
  },
});
