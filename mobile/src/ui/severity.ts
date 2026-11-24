import type { AlertSeverity, AlertStatus } from '../api/client';
import { say } from '../lang';
import { colors } from '../theme';

export const SEVERITY: Record<AlertSeverity, { tint: string; soft: string; label: string }> = {
  critical: { tint: colors.danger, soft: colors.dangerSoft, get label() { return say('Kritikal', 'Critical'); } },
  warning: { tint: colors.brass, soft: colors.brassSoft, get label() { return say('Amaran', 'Warning'); } },
  info: { tint: '#8FB7FF', soft: 'rgba(143,183,255,0.12)', get label() { return say('Makluman', 'Info'); } },
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  get open() { return say('Belum disemak', 'Open'); },
  get acknowledged() { return say('Sudah disemak', 'Reviewed'); },
  get escalated() { return say('Dirujuk', 'Referred'); },
};
