import type { StatCardDelta } from '@shared/ui/stat-cards/stat-cards.component';
import type {
  FormInsightsFunnelKey,
  FormInsightsGranularity,
} from '../data-access/form-insights.model';

const VS = 'vs prior period';
const MINUS = '−';

/** Minutos legibles: "45 min", "3.5 h", "2.1 days"; null → "—". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  if (minutes < 48 * 60) return `${trimZero(minutes / 60)} h`;
  return `${trimZero(minutes / 1440)} days`;
}

/** Tasa 0..1 como porcentaje entero; null → "—". */
export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function signed(value: number, suffix = ''): string {
  if (value > 0) return `+${value}${suffix}`;
  if (value < 0) return `${MINUS}${Math.abs(value)}${suffix}`;
  return `0${suffix}`;
}

function delta(change: number, label: string, higherIsBetter: boolean): StatCardDelta {
  if (change === 0) return { label: `No change ${VS}`, direction: 'flat', sentiment: 'neutral' };
  const improved = higherIsBetter ? change > 0 : change < 0;
  return {
    label,
    direction: change > 0 ? 'up' : 'down',
    sentiment: improved ? 'positive' : 'negative',
  };
}

/** Conteos: porcentaje contra el período anterior; sin base, la diferencia absoluta. */
export function countDelta(
  current: number,
  previous: number,
  higherIsBetter = true,
): StatCardDelta | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return delta(current, `${signed(current)} ${VS}`, higherIsBetter);
  const percent = Math.round(((current - previous) / previous) * 100);
  return delta(percent, `${signed(percent, '%')} ${VS}`, higherIsBetter);
}

/** Tasas: diferencia en puntos porcentuales. */
export function rateDelta(current: number | null, previous: number | null): StatCardDelta | null {
  if (current === null || previous === null) return null;
  const points = Math.round((current - previous) * 100);
  return delta(points, `${signed(points, ' pts')} ${VS}`, true);
}

/** Tiempos: bajar es mejorar. */
export function durationDelta(
  current: number | null,
  previous: number | null,
): StatCardDelta | null {
  if (current === null || previous === null || previous === 0) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  return delta(percent, `${signed(percent, '%')} ${VS}`, false);
}

/** Promedios pequeños (recordatorios): diferencia absoluta con un decimal; bajar es mejorar. */
export function averageDelta(
  current: number | null,
  previous: number | null,
): StatCardDelta | null {
  if (current === null || previous === null) return null;
  const change = Math.round((current - previous) * 10) / 10;
  return delta(change, `${signed(change)} ${VS}`, false);
}

export const FUNNEL_LABELS: Readonly<Record<FormInsightsFunnelKey, string>> = {
  sent: 'Sent',
  started: 'Started',
  submitted: 'Submitted',
  completed: 'Completed',
};

export const FUNNEL_HINTS: Readonly<Record<FormInsightsFunnelKey, string>> = {
  sent: 'Requests your office sent in the period.',
  started: 'Opened in the client portal, or saved progress at least once.',
  submitted: 'Submitted at least once (returned forms count once).',
  completed: 'Reviewed and marked complete by your team.',
};

const AUTOMATION_LABELS: Readonly<Record<string, string>> = {
  CreateCustomer: 'Create client',
  UpdateCustomerProfile: 'Update client profile',
  SummaryPdf: 'Summary PDF',
  Signature: 'Signature request',
};

export function automationLabel(kind: string): string {
  return AUTOMATION_LABELS[kind] ?? humanize(kind);
}

// Códigos conocidos del backend; el resto se humaniza (nunca se muestra el código crudo).
const FAILURE_LABELS: Readonly<Record<string, string>> = {
  'Customer.DuplicateFound': 'Possible duplicate client',
  'FormAction.PayloadUnavailable': 'Answers were unavailable',
  'FormAction.NotSupported': 'Action not supported',
  'FormAction.ConditionNotMet': 'Condition not met',
  link_blocked: 'Client link blocked',
  files_not_reassigned: "Files weren't moved to the client",
  signature_not_completed: 'Signature not completed',
  signature_not_configured: 'Signature not configured',
  generation_failed: 'PDF generation failed',
  request_failed: 'Signature request failed',
  unknown: 'Unknown error',
};

export function failureReasonLabel(code: string): string {
  return FAILURE_LABELS[code] ?? humanize(code.split('.').pop() ?? code);
}

function humanize(value: string): string {
  const words = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Unknown';
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** Etiqueta del bucket: el día ("Oct 3") o la semana que empieza ese día ("Wk of Oct 3"). */
export function trendLabel(start: string, granularity: FormInsightsGranularity): string {
  const label = SHORT_DATE.format(new Date(`${start}T00:00:00Z`));
  return granularity === 'Week' ? `Wk of ${label}` : label;
}

/** Desfase local del navegador en minutos (UTC-5 → -300). */
export function browserUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
