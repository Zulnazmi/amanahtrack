import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter } from 'expo-router';

import { api } from './api/client';
import { currentLang, say, useLang } from './lang';

/**
 * Push notifications, on Android.
 *
 * The server sends to Expo's push service, and the phone shows the message
 * even if the app is closed. Tapping it opens the alert or the approvals.
 *
 * This needs an installed build with Firebase set up. Anywhere else it says
 * "unavailable" and the rest of the app works as before.
 */

export type PushState = 'checking' | 'on' | 'denied' | 'failed' | 'unavailable';

const supported =
  Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

const STORE_KEY = 'amanahtrack.push';

let state: PushState = supported ? 'checking' : 'unavailable';
const watchers = new Set<() => void>();
function setState(next: PushState) {
  state = next;
  watchers.forEach((w) => w());
}

export function usePushState(): PushState {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => state,
    () => state,
  );
}

function notifications() {
  // Loaded on demand so Expo Go never touches the module.
  return require('expo-notifications') as typeof import('expo-notifications');
}

// Work runs one at a time, so signing out cannot overtake a registration.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

async function register(ask: boolean): Promise<PushState> {
  const N = notifications();
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await N.setNotificationChannelAsync('alerts', {
    name: say('Amaran tabung', 'Box alerts'),
    importance: N.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
  await N.setNotificationChannelAsync('approvals', {
    name: say('Kelulusan', 'Approvals'),
    importance: N.AndroidImportance.HIGH,
    sound: 'default',
  });

  let { status } = await N.getPermissionsAsync();
  if (status !== 'granted' && ask) status = (await N.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return 'failed';

  const token = (await N.getExpoPushTokenAsync({ projectId })).data;
  // Remembered first: if the answer is lost, signing out still removes it.
  await AsyncStorage.setItem(STORE_KEY, token);
  await api.registerPushToken(token, currentLang());
  return 'on';
}

/** Safe to call again, for example after permission was given in the phone's settings. */
export async function setUpPush(ask = true): Promise<void> {
  if (!supported) return;
  try {
    setState(await inTurn(() => register(ask)));
  } catch {
    setState('failed');
  }
}

function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, no) => setTimeout(() => no(new Error('slow')), ms)),
  ]);
}

/** Called on sign out so this phone stops getting this person's messages. */
export async function unregisterPush(): Promise<void> {
  if (!supported) return;
  // Signing out must never fail, or hang, because of a notification clean up.
  try {
    await within(6000, inTurn(async () => {
      const N = notifications();
      N.dismissAllNotificationsAsync().catch(() => {});
      const token = await AsyncStorage.getItem(STORE_KEY);
      if (!token) return;
      try {
        await within(4000, api.removePushToken(token));
      } catch {
        // The server could not be told, so make the phone's address invalid.
        await within(1500, N.unregisterForNotificationsAsync());
      }
      await AsyncStorage.removeItem(STORE_KEY);
    }));
  } catch {
    // Kept in storage; the next sign in on this phone takes the address over.
  }
  setState('checking');
}

/** Mount once inside the signed in part of the app. `account` changes with each sign in. */
export function usePushSetup(account: string | null) {
  const router = useRouter();
  const { lang } = useLang();

  useEffect(() => {
    if (account) setUpPush();
  }, [account, lang]);

  useEffect(() => {
    if (!account || !supported) return;
    const N = notifications();
    const open = (response: import('expo-notifications').NotificationResponse | null) => {
      const data = response?.notification.request.content.data;
      if (!data) return;
      if (typeof data.alert_id === 'string') router.push(`/alert/${data.alert_id}`);
      else if (data.screen === 'approvals') router.push('/approvals');
      N.clearLastNotificationResponse?.();
    };
    const sub = N.addNotificationResponseReceivedListener(open);
    // The app was closed and the tap is what started it.
    open(N.getLastNotificationResponse?.() ?? null);
    return () => sub.remove();
  }, [router, account]);
}
