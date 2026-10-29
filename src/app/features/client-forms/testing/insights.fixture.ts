import type {
  FormInsightsKpis,
  FormInsightsSummary,
  FormInsightsTemplateRow,
} from '../data-access/form-insights.model';

export function kpis(patch: Partial<FormInsightsKpis> = {}): FormInsightsKpis {
  return {
    sent: 0,
    started: 0,
    submitted: 0,
    completed: 0,
    cancelled: 0,
    completionRate: null,
    medianMinutesToFirstSubmission: null,
    averageRemindersPerCompleted: null,
    ...patch,
  };
}

export function insightsSummary(patch: Partial<FormInsightsSummary> = {}): FormInsightsSummary {
  return {
    period: {
      days: 30,
      fromUtc: '2026-09-29T05:00:00',
      toUtc: '2026-10-28T20:00:00',
      previousFromUtc: '2026-08-30T14:00:00',
      granularity: 'Day',
    },
    current: kpis({
      sent: 10,
      started: 8,
      submitted: 6,
      completed: 4,
      cancelled: 1,
      completionRate: 0.4,
      medianMinutesToFirstSubmission: 180,
      averageRemindersPerCompleted: 1.5,
    }),
    previous: kpis({
      sent: 8,
      started: 6,
      submitted: 5,
      completed: 4,
      completionRate: 0.5,
      medianMinutesToFirstSubmission: 240,
      averageRemindersPerCompleted: 2,
    }),
    overdueOpen: 2,
    funnel: [
      { key: 'sent', count: 10, conversionFromPrevious: null },
      { key: 'started', count: 8, conversionFromPrevious: 0.8 },
      { key: 'submitted', count: 6, conversionFromPrevious: 0.75 },
      { key: 'completed', count: 4, conversionFromPrevious: 0.6667 },
    ],
    trend: [
      { start: '2026-10-27', sent: 3, completed: 1 },
      { start: '2026-10-28', sent: 7, completed: 3 },
    ],
    participantSplit: [
      { kind: 'Customer', sent: 6, completed: 3 },
      { kind: 'External', sent: 4, completed: 1 },
    ],
    automation: [
      { kind: 'CreateCustomer', succeeded: 2, failed: 1, rejected: 1, skipped: 0, pending: 0 },
      {
        kind: 'UpdateCustomerProfile',
        succeeded: 0,
        failed: 0,
        rejected: 0,
        skipped: 0,
        pending: 0,
      },
      { kind: 'SummaryPdf', succeeded: 5, failed: 0, rejected: 0, skipped: 0, pending: 1 },
      { kind: 'Signature', succeeded: 3, failed: 1, rejected: 0, skipped: 0, pending: 0 },
    ],
    topFailureReasons: [{ kind: 'CreateCustomer', code: 'Customer.DuplicateFound', count: 1 }],
    signatures: {
      requested: 4,
      signed: 2,
      pending: 1,
      declined: 0,
      expired: 0,
      canceled: 0,
      failed: 1,
    },
    templates: [
      { templateId: 't-1', name: 'Annual intake' },
      { templateId: 't-2', name: 'Engagement letter' },
    ],
    hasAnyRequests: true,
    ...patch,
  };
}

export function templateRow(patch: Partial<FormInsightsTemplateRow> = {}): FormInsightsTemplateRow {
  return {
    templateId: 't-1',
    name: 'Annual intake',
    sent: 6,
    completed: 3,
    completionRate: 0.5,
    medianMinutesToFirstSubmission: 90,
    returns: 2,
    ...patch,
  };
}
