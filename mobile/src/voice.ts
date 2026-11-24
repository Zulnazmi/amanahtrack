import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import type { Lang } from './speakable';

/**
 * Hearing and speaking, both done by the phone.
 *
 * The microphone opens only on a tap and closes when the person stops talking,
 * leaves the screen or leaves the app. The words are shown before they are sent
 * as a question, with a moment to stop them.
 */

const LISTEN_LIMIT_MS = 30000;

const PROBLEMS: Record<string, string> = {
  'not-allowed': 'Mikrofon tidak dibenarkan. Benarkan dalam tetapan telefon, atau taip soalan anda.',
  'service-not-allowed': 'Pengecaman suara dimatikan pada telefon ini. Sila taip soalan anda.',
  'language-not-supported': 'Telefon ini tiada pengecaman suara untuk bahasa itu. Cuba bahasa lain atau taip.',
  'no-speech': 'Tiada suara didengar. Cuba lagi.',
  'speech-timeout': 'Tiada suara didengar. Cuba lagi.',
  network: 'Pengecaman suara perlukan internet. Semak sambungan atau taip soalan anda.',
  'audio-capture': 'Mikrofon tidak dapat digunakan. Sila taip soalan anda.',
  busy: 'Pengecaman suara sedang digunakan. Cuba sebentar lagi.',
};
const UNKNOWN = 'Pengecaman suara tidak berjaya. Cuba lagi atau taip soalan anda.';

export function useListening(
  onWords: (words: string) => void,
  onFinished: () => void,
  onLoudness: (level: number) => void,
) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Each tap gets a number, so a late permission answer cannot open the mic
  // after the person has left.
  const turn = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True from opening the microphone until it ends, so words that arrive late
  // cannot overwrite a question already corrected or sent.
  const open = useRef(false);

  // Only a clean ending sends a question; an error leaves the words to be checked.
  const failed = useRef(false);

  const closed = useCallback(() => {
    open.current = false;
    if (limit.current) clearTimeout(limit.current);
    limit.current = null;
  }, []);

  const cancel = useCallback(() => {
    turn.current += 1;
    closed();
    setListening(false);
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // nothing was listening
    }
  }, [closed]);

  useSpeechRecognitionEvent('result', (e) => {
    if (!open.current) return;
    const words = e.results[0]?.transcript?.trim();
    if (words) onWords(words.slice(0, 300));
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (!open.current) return;
    failed.current = true;
    if (e.error !== 'aborted') setProblem(PROBLEMS[e.error] ?? UNKNOWN);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!open.current) return;
    closed();
    setListening(false);
    if (!failed.current) onFinished();
  });
  useSpeechRecognitionEvent('volumechange', (e) => {
    if (open.current) onLoudness(Math.max(0, Math.min(1, e.value / 8)));
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // Android reports "inactive" for its own permission box, so only
      // a real move to the background closes the microphone.
      if (s === 'background') cancel();
    });
    return () => {
      sub.remove();
      cancel();
    };
  }, [cancel]);

  const start = useCallback(
    async (lang: Lang) => {
      const mine = ++turn.current;
      setProblem(null);
      setListening(true);
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          setListening(false);
          setProblem('Telefon ini tiada pengecaman suara. Sila taip soalan anda.');
          return;
        }
        const allowed = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (mine !== turn.current) return;
        if (!allowed.granted) {
          setListening(false);
          setProblem(PROBLEMS['not-allowed']);
          return;
        }
        await Speech.stop();
        if (mine !== turn.current) return;
        open.current = true;
        failed.current = false;
        limit.current = setTimeout(cancel, LISTEN_LIMIT_MS);
        ExpoSpeechRecognitionModule.start({
          lang: lang === 'en' ? 'en-US' : 'ms-MY',
          interimResults: true,
          continuous: false,
          maxAlternatives: 1,
          volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
        });
      } catch {
        if (mine !== turn.current) return;
        closed();
        setListening(false);
        setProblem(UNKNOWN);
      }
    },
    [cancel, closed],
  );

  const stop = useCallback(() => {
    // A tap before the microphone has opened means "never mind"
    if (!open.current) cancel();
    else ExpoSpeechRecognitionModule.stop();
  }, [cancel]);

  return { listening, problem, setProblem, start, stop, cancel };
}

/** Malay, or Indonesian, which reads Malay far better than an English voice. */
async function voiceFor(lang: Lang): Promise<string | null> {
  const wanted = lang === 'en' ? ['en'] : ['ms', 'id', 'in'];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
    for (const code of wanted) {
      const voice = voices.find((v) => v.language.toLowerCase().split(/[-_]/)[0] === code);
      if (voice) return voice.language.replace('_', '-');
    }
    // Android may list no voices until its speech engine has started
    if (voices.length > 0) return null;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

export function useSpeaking(onWord: () => void) {
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [silent, setSilent] = useState<string | null>(null);
  const turn = useRef(0);

  const hush = useCallback(() => {
    turn.current += 1;
    setSpeaking(null);
    Speech.stop().catch(() => {});
  }, []);

  const speak = useCallback(
    async (id: number, text: string, lang: Lang) => {
      hush();
      const mine = turn.current;
      setSilent(null);
      setSpeaking(id);
      const language = await voiceFor(lang);
      if (mine !== turn.current) return;
      if (!language) {
        setSpeaking(null);
        setSilent(
          lang === 'en'
            ? 'This phone has no English voice installed.'
            : 'Telefon ini tiada suara Melayu. Pasang dalam tetapan teks ke pertuturan telefon.',
        );
        return;
      }
      const done = () => {
        if (mine === turn.current) setSpeaking(null);
      };
      Speech.speak(text.slice(0, Math.min(Speech.maxSpeechInputLength || 3900, 3900)), {
        language,
        rate: 0.95,
        onBoundary: () => {
          if (mine === turn.current) onWord();
        },
        onDone: done,
        onStopped: done,
        onError: done,
      });
    },
    [hush, onWord],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') hush();
    });
    return () => {
      sub.remove();
      hush();
    };
  }, [hush]);

  return { speaking, silent, speak, hush };
}
