import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Answer } from '../src/api/client';
import { fullTime } from '../src/format';
import { colors, fonts, radius } from '../src/theme';
import { Icon } from '../src/ui/Icon';

/**
 * Pembantu Amanah.
 *
 * Every figure comes from the server's ledger code. The screen shows how each
 * figure was worked out, and a failed question is shown as failed, never as an
 * empty answer.
 */

type Turn = { id: number; question: string; answer?: Answer; error?: string };

const START = 'Ringkasan hari ini';
const FIRST = [
  'Baki setiap dana',
  'Derma minggu ini',
  'Ramalan minggu depan',
  'Ada apa-apa luar biasa?',
  'Boleh guna zakat untuk bumbung?',
];

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const next = useRef(0);
  const context = useRef<Answer['context']>(null);
  const scroll = useRef<ScrollView>(null);

  const ask = useCallback(async (question: string, retryOf?: number) => {
    const asked = question.trim();
    if (!asked || working.current) return;
    working.current = true;
    setBusy(true);
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
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Tidak dapat menjawab.';
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error } : x)));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ask(START);
  }, [ask]);

  function send() {
    if (working.current || !text.trim()) return;
    ask(text);
    setText('');
  }

  const last = turns[turns.length - 1];
  const chips = last?.answer?.suggestions.length ? last.answer.suggestions : turns.length < 2 ? FIRST : [];

  return (
    <KeyboardAvoidingView style={s.screen} behavior="padding" keyboardVerticalOffset={insets.top + 56}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => turns.length > 1 && scroll.current?.scrollToEnd({ animated: true })}
      >
        <Text style={s.lede}>
          Jawapan dikira daripada lejar masjid anda. Pembantu hanya membaca; ia tidak merekod atau
          meluluskan apa-apa.
        </Text>

        {turns.map((t) => (
          <View key={t.id} style={{ gap: 10 }}>
            <View style={s.question}>
              <Text style={s.questionText}>{t.question}</Text>
            </View>
            {t.answer ? (
              <AnswerCard a={t.answer} />
            ) : t.error ? (
              <View style={s.error} accessibilityLiveRegion="polite">
                <Text style={s.errorText}>{t.error}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cuba lagi"
                  style={s.retry}
                  onPress={() => ask(t.question, t.id)}
                >
                  <Text style={s.errorText}>Cuba lagi</Text>
                </Pressable>
              </View>
            ) : (
              <ActivityIndicator color={colors.green} style={{ alignSelf: 'flex-start' }} />
            )}
          </View>
        ))}

        {!busy && chips.length > 0 && (
          <View style={s.chips}>
            {chips.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={c}
                onPress={() => ask(c)}
                style={s.chip}
              >
                <Text style={s.chipText}>{c}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[s.bar, { paddingBottom: 12 + insets.bottom }]}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          submitBehavior="submit"
          returnKeyType="send"
          maxLength={300}
          placeholder="Tanya dalam BM atau English"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Soalan anda"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hantar"
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

function AnswerCard({ a }: { a: Answer }) {
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
  lede: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkFaint },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    backgroundColor: colors.emerald,
  },
  questionText: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.ink },
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
  send: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
  },
});
