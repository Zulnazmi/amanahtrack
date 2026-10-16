import type { AlertSeverity, AlertStatus } from '../api/client';
import { colors } from '../theme';

export const SEVERITY: Record<AlertSeverity, { tint: string; soft: string; label: string }> = {
  critical: { tint: colors.danger, soft: colors.dangerSoft, label: 'Critical' },
  warning: { tint: colors.brass, soft: colors.brassSoft, label: 'Warning' },
  info: { tint: '#8FB7FF', soft: 'rgba(143,183,255,0.12)', label: 'Info' },
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  escalated: 'Escalated',
};
