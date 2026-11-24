import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Answer } from '../src/api/client';
import { fullTime } from '../src/format';
import { useLang } from '../src/lang';
import { Lang, spokenAnswer } from '../src/speakable';
import { colors, fonts, radius } from '../src/theme';
import { Icon } from '../src/ui/Icon';
import { FadeUp } from '../src/ui/motion';
import { Mood, Presence } from '../src/ui/Presence';
import { useListening, useSpeaking } from '../src/voice';

/**
 * Pembantu Amanah: a conversation, one exchange on the stage at a time.
 *
 * Every figure comes from the server's ledger code. The screen shows how each
 * figure was worked out, and a failed question is shown as failed, never as an
 * empty answer. The assistant only reads, so a spoken question may be sent
 * without a press, after a pause in which it can be stopped.
 */

type Turn = { id: number; question: string; answer?: Answer; error?: string };

const START: Record<Lang, string> = { ms: 'Ringkasan hari ini', en: 'Summary today' };
const FIRST: Record<Lang, string[]> = {
  ms: [
    'Baki setiap dana',
    'Derma minggu ini',
    'Ramalan minggu depan',
    'Ada apa-apa luar biasa?',
    'Boleh guna zakat untuk bumbung?',
  ],
  en: [
    'Balance of each fund',
    'Donations this week',
    'Forecast next week',
    'Anything unusual?',
    'Can zakat pay for the roof?',
  ],
};

// Asked again: spoken questions are now sent by themselves
const VOICE_OK = 'amanah.voice.ok2';
const SEND_PAUSE_MS = 1600;

const SAYS: Record<Lang, Record<Mood | 'sending', string>> = {
  ms: {
    idle: 'Tekan saya dan tanya',
    listening: 'Saya sedang mendengar…',
    thinking: 'Sekejap, saya semak rekod…',
    speaking: 'Tekan untuk berhenti',
    trouble: 'Saya tidak dapat menjawab',
    sending: 'Menghantar… tekan untuk batal',
  },
  en: {
    idle: 'Tap me and ask',
    listening: 'I am listening…',
    thinking: 'One moment, checking the records…',
    speaking: 'Tap to stop',
    trouble: 'I could not answer',
    sending: 'Sending… tap to cancel',
  },
};

