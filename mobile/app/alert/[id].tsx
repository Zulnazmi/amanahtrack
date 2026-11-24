import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Alert, AlertVerification, api, canReview } from '../../src/api/client';
import { fullTime } from '../../src/format';
import { say, useLang } from '../../src/lang';
import { useSession } from '../../src/session';
import { colors, fonts, radius } from '../../src/theme';
import { AuthImage } from '../../src/ui/AuthImage';
import { CheckList, HashBlock } from '../../src/ui/Evidence';
import { Icon } from '../../src/ui/Icon';
import { FadeUp, PressScale, Skeleton } from '../../src/ui/motion';
import { SEVERITY, STATUS_LABEL } from '../../src/ui/severity';
import { stored } from '../../src/words';

export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const mayReview = canReview(session?.role);
  const { t } = useLang();
  const [technical, setTechnical] = useState(false);

  const [alert, setAlert] = useState<Alert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<AlertVerification | null>(null);

  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<'acknowledge' | 'escalate' | null>(null);

  const load = useCallback(async () => {
    try {
      setAlert(await api.alert(String(id)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : say('Tidak dapat membaca amaran ini.', 'Could not load this alert.'));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function runVerify() {
    if (!alert) return;
    setResult(null);
    setVerifying(true);
    try {
      // The call is quick. Holding the spinner for a moment makes it read as a
      // check that actually ran rather than a label that flipped.
      const [r] = await Promise.all([
        api.verifyAlert(alert.id),
        new Promise((res) => setTimeout(res, 900)),
      ]);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : say('Semakan tidak berjaya.', 'The check failed.'));
    } finally {
      setVerifying(false);
    }
  }

  async function submit(action: 'acknowledge' | 'escalate') {
    if (!alert) return;
    setSaving(action);
    try {
      const updated = await api.reviewAlert(alert.id, action, note.trim());
      setAlert(updated);
      setNote('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : say('Tidak dapat menyimpan semakan anda.', 'Could not save your review.'));
    } finally {
      setSaving(null);
    }
  }

  if (!alert) {
    return (
      <View style={[s.screen, { padding: 20, gap: 12 }]}>
        {error ? (
          <Text style={s.error}>{error}</Text>
        ) : (
          <>
            <Skeleton height={230} radius={20} />
            <Skeleton height={90} radius={20} />
            <Skeleton height={140} radius={20} />
          </>
        )}
      </View>
    );
  }

  const sev = SEVERITY[alert.severity];
  const open = alert.status === 'open';
  const hashState = result
    ? result.photo_sha256 === result.recomputed_sha256
      ? 'ok'
      : 'bad'
    : undefined;

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <FadeUp>
          <View style={s.headRow}>
            <View style={[s.sevPill, { backgroundColor: sev.soft }]}>
              <Text style={[s.sevText, { color: sev.tint }]}>{sev.label.toUpperCase()}</Text>
            </View>
            <Text style={s.when}>{fullTime(alert.occurred_at)}</Text>
          </View>
          <Text style={s.title}>{stored(alert.title)}</Text>
          {!!alert.detail && <Text style={s.detail}>{stored(alert.detail)}</Text>}
          <Text style={s.source}>
            {t('Daripada', 'From')} {alert.device_label ?? t('rekod kewangan', 'the records')} · {t('amaran', 'alert')} #{alert.seq}
          </Text>
        </FadeUp>

        {alert.has_photo && (
          <FadeUp delay={100}>
            <Text style={s.section}>{t('Gambar', 'Photo')}</Text>
            <Pressable onPress={() => !photoFailed && setZoom(true)} style={s.photoWrap}>
              {photoFailed ? (
                <View style={s.photoFail}>
                  <Icon name="camera" size={26} color={colors.inkFaint} />
                  <Text style={s.photoFailText}>{t('Gambar tidak dapat dibuka', 'Could not load the photo')}</Text>
                </View>
              ) : (
                <>
                  <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.green} />
                  <AuthImage
                    alertId={alert.id}
                    style={s.photo}
                    resizeMode="cover"
                    onError={() => setPhotoFailed(true)}
                  />
                </>
              )}
            </Pressable>
            <Text style={s.photoHint}>{t('Tekan gambar untuk besarkan', 'Tap the photo to enlarge')}</Text>
          </FadeUp>
        )}

        <FadeUp delay={180}>
          <Text style={s.section}>{t('Adakah bukti ini asli?', 'Is this evidence genuine?')}</Text>
          <View style={s.card}>
            {!result && !verifying && (
              <Text style={s.verifyingText}>
                {t(
                  'Sistem akan menyemak sama ada gambar dan butiran ini pernah diubah sejak diterima.',
                  'The system will check whether this photo and its details have changed since they arrived.',
                )}
              </Text>
            )}
            {verifying ? (
              <View style={s.verifying}>
                <ActivityIndicator color={colors.green} />
                <Text style={s.verifyingText}>{t('Sedang menyemak…', 'Checking…')}</Text>
              </View>
            ) : result ? (
              <FadeUp style={{ marginTop: 16 }}>
                <View
                  style={[
                    s.banner,
                    { backgroundColor: result.intact ? colors.greenSoft : colors.dangerSoft },
                  ]}
                >
                  <Icon
                    name={result.intact ? 'shield' : 'alert'}
                    size={20}
                    color={result.intact ? colors.green : colors.danger}
                  />
                  <Text
                    style={[s.bannerText, { color: result.intact ? colors.green : colors.danger }]}
                  >
                    {result.intact
                      ? t('Bukti asli. Tiada apa-apa yang diubah.', 'Genuine. Nothing has been altered.')
                      : t('Bukti tidak sepadan. Anggap ia telah diusik.', 'It does not match. Treat it as tampered with.')}
                  </Text>
                </View>
                <View style={{ marginTop: 14 }}>
                  <CheckList checks={result.checks} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTechnical((v) => !v)}
                  style={{ minHeight: 48, justifyContent: 'center' }}
                >
                  <Text style={s.linkTitle}>
                    {technical ? t('Sembunyi butiran teknikal', 'Hide technical details') : t('Butiran teknikal', 'Technical details')}
                  </Text>
                </Pressable>
                {technical && (
                  <View style={{ gap: 10 }}>
                    <HashBlock label={t('SHA-256 semasa diterima', 'SHA-256 when it arrived')} value={alert.photo_sha256} />
                    <HashBlock
                      label={t('SHA-256 dikira semula sekarang', 'SHA-256 recomputed now')}
                      value={result.recomputed_sha256}
                      state={hashState}
                    />
                  </View>
                )}
              </FadeUp>
            ) : null}

            <PressScale onPress={runVerify} disabled={verifying} style={s.verifyBtn}>
              <Icon name="shield" size={18} color={colors.onGreen} strokeWidth={2} />
              <Text style={s.verifyBtnText}>{result ? t('Semak semula', 'Check again') : t('Semak sekarang', 'Check now')}</Text>
            </PressScale>
          </View>
        </FadeUp>

        {alert.related_reference && (
          <FadeUp delay={240}>
            <PressScale
              onPress={() => router.push(`/proof/${alert.related_reference}`)}
              style={s.link}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.linkTitle}>{t('Lihat rekod berkaitan', 'See the related record')}</Text>
                <Text style={s.linkSub}>{alert.related_reference}</Text>
              </View>
              <Icon name="chevron" size={18} color={colors.inkFaint} />
            </PressScale>
          </FadeUp>
        )}

        <FadeUp delay={300}>
          <Text style={s.section}>{t('Semakan AJK', 'Committee review')}</Text>
          <View style={s.card}>
            <View style={s.statusRow}>
              <Text style={s.statusLabel}>Status</Text>
              <View style={[s.pill, open ? s.pillOpen : s.pillDone]}>
                <Text style={[s.pillText, { color: open ? colors.brass : colors.green }]}>
                  {STATUS_LABEL[alert.status]}
                </Text>
              </View>
            </View>

            {!open && (
              <View style={s.reviewed}>
                <Text style={s.reviewedBy}>
                  {STATUS_LABEL[alert.status]} {t('oleh', 'by')} {alert.reviewed_by ?? t('penyemak', 'a reviewer')}
                  {alert.reviewed_at ? `  ·  ${fullTime(alert.reviewed_at)}` : ''}
                </Text>
                {!!alert.review_note && <Text style={s.reviewNote}>{alert.review_note}</Text>}
              </View>
            )}

            {open && mayReview && (
              <>
                <TextInput
                  style={s.note}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('Apa yang anda semak? (pilihan)', 'What did you check? (optional)')}
                  accessibilityLabel={t('Catatan semakan', 'Review note')}
                  placeholderTextColor={colors.inkFaint}
                  multiline
                  editable={!saving}
                />
                <View style={s.actions}>
                  <PressScale
                    onPress={() => submit('escalate')}
                    disabled={!!saving}
                    style={[s.btn, s.btnGhost]}
                  >
                    {saving === 'escalate' ? (
                      <ActivityIndicator color={colors.danger} />
                    ) : (
                      <Text style={[s.btnText, { color: colors.danger }]}>{t('Rujuk lanjut', 'Refer on')}</Text>
                    )}
                  </PressScale>
                  <PressScale
                    onPress={() => submit('acknowledge')}
                    disabled={!!saving}
                    style={[s.btn, s.btnSolid]}
                  >
                    {saving === 'acknowledge' ? (
                      <ActivityIndicator color={colors.onGreen} />
                    ) : (
                      <Text style={[s.btnText, { color: colors.onGreen }]}>{t('Sudah disemak', 'Reviewed')}</Text>
                    )}
                  </PressScale>
                </View>
              </>
            )}

            {open && !mayReview && (
              <Text style={s.sod}>
                {t(
                  'Bendahari boleh melihat amaran tetapi tidak boleh menutupnya. Orang yang memegang wang tidak patut mengesahkan amarannya sendiri.',
                  'Treasurers can view alerts but cannot close them. The person who handles the cash should not be the one who signs off on its alerts.',
                )}
              </Text>
            )}
          </View>
        </FadeUp>

        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>

      <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
        <Pressable style={s.modal} onPress={() => setZoom(false)}>
          <AuthImage alertId={alert.id} style={s.zoomImg} resizeMode="contain" />
          <Text style={s.zoomHint}>{t('Tekan di mana-mana untuk tutup', 'Tap anywhere to close')}</Text>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 80, gap: 6 },

  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sevPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  sevText: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.2 },
  when: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint },
  title: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5, color: colors.ink, marginTop: 12 },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 8 },
  source: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, marginTop: 10 },

  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 1.3,
    color: colors.inkFaint,
    marginTop: 24,
    marginBottom: 10,
  },

  photoWrap: {
    height: 230,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunk,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  photo: { width: '100%', height: '100%' },
  photoFail: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoFailText: { fontFamily: fonts.body, fontSize: 15, color: colors.inkFaint },
  photoHint: { fontFamily: fonts.body, fontSize: 13.5, color: colors.inkFaint, marginTop: 8, textAlign: 'center' },

  card: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  verifying: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  verifyingText: { fontFamily: fonts.body, fontSize: 15, color: colors.inkSoft, flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md },
  bannerText: { fontFamily: fonts.bodyBold, fontSize: 15, flex: 1 },
  verifyBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  verifyBtnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onGreen },

  link: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  linkTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  linkSub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, marginTop: 2 },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  pill: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999 },
  pillOpen: { backgroundColor: colors.brassSoft },
  pillDone: { backgroundColor: colors.greenSoft },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  reviewed: { marginTop: 12, gap: 4 },
  reviewedBy: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint },
  reviewNote: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  note: {
    marginTop: 14,
    minHeight: 76,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceSunk,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: colors.danger + '66', backgroundColor: colors.dangerSoft },
  btnSolid: { backgroundColor: colors.green },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15 },
  sod: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, lineHeight: 19, marginTop: 12 },

  error: { fontFamily: fonts.body, fontSize: 15, color: colors.danger, marginTop: 12 },

  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '100%', height: '80%' },
  zoomHint: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint, marginTop: 12 },
});
