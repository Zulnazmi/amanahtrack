/**
 * Design tokens, "Midnight Emerald".
 *
 * Dark first. The key names are the same as the old light theme on purpose,
 * so screens that have not been redesigned yet (spend, count, ledger) pick up
 * the new palette automatically instead of breaking.
 */

export const colors = {
  // text
  ink: '#ECF5F1',
  inkSoft: '#C7D8D0',
  inkFaint: '#8CA39A',

  // backgrounds
  paper: '#06100D',
  surface: '#0D1A16',
  surfaceSunk: '#10211C',
  surfaceRaised: '#0F201B',

  // lines
  line: '#1B2C27',
  lineStrong: '#22372F',

  // brand
  green: '#4FE3A8', // mint, the main accent
  greenSoft: 'rgba(79,227,168,0.12)',
  emerald: '#0F5C43',
  onGreen: '#04130D', // text that sits on mint

  // provisional / estimated
  brass: '#F0C674',
  brassSoft: 'rgba(240,198,116,0.12)',

  // blocked / error
  danger: '#FF7A6B',
  dangerSoft: 'rgba(255,122,107,0.12)',

  warn: '#F0C674',
  warnSoft: 'rgba(240,198,116,0.12)',

  // fund colours used on the home screen split bar and rows
  fund: {
    waqf: '#4FE3A8',
    zakat: '#2E9E86',
    sadaqah: '#F0C674',
    infaq: '#8FB7FF',
    khairat: '#C9D6D0',
    other: '#8CA39A',
  },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 24,
} as const;

/** Font family names as registered by expo-font in app/_layout.tsx. */
export const fonts = {
  display: 'Sora_600SemiBold',
  displayBold: 'Sora_700Bold',
  displayLight: 'Sora_400Regular',
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemi: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.6 },
  title: { fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.bodySemi, fontSize: 16 },
  body: { fontFamily: fonts.body, fontSize: 15 },
  small: { fontFamily: fonts.body, fontSize: 13 },
  micro: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2 },
  mono: { fontSize: 12, fontFamily: 'Courier' },
} as const;

export const brand = {
  name: 'AmanahTrack',
  tagline: 'DONATION INTEGRITY PLATFORM',
  copyright: '© 2026 AmanahTrack. All rights reserved.',
  trademark: 'AmanahTrack and the arch mark are trademarks of AmanahTrack.',
  version: 'v1.0',
} as const;

export function ringgit(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `RM ${n.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
