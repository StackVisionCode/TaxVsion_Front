import { describe, expect, it } from 'vitest';
import type { TaskItem } from '../../task/data-access/task.model';
import type { MeetingItem } from '../../meetings/data-access/meeting.model';
import type { CalendarEvent } from '../data-access/calendar.model';
import {
  COMPLETED_FETCH_CAP,
  buildAgenda,
  buildInsights,
  completedLast7Days,
  daysUntil,
  greetingFor,
  isClearDay,
  localDateIso,
  overdueTasks,
  tasksDueOn,
  todaySummaryParts,
  upcomingDeadlines,
} from './dashboard-insights.util';

// Jueves 9 oct 2026, 21:30 hora LOCAL: en UTC ya puede ser viernes, que es justo el caso del bug.
const NOW = new Date(2026, 9, 9, 21, 30);

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: 'Task',
    description: '',
    client: '',
    customerId: null,
    dueDate: '',
    dueIsStatutory: false,
    priority: 'Normal',
    status: 'todo' as TaskItem['status'],
    apiStatus: 'NotStarted',
    assigneeUserId: null,
    assigneeName: '',
    assigneeInitials: '',
    assigneeColor: '',
    isBlocked: false,
    taxYear: null,
    estimatedHours: null,
    expectedItems: '',
    completedAtUtc: null,
    ...overrides,
  };
}

function meeting(overrides: Partial<MeetingItem>): MeetingItem {
  return {
    id: overrides.id ?? 'm1',
    title: 'Call',
    shortCode: 'abc',
    apiStatus: 'Scheduled',
    status: 'upcoming',
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    durationMinutes: null,
    endReasonLabel: null,
    joinedCount: 0,
    transcriptFileId: null,
    transcriptLanguage: null,
    hostUserId: 'u1',
    isHost: true,
    ...overrides,
  };
}

describe('fechas locales', () => {
  it('localDateIso usa el día local, no el UTC', () => {
    expect(localDateIso(NOW)).toBe('2026-10-09');
  });

  it('daysUntil cuenta días de calendario', () => {
    expect(daysUntil('2026-10-09', NOW)).toBe(0);
    expect(daysUntil('2026-10-10', NOW)).toBe(1);
    expect(daysUntil('2026-10-06', NOW)).toBe(-3);
    expect(daysUntil('2026-11-08', NOW)).toBe(30);
  });

  it('una tarea que vence hoy no cuenta como vencida a última hora del día', () => {
    const tasks = [task({ dueDate: '2026-10-09' }), task({ dueDate: '2026-10-08' })];
    expect(tasksDueOn(tasks, NOW)).toHaveLength(1);
    expect(overdueTasks(tasks, NOW).map(t => t.dueDate)).toEqual(['2026-10-08']);
  });

  it('las completadas y canceladas no cuentan', () => {
    const tasks = [
      task({ dueDate: '2026-10-01', apiStatus: 'Completed' }),
      task({ dueDate: '2026-10-01', apiStatus: 'Cancelled' }),
    ];
    expect(overdueTasks(tasks, NOW)).toHaveLength(0);
  });
});

