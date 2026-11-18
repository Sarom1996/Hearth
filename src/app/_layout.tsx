import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Backdrop } from '../components/Backdrop';
import { T } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { isConfigured } from '../lib/config';
import { loadAiKey } from '../lib/prefs';
import { useNotificationRouting, useReminderSync } from '../lib/reminders';
import { useTasks } from '../lib/tasks';
import { colors } from '../lib/theme';

// Read the Claude key from the Keychain once at launch.
loadAiKey().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, primary: colors.accent, card: colors.bg2, text: colors.text },
};

const sheet = {
  presentation: 'formSheet' as const,
  sheetGrabberVisible: true,
  sheetCornerRadius: 32,
  contentStyle: { backgroundColor: colors.bg2 },
};

function ReminderSync({ uid }: { uid: string }) {
  const tasks = useTasks();
  useReminderSync(tasks, uid);
  useNotificationRouting(tasks);
  return null;
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.center}>
        <Backdrop />
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return (
    <>
      {user && <ReminderSync uid={user.uid} />}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="add-expense" options={{ ...sheet, sheetAllowedDetents: [0.94] }} />
          <Stack.Screen name="task" options={{ ...sheet, sheetAllowedDetents: [0.94] }} />
          <Stack.Screen name="ask-ai" options={{ ...sheet, sheetAllowedDetents: [0.94] }} />
          <Stack.Screen name="review" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="docs" />
          <Stack.Screen name="inbox" options={{ ...sheet, sheetAllowedDetents: [0.94] }} />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function SetupNeeded() {
  return (
    <View style={styles.center}>
      <Backdrop />
      <T size={34}>🔧</T>
      <T size={22} weight="700" style={{ marginTop: 12 }}>
        Almost there
      </T>
      <T dim style={{ textAlign: 'center', marginTop: 8, paddingHorizontal: 32 }}>
        Hearth needs its Firebase and Google settings. Ask Claude to fill in src/lib/config.ts.
      </T>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ThemeProvider value={theme}>
        {isConfigured() ? (
          <AuthProvider>
            <Gate />
          </AuthProvider>
        ) : (
          <SetupNeeded />
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
