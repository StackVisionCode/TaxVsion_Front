import { describe, expect, it } from 'vitest';
import {
  ApiTaskStatus,
  TaskResponse,
  avatarColorFor,
  initialsFor,
  statusToColumn,
  toWorkTaskItem,
} from './client-work.model';

function makeResponse(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 't1',
    title: 'Prepare return',
    description: null,
    status: 'NotStarted',
    priority: 'Normal',
    createdByUserId: 'u-creator',
    assigneeUserId: null,
    customerId: 'c1',
    taxYear: null,
    dueAtUtc: null,
    dueTimeZoneId: null,
    dueIsStatutory: false,
    startedAtUtc: null,
    completedAtUtc: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
    parentTaskId: null,
    depth: 0,
    openSubtaskCount: 0,
    openBlockerCount: 0,
    isBlocked: false,
    estimatedHours: null,
    actualHours: 0,
    expectedItems: null,
    clientDueAtUtc: null,
    clientRequestedByUserId: null,
    clientRequestedAtUtc: null,
    ...overrides,
  };
}

describe('statusToColumn', () => {
  it('maps each open status to its section', () => {
    expect(statusToColumn('NotStarted')).toBe('not-started');
    expect(statusToColumn('InProgress')).toBe('in-progress');
    expect(statusToColumn('WaitingOnClient')).toBe('waiting');
    expect(statusToColumn('Completed')).toBe('completed');
  });

  it('returns null for Cancelled (no section)', () => {
    expect(statusToColumn('Cancelled')).toBeNull();
  });
});

describe('toWorkTaskItem', () => {
  it('resolves the assignee name from the map and derives initials', () => {
    const item = toWorkTaskItem(
      makeResponse({ assigneeUserId: 'u-42' }),
      new Map([['u-42', 'Carlos Castillo']]),
    );
    expect(item.assigneeName).toBe('Carlos Castillo');
    expect(item.assigneeInitials).toBe('CC');
  });

  it('falls back to "Team member" for an unknown assignee', () => {
    const item = toWorkTaskItem(makeResponse({ assigneeUserId: 'u-x' }), new Map());
    expect(item.assigneeName).toBe('Team member');
  });

  it('shows "Unassigned" with no assignee', () => {
    const item = toWorkTaskItem(makeResponse({ assigneeUserId: null }), new Map());
    expect(item.assigneeName).toBe('Unassigned');
    expect(item.assigneeInitials).toBe('—');
  });

  it('flattens the due date to YYYY-MM-DD and empty when absent', () => {
    expect(toWorkTaskItem(makeResponse({ dueAtUtc: '2026-04-15T00:00:00Z' }), new Map()).dueDate).toBe('2026-04-15');
    expect(toWorkTaskItem(makeResponse({ dueAtUtc: null }), new Map()).dueDate).toBe('');
  });

  it('marks a past due open task as overdue', () => {
    const item = toWorkTaskItem(makeResponse({ dueAtUtc: '2000-01-01T00:00:00Z', status: 'NotStarted' }), new Map());
    expect(item.overdue).toBe(true);
  });

  it('never marks a completed or cancelled task as overdue', () => {
    for (const status of ['Completed', 'Cancelled'] as ApiTaskStatus[]) {
      const item = toWorkTaskItem(makeResponse({ dueAtUtc: '2000-01-01T00:00:00Z', status }), new Map());
      expect(item.overdue).toBe(false);
    }
  });

  it('gives a Cancelled task a null column so the list can fold it apart', () => {
    expect(toWorkTaskItem(makeResponse({ status: 'Cancelled' }), new Map()).column).toBeNull();
  });

  it('carries the wait-on-client note through as expectedItems', () => {
    const item = toWorkTaskItem(makeResponse({ status: 'WaitingOnClient', expectedItems: 'W-2 and 1099' }), new Map());
    expect(item.column).toBe('waiting');
    expect(item.expectedItems).toBe('W-2 and 1099');
  });
});

describe('initialsFor', () => {
  it('uses the first and last word', () => {
    expect(initialsFor('Amanda B Martinez')).toBe('AM');
  });

  it('takes two letters of a single word', () => {
    expect(initialsFor('Madonna')).toBe('MA');
  });

  it('falls back to ? for empty input', () => {
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('avatarColorFor', () => {
  it('is stable for the same id', () => {
    expect(avatarColorFor('user-1')).toBe(avatarColorFor('user-1'));
  });
});