describe('greetingFor', () => {
  it.each([
    [4, 'Good evening'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
  ])('%i h → %s', (hour, greeting) => {
    expect(greetingFor(hour)).toBe(greeting);
  });
});

describe('todaySummaryParts / isClearDay', () => {
  it('omite null y 0, pluraliza y pone lo en vivo primero', () => {
    const parts = todaySummaryParts({ tasksDueToday: 3, meetingsToday: 1, liveNow: 1, unread: 0 });
    expect(parts.map(p => p.text)).toEqual(['1 meeting live now', '3 tasks due today', '1 meeting today']);
  });

  it('día libre solo si algo se sabe y todo está en 0', () => {
    expect(isClearDay({ tasksDueToday: 0, meetingsToday: null, liveNow: null, unread: 0 })).toBe(true);
    expect(isClearDay({ tasksDueToday: null, meetingsToday: null, liveNow: null, unread: null })).toBe(false);
    expect(isClearDay({ tasksDueToday: 1, meetingsToday: 0, liveNow: 0, unread: 0 })).toBe(false);
  });
});

describe('buildAgenda', () => {
  it('en vivo primero, luego por hora, luego tareas (estatutarias y urgentes antes)', () => {
    const appointments: CalendarEvent[] = [
      { id: 'a1', title: 'Client visit', location: 'Office', date: new Date(2026, 9, 9, 15, 0), endDate: NOW },
      { id: 'a2', title: 'Yesterday', location: null, date: new Date(2026, 9, 8, 15, 0), endDate: NOW },
    ];
    const meetings = [
      meeting({ id: 'live', status: 'live', apiStatus: 'Live', startedAt: new Date(2026, 9, 9, 20, 0).toISOString() }),
      meeting({ id: 'later', scheduledAt: new Date(2026, 9, 9, 10, 0).toISOString() }),
      meeting({ id: 'tomorrow', scheduledAt: new Date(2026, 9, 10, 10, 0).toISOString() }),
    ];
    const tasks = [
      task({ id: 'low', title: 'Low', dueDate: '2026-10-09', priority: 'Low' }),
      task({ id: 'stat', title: 'Stat', dueDate: '2026-10-09', dueIsStatutory: true }),
      task({ id: 'urgent', title: 'Urgent', dueDate: '2026-10-09', priority: 'Urgent' }),
      task({ id: 'other-day', dueDate: '2026-10-10' }),
    ];

    const agenda = buildAgenda({ tasks, appointments, meetings }, NOW);

    expect(agenda.map(item => item.id)).toEqual([
      'meeting:live',
      'meeting:later',
      'appt:a1',
      'task:stat',
      'task:urgent',
      'task:low',
    ]);
    expect(agenda[0].live).toBe(true);
    expect(agenda.find(item => item.id === 'task:stat')!.statutory).toBe(true);
  });
});

describe('completedLast7Days', () => {
  it('reparte por día local (borde de medianoche incluido) y descarta lo de fuera de la ventana', () => {
    const tasks = [
      task({ apiStatus: 'Completed', completedAtUtc: new Date(2026, 9, 9, 0, 1).toISOString() }),
      task({ apiStatus: 'Completed', completedAtUtc: new Date(2026, 9, 8, 23, 59).toISOString() }),
      task({ apiStatus: 'Completed', completedAtUtc: new Date(2026, 9, 3, 12, 0).toISOString() }),
      task({ apiStatus: 'Completed', completedAtUtc: new Date(2026, 9, 2, 12, 0).toISOString() }),
      task({ apiStatus: 'InProgress', completedAtUtc: new Date(2026, 9, 9, 12, 0).toISOString() }),
    ];

    const week = completedLast7Days(tasks, NOW);

    expect(week.buckets).toHaveLength(7);
    expect(week.buckets[0].dateIso).toBe('2026-10-03');
    expect(week.buckets[6].dateIso).toBe('2026-10-09');
    expect(week.buckets.map(b => b.count)).toEqual([1, 0, 0, 0, 0, 1, 1]);
    expect(week.total).toBe(3);
    expect(week.max).toBe(1);
    expect(week.capped).toBe(false);
  });

  it('capped cuando el tope del fetch cae entero dentro de la ventana', () => {
    const tasks = Array.from({ length: COMPLETED_FETCH_CAP }, () =>
      task({ apiStatus: 'Completed', completedAtUtc: new Date(2026, 9, 8, 12, 0).toISOString() }),
    );
    expect(completedLast7Days(tasks, NOW).capped).toBe(true);
  });
});

describe('upcomingDeadlines', () => {
  it('solo estatutarias abiertas dentro del horizonte, ordenadas, con tono y chip', () => {
    const tasks = [
      task({ id: 'late', dueIsStatutory: true, dueDate: '2026-10-06' }),
      task({ id: 'today', dueIsStatutory: true, dueDate: '2026-10-09' }),
      task({ id: 'soon', dueIsStatutory: true, dueDate: '2026-10-15' }),
      task({ id: 'later', dueIsStatutory: true, dueDate: '2026-11-01' }),
      task({ id: 'far', dueIsStatutory: true, dueDate: '2026-12-31' }),
      task({ id: 'done', dueIsStatutory: true, dueDate: '2026-10-10', apiStatus: 'Completed' }),
      task({ id: 'normal', dueDate: '2026-10-10' }),
    ];

    const rows = upcomingDeadlines(tasks, NOW);

    expect(rows.map(r => [r.id, r.tone, r.chip])).toEqual([
      ['late', 'overdue', '3d overdue'],
      ['today', 'soon', 'Today'],
      ['soon', 'soon', 'In 6 days'],
      ['later', 'later', 'In 23 days'],
    ]);
  });
});

describe('buildInsights', () => {
  const none = {
    overdueTasks: null,
    statutoryNext7Days: null,
    signaturesExpiring: null,
    storageUsedRatio: null,
    walletLowLabel: null,
    unreadChats: null,
  };

  it('sin datos o en cero no muestra nada', () => {
    expect(buildInsights(none)).toEqual([]);
    expect(buildInsights({ ...none, overdueTasks: 0, unreadChats: 0, storageUsedRatio: 0.5 })).toEqual([]);
  });

  it('respeta el orden y el umbral exacto de storage', () => {
    const insights = buildInsights({
      overdueTasks: 2,
      statutoryNext7Days: 1,
      signaturesExpiring: 1,
      storageUsedRatio: 0.8,
      walletLowLabel: 'Wallet balance low · $2.00',
      unreadChats: 4,
    });
    expect(insights.map(i => i.id)).toEqual([
      'overdue',
      'statutory-7d',
      'signatures-expiring',
      'storage-high',
      'wallet-low',
      'unread-chats',
    ]);
    expect(insights.find(i => i.id === 'storage-high')!.label).toBe('Storage 80% full');
  });
});
