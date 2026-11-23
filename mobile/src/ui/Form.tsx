import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { colors, fonts, radius, space } from '../theme';

/** Shared form pieces. Large text and 48 point targets, for every age. */

export function Field({ label, hint, style, ...rest }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={f.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.inkFaint}
        style={[f.input, rest.multiline && f.multi, style]}
        {...rest}
      />
      {hint ? <Text style={f.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy,
  quiet,
  danger,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  quiet?: boolean;
  danger?: boolean;
}) {
  const color = danger ? colors.danger : quiet ? colors.ink : colors.onGreen;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      style={[f.button, quiet && f.quiet, danger && f.danger, busy && { opacity: 0.6 }]}
    >
      {busy ? <ActivityIndicator color={color} /> : <Text style={[f.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Choices<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={f.choices}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[f.choice, on && f.choiceOn]}
          >
            <Text style={[f.choiceText, on && { color: colors.onGreen }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Notice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[f.notice, { backgroundColor: ok ? colors.greenSoft : colors.dangerSoft }]}
    >
      <Text style={[f.noticeText, { color: ok ? colors.green : colors.danger }]}>{text}</Text>
    </View>
  );
}

export const form = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 60, gap: space.lg, width: '100%', maxWidth: 640, alignSelf: 'center' },
  lede: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  card: {
    padding: 16,
    gap: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  big: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  strong: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  faint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
});

const f = StyleSheet.create({
  label: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.inkSoft },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaint },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  multi: { minHeight: 88, textAlignVertical: 'top' },
  button: {
    minHeight: 54,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: colors.green,
    borderWidth: 1,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quiet: { backgroundColor: colors.surface, borderColor: colors.lineStrong },
  danger: { backgroundColor: colors.surface, borderColor: colors.danger },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.green, borderColor: colors.green },
  choiceText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  notice: { padding: 14, borderRadius: radius.md },
  noticeText: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22 },
});
