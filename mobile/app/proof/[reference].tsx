import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api, canSeeDonors, canWrite, Proof } from '../../src/api/client';
import { say, useLang } from '../../src/lang';
import { useSession } from '../../src/session';
import { Button, Field, Notice } from '../../src/ui/Form';
import { fullTime } from '../../src/format';
import { colors, fonts, radius, ringgit } from '../../src/theme';
import { CheckList, HashBlock } from '../../src/ui/Evidence';
import { Icon } from '../../src/ui/Icon';
import { FadeUp, PressScale, Skeleton } from '../../src/ui/motion';
import { stored } from '../../src/words';

/** The seal behind one ledger entry, recomputed by the server each time you open it. */
export default function ProofScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLang();
  const [technical, setTechnical] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function askReversal() {
    if (reason.trim().length < 5) {
      setNotice({ ok: false, text: t('Terangkan sebab pembetulan (sekurang-kurangnya 5 aksara).', 'Explain the correction (at least 5 characters).') });
      return;
    }
    setBusy(true);
    try {
      await api.requestReversal(String(reference), reason.trim());
      setAsking(false);
      setNotice({ ok: true, text: t('Dihantar. Orang lain perlu meluluskan pembetulan ini.', 'Sent. Someone else must approve this correction.') });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setProof(null);
    setError(null);
    api
      .proof(String(reference))
      .then(setProof)
      .catch((e) => setError(e instanceof Error ? e.message : say('Tidak dapat membaca bukti.', 'Could not load the proof.')));
  }, [reference, run]);

  if (!proof) {
    return (
      <View style={[s.screen, { padding: 20, gap: 12 }]}>
        {error ? <Text style={s.error}>{error}</Text> : (
          <>
            <Skeleton height={110} radius={20} />
            <Skeleton height={200} radius={20} />
          </>
        )}
      </View>
    );
  }

  const tint = proof.intact ? colors.green : colors.danger;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <FadeUp>
        <View style={[s.banner, { backgroundColor: proof.intact ? colors.greenSoft : colors.dangerSoft }]}>
          <Icon name={proof.intact ? 'shield' : 'alert'} size={22} color={tint} />
          <View style={{ flex: 1 }}>
            <Text style={[s.bannerTitle, { color: tint }]}>
              {proof.intact ? t('Rekod ini asli', 'This record is genuine') : t('Rekod ini tidak sepadan', 'This record does not match')}
            </Text>
            <Text style={s.bannerSub}>
              {proof.intact
                ? t('Baru disemak. Tiada apa-apa yang diubah.', 'Checked just now. Nothing has changed.')
                : t('Ia tidak lagi sama seperti semasa direkod.', 'It is no longer the same as when it was recorded.')}
            </Text>
          </View>
        </View>
      </FadeUp>

      <FadeUp delay={80}>
        <Text style={s.ref}>{proof.reference}</Text>
        <Text style={s.desc}>{stored(proof.description)}</Text>
        <Text style={s.meta}>
          {ringgit(proof.amount)} · {t('rekod', 'record')} #{proof.seq} · {fullTime(proof.sealed_at)}
        </Text>
      </FadeUp>

      <FadeUp delay={160}>
        <Text style={s.section}>{t('Semakan', 'Checks')}</Text>
        <View style={s.card}>
          <CheckList checks={proof.checks} />
        </View>
      </FadeUp>

      <FadeUp delay={240}>
        <PressScale
          accessibilityRole="button"
          onPress={() => setTechnical((v) => !v)}
          style={{ minHeight: 48, justifyContent: 'center' }}
        >
          <Text style={s.againText}>
            {technical ? t('Sembunyi butiran teknikal', 'Hide technical details') : t('Butiran teknikal', 'Technical details')}
          </Text>
        </PressScale>
        {technical && (
        <View style={{ gap: 10 }}>
          <HashBlock label={t('Kod kandungan asal', 'Sealed content hash')} value={proof.payload_hash} />
          <HashBlock
            label={t('Kod kandungan dikira semula', 'Recomputed content hash')}
            value={proof.recomputed_payload_hash}
            state={proof.payload_hash === proof.recomputed_payload_hash ? 'ok' : 'bad'}
          />
          <HashBlock label={t('Kod rekod sebelumnya', 'Previous seal')} value={proof.prev_hash} />
          <HashBlock label={t('Kod rekod ini', 'This seal')} value={proof.chain_hash} />
        <Text style={s.formula}>seal = SHA-256( previous seal : content hash : entry number )</Text>
        </View>
        )}
      </FadeUp>

      <View style={{ gap: 12, marginTop: 24 }}>
        {proof.has_receipt && canSeeDonors(session?.role) && (
          <Button label={t('Lihat resit', 'See receipt')} quiet onPress={() => router.push(`/receipt/${proof.reference}`)} />
        )}
        {proof.reversible && canWrite(session?.role) && !asking && !notice?.ok && (
          <Button label={t('Minta pembetulan', 'Ask for a correction')} quiet onPress={() => setAsking(true)} />
        )}
        {asking && (
          <>
            <Field
              label={t('Sebab pembetulan', 'Reason for the correction')}
              value={reason}
              onChangeText={setReason}
              placeholder={t('Contoh: jumlah tersilap taip', 'Example: wrong amount typed')}
              multiline
            />
            <Button label={t('Hantar untuk kelulusan', 'Send for approval')} busy={busy} onPress={askReversal} />
            <Button label={t('Batal', 'Cancel')} quiet onPress={() => setAsking(false)} />
          </>
        )}
        {notice && <Notice ok={notice.ok} text={notice.text} />}
      </View>

      <PressScale onPress={() => setRun((n) => n + 1)} style={s.again}>
        <Text style={s.againText}>{t('Semak semula', 'Check again')}</Text>
      </PressScale>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 80, gap: 6 },
  error: { fontFamily: fonts.body, fontSize: 15, color: colors.danger },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg },
  bannerTitle: { fontFamily: fonts.display, fontSize: 16 },
  bannerSub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft, marginTop: 2 },
  ref: { fontFamily: fonts.bodyBold, fontSize: 14, letterSpacing: 1.2, color: colors.inkFaint, marginTop: 20 },
  desc: { fontFamily: fonts.display, fontSize: 19, letterSpacing: -0.4, color: colors.ink, marginTop: 6 },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, marginTop: 6 },
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 1.3,
    color: colors.inkFaint,
    marginTop: 24,
    marginBottom: 10,
  },
  card: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  formula: { fontFamily: 'Courier', fontSize: 13, color: colors.inkFaint, marginTop: 12 },
  again: {
    marginTop: 24,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.inkSoft },
});
