import type { FormParticipantKind } from './client-forms.model';

/** Contrato de `GET tasks/forms/insights/*` (métricas de la oficina sobre las requests enviadas). */
export type FormInsightsPeriod = 7 | 30 | 90;
export type FormInsightsGranularity = 'Day' | 'Week';
export type FormInsightsFunnelKey = 'sent' | 'started' | 'submitted' | 'completed';
export type FormInsightsAutomationKind =
  'CreateCustomer' | 'UpdateCustomerProfile' | 'SummaryPdf' | 'Signature';

export interface FormInsightsKpis {
  sent: number;
  started: number;
  submitted: number;
  completed: number;
  cancelled: number;
  /** 0..1; null si no hubo enviadas. */
  completionRate: number | null;
  medianMinutesToFirstSubmission: number | null;
  averageRemindersPerCompleted: number | null;
}

export interface FormInsightsPeriodInfo {
  days: number;
  fromUtc: string;
  toUtc: string;
  previousFromUtc: string;
  granularity: FormInsightsGranularity;
}

export interface FormInsightsFunnelStep {
  key: FormInsightsFunnelKey;
  count: number;
  conversionFromPrevious: number | null;
}

export interface FormInsightsTrendPoint {
  /** Primer día local del bucket (yyyy-MM-dd). */
  start: string;
  sent: number;
  completed: number;
}

export interface FormInsightsParticipantSplit {
  kind: FormParticipantKind;
  sent: number;
  completed: number;
}

export interface FormInsightsAutomation {
  kind: FormInsightsAutomationKind | string;
  succeeded: number;
  failed: number;
  rejected: number;
  skipped: number;
  pending: number;
}

export interface FormInsightsFailureReason {
  kind: FormInsightsAutomationKind | string;
  code: string;
  count: number;
}

export interface FormInsightsSignatures {
  requested: number;
  signed: number;
  pending: number;
  declined: number;
  expired: number;
  canceled: number;
  failed: number;
}

export interface FormInsightsTemplateOption {
  templateId: string;
  name: string;
}

export interface FormInsightsSummary {
  period: FormInsightsPeriodInfo;
  current: FormInsightsKpis;
  previous: FormInsightsKpis;
  overdueOpen: number;
  funnel: FormInsightsFunnelStep[];
  trend: FormInsightsTrendPoint[];
  participantSplit: FormInsightsParticipantSplit[];
  automation: FormInsightsAutomation[];
  topFailureReasons: FormInsightsFailureReason[];
  signatures: FormInsightsSignatures;
  templates: FormInsightsTemplateOption[];
  hasAnyRequests: boolean;
}

export interface FormInsightsTemplateRow {
  templateId: string;
  name: string;
  sent: number;
  completed: number;
  completionRate: number | null;
  medianMinutesToFirstSubmission: number | null;
  returns: number;
}