function useKeyboard() {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const a = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setUp(true));
    const b = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setUp(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return up;
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const typing = useKeyboard();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const working = useRef(false);
  const next = useRef(0);
  const context = useRef<Answer['context']>(null);

  const { lang: appLang, t: tr } = useLang();
  const [lang, setLang] = useState<Lang>(appLang);
  const [asking, setAsking] = useState(false);

  // How loud the voice is right now, shown by the avatar
  const level = useRef(new Animated.Value(0)).current;
  const loud = useCallback(
    (to: number) => {
      Animated.timing(level, { toValue: to, duration: 90, useNativeDriver: true }).start();
    },
    [level],
  );
  const beat = useCallback(() => {
    Animated.sequence([
      Animated.timing(level, { toValue: 0.55 + Math.random() * 0.4, duration: 70, useNativeDriver: true }),
      Animated.timing(level, { toValue: 0.15, duration: 320, useNativeDriver: true }),
    ]).start();
  }, [level]);

  // Words heard by voice wait a moment before they go, so they can be stopped
  const heard = useRef('');
  const [sending, setSending] = useState(false);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useCallback(() => {
    if (wait.current) clearTimeout(wait.current);
    wait.current = null;
    setSending(false);
  }, []);
  const onWords = useCallback((words: string) => {
    heard.current = words;
    setText(words);
  }, []);
  const askRef = useRef<(q: string, retryOf?: number, aloud?: boolean) => void>(() => {});
  const onFinished = useCallback(() => {
    if (!heard.current) return;
    setSending(true);
    wait.current = setTimeout(() => {
      wait.current = null;
      setSending(false);
      const words = heard.current;
      heard.current = '';
      setText('');
      askRef.current(words, undefined, true);
    }, SEND_PAUSE_MS);
  }, []);

  const { listening, problem, setProblem, start, stop, cancel } = useListening(onWords, onFinished, loud);
  const { speaking, silent, speak, hush } = useSpeaking(beat);

  useEffect(() => {
    if (!listening && speaking === null) loud(0);
  }, [listening, speaking, loud]);

  // Opening another screen leaves this one mounted underneath it
  const here = useRef(true);
  useFocusEffect(
    useCallback(() => {
      here.current = true;
      return () => {
        here.current = false;
        hold();
        cancel();
        hush();
      };
    }, [cancel, hold, hush]),
  );

  // A question is not sent on its own while nobody is looking
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') hold();
    });
    return () => sub.remove();
  }, [hold]);

  const ask = useCallback(
    async (question: string, retryOf?: number, aloud = false) => {
      const asked = question.trim();
      if (!asked || working.current) return;
      working.current = true;
      setBusy(true);
      setHistory(false);
      hold();
      cancel();
      hush();
      const id = retryOf ?? next.current++;
      setTurns((t) =>
        retryOf === undefined
          ? [...t, { id, question: asked }]
          : t.map((x) => (x.id === id ? { id, question: asked } : x)),
      );
      try {
        const answer = await api.ask(asked, context.current);
        context.current = answer.context;
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
        if (aloud && here.current) speak(id, spokenAnswer(answer), answer.lang);
      } catch (e) {
        const error = e instanceof Error ? e.message : tr('Tidak dapat menjawab.', 'Could not answer.');
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, error } : x)));
      } finally {
        working.current = false;
        setBusy(false);
      }
    },
    [cancel, hold, hush, speak, tr],
  );
  askRef.current = ask;

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ask(START[appLang]);
  }, [ask, appLang]);

  function send() {
    if (working.current || !text.trim()) return;
    ask(text, undefined, heard.current !== '');
    heard.current = '';
    setText('');
  }

  async function talk() {
    if (sending) return hold();
    if (listening) return stop();
    if (speaking !== null) return hush();
    if (working.current) return;
    Keyboard.dismiss();
    const agreed = await AsyncStorage.getItem(VOICE_OK).catch(() => null);
    if (!here.current) return;
    if (agreed) listen();
    else setAsking(true);
  }

  function listen() {
    hold();
    hush();
    heard.current = '';
    setText('');
    setHistory(false);
    start(lang);
  }

  function agree() {
    setAsking(false);
    AsyncStorage.setItem(VOICE_OK, '1').catch(() => {});
    listen();
  }

  const last = turns[turns.length - 1];
  const chips = last?.answer?.suggestions.length ? last.answer.suggestions : turns.length < 2 ? FIRST[appLang] : [];
  const trouble = problem ?? silent;
  const mood: Mood = listening
    ? 'listening'
    : busy
      ? 'thinking'
      : speaking !== null
        ? 'speaking'
        : trouble || last?.error
          ? 'trouble'
          : 'idle';
  const says = SAYS[lang];
  const status = sending ? says.sending : trouble && mood === 'trouble' ? trouble : says[mood];
  const live = listening || sending;
  const size = typing || history ? 92 : Math.min(width * 0.62, height * 0.3, 260);
  const shown = history ? turns : last ? [last] : [];

  return (
    <KeyboardAvoidingView style={s.screen} behavior="padding" keyboardVerticalOffset={insets.top + 56}>
      <Stack.Screen
        options={{
          headerRight: () =>
            turns.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={history ? tr('Tutup sejarah', 'Close history') : tr('Sejarah', 'History')}
                onPress={() => setHistory((h) => !h)}
                style={s.headerBtn}
              >
                <Text style={s.chipText}>{history ? tr('Tutup', 'Close') : tr('Sejarah', 'History')}</Text>
              </Pressable>
            ) : null,
        }}
      />

      <View style={s.stage}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            sending
              ? tr('Batal hantar', 'Cancel sending')
              : listening
                ? tr('Berhenti mendengar', 'Stop listening')
                : speaking !== null
                  ? tr('Berhenti membaca', 'Stop speaking')
                  : tr('Cakap', 'Speak')
          }
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={talk}
        >
          <Presence mood={mood} level={level} size={size} />
        </Pressable>
        <Text
          style={[
            s.says,
            mood === 'trouble' && { color: colors.danger },
            mood === 'listening' && { color: colors.brass },
          ]}
          accessibilityLiveRegion="polite"
        >
          {status}
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {asking ? (
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{tr('Tanya dengan suara', 'Ask by voice')}</Text>
            <Text style={s.sheetText}>
              {tr(
                'Mikrofon dibuka hanya apabila anda menekan Pembantu. Telefon menukar suara kepada teks dan mungkin menghantar audio kepada penyedianya, seperti Google atau Apple. AmanahTrack tidak menyimpan audio. Soalan dihantar selepas anda berhenti bercakap, dan boleh dibatalkan. Jangan sebut nama penderma.',
                'The microphone opens only when you tap the Assistant. Your phone turns speech into text and may send the audio to its provider, such as Google or Apple. AmanahTrack keeps no audio. The question is sent after you stop talking, and can be cancelled. Do not say donors’ names.',
              )}
            </Text>
            <View style={s.chips}>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('Setuju dan cakap', 'Agree and speak')} style={s.chip} onPress={agree}>
                <Text style={s.chipText}>{tr('Setuju dan cakap', 'Agree and speak')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('Tidak, saya taip', 'No, I will type')}
                style={s.chip}
                onPress={() => setAsking(false)}
              >
                <Text style={s.chipText}>{tr('Tidak, saya taip', 'No, I will type')}</Text>
              </Pressable>
            </View>
          </View>
        ) : live ? (
          <Text style={s.caption} accessibilityLiveRegion="polite">
            {text || '…'}
          </Text>
        ) : (
          shown.map((t) => (
            <FadeUp key={`${t.id}-${t.answer ? 'a' : t.error ? 'e' : 'q'}`} style={{ gap: 12 }}>
              {t.id === 0 && !history ? (
                <Text style={s.hello}>{tr('Assalamualaikum. Saya Pembantu Amanah.', 'Assalamualaikum. I am your Amanah Assistant.')}</Text>
              ) : (
                <Text style={s.you}>“{t.question}”</Text>
              )}
              {t.answer ? (
                <AnswerCard
                  a={t.answer}
                  speaking={speaking === t.id}
                  onSpeak={() =>
                    speaking === t.id ? hush() : speak(t.id, spokenAnswer(t.answer!), t.answer!.lang)
                  }
                />
              ) : t.error ? (
                <View style={s.error} accessibilityLiveRegion="polite">
                  <Text style={s.errorText}>{t.error}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr('Cuba lagi', 'Try again')}
                    style={s.retry}
                    onPress={() => ask(t.question, t.id)}
                  >
                    <Text style={s.errorText}>{tr('Cuba lagi', 'Try again')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </FadeUp>
          ))
        )}
        {!live && !asking && (
          <Text style={s.lede}>
            {tr(
              'Jawapan dikira daripada rekod masjid anda. Pembantu hanya membaca; ia tidak merekod atau meluluskan apa-apa.',
              'Answers are worked out from your mosque’s records. The Assistant only reads; it records and approves nothing.',
            )}
          </Text>
        )}
      </ScrollView>

      {!busy && !live && !asking && !typing && chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={s.strip}
          keyboardShouldPersistTaps="handled"
        >
          {chips.map((c) => (
            <Pressable key={c} accessibilityRole="button" accessibilityLabel={c} onPress={() => ask(c)} style={s.chip}>
              <Text style={s.chipText}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={[s.bar, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={lang === 'en' ? 'Bahasa suara: English' : 'Bahasa suara: BM'}
          disabled={listening}
          onPress={() => setLang(lang === 'ms' ? 'en' : 'ms')}
          style={[s.lang, listening && { opacity: 0.4 }]}
        >
          <Text style={s.chipText}>{lang === 'en' ? 'EN' : 'BM'}</Text>
        </Pressable>
        <TextInput
          style={s.input}
          value={text}
          onFocus={hold}
          onChangeText={(v) => {
            hold();
            if (listening) cancel();
            if (!v) heard.current = '';
            setProblem(null);
            setText(v);
          }}
          onSubmitEditing={send}
          submitBehavior="submit"
          returnKeyType="send"
          maxLength={300}
          placeholder={lang === 'en' ? 'Or type here' : 'Atau taip di sini'}
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel={tr('Soalan anda', 'Your question')}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('Hantar', 'Send')}
          onPress={send}
          disabled={busy || !text.trim()}
          style={[s.send, (busy || !text.trim()) && { opacity: 0.4 }]}
        >
          <Icon name="chevron" size={22} color={colors.onGreen} strokeWidth={2.4} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function AnswerCard({ a, speaking, onSpeak }: { a: Answer; speaking: boolean; onSpeak: () => void }) {
  const router = useRouter();
  const en = a.lang === 'en';
  const basis = en ? a.basis_en : a.basis_ms;
  return (
    <View style={s.answer} accessibilityLiveRegion="polite">
      <Text style={s.answerText}>{en ? a.text_en : a.text_ms}</Text>
      {a.rows.length > 0 && (
        <View>
          {a.rows.map((r, i) => (
            <View key={i} style={s.row}>
              <Text style={s.rowLabel}>{en ? r.label_en : r.label_ms}</Text>
              <Text style={s.rowValue}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}
      {a.links.length > 0 && (
        <View style={s.chips}>
          {a.links.map((l) => (
            <Pressable
              key={l.href}
              accessibilityRole="button"
              accessibilityLabel={en ? l.label_en : l.label_ms}
              onPress={() => router.push(l.href as never)}
              style={s.chip}
            >
              <Text style={s.chipText}>{en ? l.label_en : l.label_ms}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={speaking ? 'Berhenti membaca' : 'Dengar jawapan'}
        onPress={onSpeak}
        style={s.hear}
      >
        <Icon name={speaking ? 'stop' : 'speaker'} size={20} color={colors.green} />
        <Text style={s.chipText}>{speaking ? (en ? 'Stop' : 'Berhenti') : en ? 'Listen' : 'Dengar'}</Text>
      </Pressable>
      <Text style={s.basis}>
        {basis ? `${basis} ` : ''}
        {fullTime(a.as_of)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 28, gap: 18, width: '100%', maxWidth: 640, alignSelf: 'center' },
  stage: { alignItems: 'center', paddingTop: 8, paddingHorizontal: 20, gap: 6 },
  says: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 23, textAlign: 'center', color: colors.inkSoft },
  caption: {
    paddingTop: 12,
    fontFamily: fonts.bodySemi,
    fontSize: 25,
    lineHeight: 34,
    textAlign: 'center',
    color: colors.ink,
  },
  hello: { fontFamily: fonts.bodyMedium, fontSize: 17, lineHeight: 25, textAlign: 'center', color: colors.ink },
  you: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, textAlign: 'center', color: colors.inkFaint },
  headerBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 12 },
  strip: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  lede: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, textAlign: 'center', color: colors.inkFaint },
  answer: {
    padding: 16,
    gap: 12,
    borderRadius: radius.lg,
    borderTopLeftRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  answerText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.ink },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowLabel: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.inkSoft },
  rowValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  basis: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.inkFaint },
  error: { padding: 14, gap: 8, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.danger },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.green },
  bar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  hear: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, alignSelf: 'flex-start' },
  lang: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  sheet: {
    padding: 16,
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
  },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  sheetText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  send: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
  },
});
