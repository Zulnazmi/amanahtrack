import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { api, Proof } from '../../src/api/client';
import { fullTime } from '../../src/format';
import { colors, fonts, radius, ringgit } from '../../src/theme';
import { CheckList, HashBlock } from '../../src/ui/Evidence';
import { Icon } from '../../src/ui/Icon';
import { FadeUp, PressScale, Skeleton } from '../../src/ui/motion';

/** The seal behind one ledger entry, recomputed by the server each time you open it. */
export default function ProofScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    setProof(null);
    api
      .proof(String(reference))
      .then(setProof)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the proof'));
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
              {proof.intact ? 'Entry intact' : 'Entry does not verify'}
            </Text>
            <Text style={s.bannerSub}>
              {proof.intact
                ? 'Recomputed from the stored rows just now.'
                : 'The stored rows no longer match the seal.'}
            </Text>
          </View>
        </View>
      </FadeUp>

      <FadeUp delay={80}>
        <Text style={s.ref}>{proof.reference}</Text>
        <Text style={s.desc}>{proof.description}</Text>
        <Text style={s.meta}>
          {ringgit(proof.amount)} {'·'} sealed as entry #{proof.seq} {'·'} {fullTime(proof.sealed_at)}
        </Text>
      </FadeUp>

      <FadeUp delay={160}>
        <Text style={s.section}>CHECKS</Text>
        <View style={s.card}>
          <CheckList checks={proof.checks} />
        </View>
      </FadeUp>

      <FadeUp delay={240}>
        <Text style={s.section}>HASHES</Text>
        <View style={{ gap: 10 }}>
          <HashBlock label="SEALED CONTENT HASH" value={proof.payload_hash} />
          <HashBlock
            label="RECOMPUTED CONTENT HASH"
            value={proof.recomputed_payload_hash}
            state={proof.payload_hash === proof.recomputed_payload_hash ? 'ok' : 'bad'}
          />
          <HashBlock label="PREVIOUS SEAL" value={proof.prev_hash} />
          <HashBlock label="THIS SEAL" value={proof.chain_hash} />
        </View>
        <Text style={s.formula}>seal = SHA-256( previous seal : content hash : entry number )</Text>
      </FadeUp>

      <PressScale onPress={() => setRun((n) => n + 1)} style={s.again}>
        <Text style={s.againText}>Verify again</Text>
      </PressScale>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 80, gap: 6 },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg },
  bannerTitle: { fontFamily: fonts.display, fontSize: 16 },
  bannerSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkSoft, marginTop: 2 },
  ref: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.inkFaint, marginTop: 20 },
  desc: { fontFamily: fonts.display, fontSize: 19, letterSpacing: -0.4, color: colors.ink, marginTop: 6 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkFaint, marginTop: 6 },
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
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
  formula: { fontFamily: 'Courier', fontSize: 11, color: colors.inkFaint, marginTop: 12 },
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
