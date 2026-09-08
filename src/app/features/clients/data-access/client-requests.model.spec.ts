import { describe, expect, it } from 'vitest';
import {
  ClientRequestResponse,
  ClientRequestStatus,
  requestStatusLabel,
  toClientRequestItem,
} from './client-requests.model';

function makeResponse(overrides: Partial<ClientRequestResponse> = {}): ClientRequestResponse {
  return {
    id: 'r1',
    customerId: 'c1',
    taskId: null,
    title: 'W-2 2025',
    details: null,
    status: 'Pending',
    dueAtUtc: null,
    requestedByUserId: 'u1',
    createdAtUtc: '2026-02-01T00:00:00Z',
    submittedAtUtc: null,
    resolvedAtUtc: null,
    resolutionNote: null,
    documents: [],
    ...overrides,
  };
}

describe('toClientRequestItem', () => {
  it('marks Pending and Submitted as open', () => {
    expect(toClientRequestItem(makeResponse({ status: 'Pending' })).isOpen).toBe(true);
    expect(toClientRequestItem(makeResponse({ status: 'Submitted' })).isOpen).toBe(true);
  });

  it('marks terminal statuses as closed', () => {
    for (const status of ['Accepted', 'Rejected', 'Cancelled'] as ClientRequestStatus[]) {
      expect(toClientRequestItem(makeResponse({ status })).isOpen).toBe(false);
    }
  });

  it('only allows resolving a Submitted request', () => {
    expect(toClientRequestItem(makeResponse({ status: 'Submitted' })).canResolve).toBe(true);
    expect(toClientRequestItem(makeResponse({ status: 'Pending' })).canResolve).toBe(false);
    expect(toClientRequestItem(makeResponse({ status: 'Accepted' })).canResolve).toBe(false);
  });

  it('counts documents but ignores detached ones', () => {
    const item = toClientRequestItem(
      makeResponse({
        documents: [
          { id: 'd1', fileId: 'f1', displayName: 'a.pdf', contentType: null, sizeBytes: 10, status: 'Available', uploadedAtUtc: 'x' },
          { id: 'd2', fileId: 'f2', displayName: 'b.pdf', contentType: null, sizeBytes: 10, status: 'Detached', uploadedAtUtc: 'x' },
        ],
      }),
    );
    expect(item.documentCount).toBe(1);
  });

  it('flattens the due date to YYYY-MM-DD', () => {
    expect(toClientRequestItem(makeResponse({ dueAtUtc: '2026-04-15T00:00:00Z' })).dueDate).toBe('2026-04-15');
  });
});

describe('requestStatusLabel', () => {
  it('speaks in the staff\'s language', () => {
    expect(requestStatusLabel('Pending')).toBe('Awaiting client');
    expect(requestStatusLabel('Submitted')).toBe('Submitted — review');
  });
});
