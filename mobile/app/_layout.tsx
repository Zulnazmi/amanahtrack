import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Sora_400Regular,
  Sora_600SemiBold,
  Sora_700Bold,
} from '@expo-google-fonts/sora';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { LangProvider, useLang } from '../src/lang';
import { LiveProvider } from '../src/live';
import { SessionProvider, useSession } from '../src/session';
import { colors, fonts } from '../src/theme';
import { PushSetup } from '../src/ui/PushSetup';
import { Splash } from '../src/ui/Splash';

/**
 * Route guard.
 *
 * Anything outside the login screen requires a session. Redirecting here
 * rather than inside each screen means a new screen cannot accidentally ship
 * unprotected.
 */
function Guard({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login';
    if (!session && !onLogin) router.replace('/login');
    if (!session) return;
    if (session.must_change_password) {
      if (segments[0] !== 'password') router.replace('/password');
    } else if (onLogin) router.replace('/');
  }, [session, ready, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function Layout() {
  return (
    <LangProvider>
      <App />
    </LangProvider>
  );
}

function App() {
  const { t } = useLang();
  const [fontsLoaded] = useFonts({
    Sora_400Regular,
    Sora_600SemiBold,
    Sora_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);

  // A stalled animation must never keep somebody out of the app.
  useEffect(() => {
    const timer = setTimeout(finishSplash, 5000);
    return () => clearTimeout(timer);
  }, [finishSplash]);

  // Nothing is drawn until the fonts are in, so text never flashes in the
  // wrong typeface.
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <StatusBar style="light" />
      <SessionProvider>
        <Guard>
          <LiveProvider>
          <Stack
            screenOptions={{
              animation: 'slide_from_right',
              headerStyle: { backgroundColor: colors.paper },
              headerShadowVisible: false,
              headerTintColor: colors.ink,
              headerTitleStyle: { fontFamily: fonts.display, fontSize: 17 },
              contentStyle: { backgroundColor: colors.paper },
            }}
          >
            <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="index" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen
              name="spend"
              options={{ title: t('Rekod belanja', 'Record spending'), presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="assistant" options={{ title: t('Pembantu Amanah', 'Amanah Assistant') }} />
            <Stack.Screen name="donate" options={{ title: t('Rekod derma', 'Record donation') }} />
            <Stack.Screen name="approvals" options={{ title: t('Kelulusan', 'Approvals') }} />
            <Stack.Screen name="people" options={{ title: t('Pengguna', 'Users') }} />
            <Stack.Screen name="password" options={{ title: t('Kata laluan', 'Password') }} />
            <Stack.Screen name="settings" options={{ title: t('Tetapan', 'Settings') }} />
            <Stack.Screen name="receipt/[reference]" options={{ title: t('Resit', 'Receipt') }} />
            <Stack.Screen name="count" options={{ title: t('Kira tabung', 'Box count') }} />
            <Stack.Screen name="ledger" options={{ title: t('Rekod kewangan', 'Financial records') }} />
            <Stack.Screen name="live" options={{ title: t('Tabung sekarang', 'Box now') }} />
            <Stack.Screen name="alerts" options={{ title: t('Amaran', 'Alerts') }} />
            <Stack.Screen name="alert/[id]" options={{ title: t('Semak amaran', 'Review alert') }} />
            <Stack.Screen name="proof/[reference]" options={{ title: t('Bukti rekod', 'Entry proof') }} />
          </Stack>
          <PushSetup />
          </LiveProvider>
        </Guard>
      </SessionProvider>
      {!splashDone && <Splash onDone={finishSplash} />}
    </View>
  );
}
