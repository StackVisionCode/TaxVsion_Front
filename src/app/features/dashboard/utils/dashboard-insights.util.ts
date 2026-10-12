import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import type { TaskItem } from '../../task/data-access/task.model';
import type { MeetingItem } from '../../meetings/data-access/meeting.model';
import type { CalendarEvent } from '../data-access/calendar.model';

/**
 * Lógica pura del dashboard "vivo" (saludo, agenda de hoy, alertas, semana, vencimientos). Sin
 * inyecciones: los widgets le pasan los datos ya cargados y `now`, así se prueba sin reloj real.
 *
 * Fechas: `TaskItem.dueDate` es la fecha de calendario que eligió el usuario ('YYYY-MM-DD'); se
 * compara contra el día LOCAL, nunca contra `toISOString()` (UTC), que por la tarde en EE. UU. ya
 * es mañana y marcaba como vencidas las tareas de hoy.
 */

const DAY_MS = 86_400_000;

export function localDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Días de calendario desde hoy hasta `iso` (negativo = ya pasó). Construye fecha local por partes. */
export function daysUntil(iso: string, now: Date): number {
  const [y, m, d] = iso.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  return Math.round((due.getTime() - startOfLocalDay(now).getTime()) / DAY_MS);
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  }
  if (hour >= 12 && hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

export function isOpenTask(task: Pick<TaskItem, 'apiStatus'>): boolean {
  return task.apiStatus !== 'Completed' && task.apiStatus !== 'Cancelled';
}

export function tasksDueOn(tasks: readonly TaskItem[], now: Date): TaskItem[] {
  const today = localDateIso(now);
  return tasks.filter(task => isOpenTask(task) && task.dueDate === today);
}

export function overdueTasks(tasks: readonly TaskItem[], now: Date): TaskItem[] {
  const today = localDateIso(now);
  return tasks.filter(task => isOpenTask(task) && !!task.dueDate && task.dueDate < today);
}

// ---------- Resumen del saludo ----------

export interface SummaryPart {
  text: string;
  link: string;
}

/** null = no se sabe (sin acceso, cargando o error): se omite en vez de afirmar un 0. */
export interface SummaryInput {
  tasksDueToday: number | null;
  meetingsToday: number | null;
  liveNow: number | null;
  unread: number | null;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

export function todaySummaryParts(input: SummaryInput): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (input.liveNow) {
    parts.push({ text: `${plural(input.liveNow, 'meeting', 'meetings')} live now`, link: '/meetings' });
  }
  if (input.tasksDueToday) {
    parts.push({ text: `${plural(input.tasksDueToday, 'task', 'tasks')} due today`, link: '/task' });
  }
  if (input.meetingsToday) {
    parts.push({ text: `${plural(input.meetingsToday, 'meeting', 'meetings')} today`, link: '/meetings' });
  }
  if (input.unread) {
    parts.push({ text: plural(input.unread, 'unread notification', 'unread notifications'), link: '/notifications' });
  }
  return parts;
}

/** Todo conocido y en cero → se puede afirmar que el día está libre. */
export function isClearDay(input: SummaryInput): boolean {
  const values = [input.tasksDueToday, input.meetingsToday, input.liveNow, input.unread];
  return values.some(v => v !== null) && values.every(v => v === null || v === 0);
}

// ---------- Agenda de hoy ----------

export type AgendaKind = 'task' | 'appointment' | 'meeting';

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  /** null = todo el día (tareas). */
  time: Date | null;
  subtitle: string;
  link: string | null;
  statutory: boolean;
  live: boolean;
}

export interface AgendaInput {
  tasks: readonly TaskItem[];
  appointments: readonly CalendarEvent[];
  meetings: readonly MeetingItem[];
}

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export function buildAgenda(input: AgendaInput, now: Date): AgendaItem[] {
  const today = localDateIso(now);

  const tasks: AgendaItem[] = tasksDueOn(input.tasks, now)
    .slice()
    .sort(
      (a, b) =>
        Number(b.dueIsStatutory) - Number(a.dueIsStatutory) ||
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
    )
    .map(task => ({
      id: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      time: null,
      subtitle: task.client || 'Task',
      link: '/task',
      statutory: task.dueIsStatutory,
      live: false,
    }));

  const appointments: AgendaItem[] = input.appointments
    .filter(event => localDateIso(event.date) === today)
    .map(event => ({
      id: `appt:${event.id}`,
      kind: 'appointment',
      title: event.title,
      time: event.date,
      subtitle: event.location || 'Appointment',
      link: null,
      statutory: false,
      live: false,
    }));

  const meetings: AgendaItem[] = input.meetings
    .filter(meeting => {
      if (meeting.status === 'live') {
        return true;
      }
      if (meeting.status !== 'upcoming') {
        return false;
      }
      const at = parseUtcDateOrNull(meeting.scheduledAt);
      return !!at && localDateIso(at) === today;
    })
    .map(meeting => ({
      id: `meeting:${meeting.id}`,
      kind: 'meeting',
      title: meeting.title,
      time: parseUtcDateOrNull(meeting.scheduledAt ?? meeting.startedAt),
      subtitle: meeting.status === 'live' ? 'Live now' : 'Video call',
      link: '/meetings',
      statutory: false,
      live: meeting.status === 'live',
    }));

  const timed = [...meetings, ...appointments].sort(
    (a, b) => Number(b.live) - Number(a.live) || (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0),
  );
  return [...timed, ...tasks];
}

// ---------- Completadas en los últimos 7 días ----------

/** El store solo trae las N completadas más recientes (`/tasks/search?status=Completed&size=50`). */
export const COMPLETED_FETCH_CAP = 50;

export interface DayBucket {
  label: string;
  dateIso: string;
  count: number;
}

export interface CompletedWeek {
  buckets: DayBucket[];
  total: number;
  max: number;
  /** El tope del fetch pudo dejar fuera completadas de la ventana: el total es un mínimo. */
  capped: boolean;
}

export function completedLast7Days(tasks: readonly TaskItem[], now: Date): CompletedWeek {
  const todayStart = startOfLocalDay(now);
  const windowStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 6);

  const buckets: DayBucket[] = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + i);
    return {
      label: day.toLocaleDateString('en-US', { weekday: 'short' }),
      dateIso: localDateIso(day),
      count: 0,
    };
  });
  const byIso = new Map(buckets.map(bucket => [bucket.dateIso, bucket]));

  const completedDates = tasks
    .filter(task => task.apiStatus === 'Completed')
    .map(task => parseUtcDateOrNull(task.completedAtUtc))
    .filter((date): date is Date => date !== null);

  for (const date of completedDates) {
    const bucket = byIso.get(localDateIso(date));
    if (bucket) {
      bucket.count++;
    }
  }

  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const oldest = completedDates.reduce<number | null>(
    (min, date) => (min === null || date.getTime() < min ? date.getTime() : min),
    null,
  );
  const capped =
    completedDates.length >= COMPLETED_FETCH_CAP && oldest !== null && oldest >= windowStart.getTime();

  return { buckets, total, max: Math.max(0, ...buckets.map(bucket => bucket.count)), capped };
}

// ---------- Vencimientos fiscales ----------

export type DeadlineTone = 'overdue' | 'soon' | 'later';

export interface DeadlineRow {
  id: string;
  title: string;
  client: string;
  customerId: string | null;
  dueDate: string;
  days: number;
  tone: DeadlineTone;
  chip: string;
}

function deadlineChip(days: number): string {
  if (days < 0) {
    return `${-days}d overdue`;
  }
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Tomorrow';
  }
  return `In ${days} days`;
}

/** Tareas estatutarias abiertas que vencen dentro de `horizonDays` (incluye las ya vencidas). */
export function upcomingDeadlines(tasks: readonly TaskItem[], now: Date, horizonDays = 30): DeadlineRow[] {
  return tasks
    .filter(task => task.dueIsStatutory && isOpenTask(task) && !!task.dueDate)
    .map(task => ({ task, days: daysUntil(task.dueDate, now) }))
    .filter(({ days }) => days <= horizonDays)
    .sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate))
    .map(({ task, days }) => ({
      id: task.id,
      title: task.title,
      client: task.client,
      customerId: task.customerId,
      dueDate: task.dueDate,
      days,
      tone: days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'later',
      chip: deadlineChip(days),
    }));
}

// ---------- Alertas ("Needs attention") ----------

export type InsightTone = 'danger' | 'warn' | 'info';

export interface Insight {
  id: string;
  count: number | null;
  label: string;
  tone: InsightTone;
  icon: string;
  link: string;
}

/** null en cualquier campo = sin acceso / sin dato: esa alerta no se muestra. */
export interface InsightsInput {
  overdueTasks: number | null;
  statutoryNext7Days: number | null;
  signaturesExpiring: number | null;
  /** Fracción usada (0-1) o null. */
  storageUsedRatio: number | null;
  /** Etiqueta del saldo cuando el wallet ESTÁ cargado y bajo; null si no aplica. */
  walletLowLabel: string | null;
  unreadChats: number | null;
}

export const STORAGE_ALERT_RATIO = 0.8;

export function buildInsights(input: InsightsInput): Insight[] {
  const insights: Insight[] = [];
  if (input.overdueTasks) {
    insights.push({
      id: 'overdue',
      count: input.overdueTasks,
      label: input.overdueTasks === 1 ? 'Overdue task' : 'Overdue tasks',
      tone: 'danger',
      icon: 'warning-outline',
      link: '/task',
    });
  }
  if (input.statutoryNext7Days) {
    insights.push({
      id: 'statutory-7d',
      count: input.statutoryNext7Days,
      label: 'Filing deadlines this week',
      tone: 'warn',
      icon: 'flag-outline',
      link: '/task',
    });
  }
  if (input.signaturesExpiring) {
    insights.push({
      id: 'signatures-expiring',
      count: input.signaturesExpiring,
      label: input.signaturesExpiring === 1 ? 'Signature request expiring' : 'Signature requests expiring',
      tone: 'warn',
      icon: 'hourglass-outline',
      link: '/signature',
    });
  }
  if (input.storageUsedRatio !== null && input.storageUsedRatio >= STORAGE_ALERT_RATIO) {
    insights.push({
      id: 'storage-high',
      count: null,
      label: `Storage ${Math.round(input.storageUsedRatio * 100)}% full`,
      tone: 'warn',
      icon: 'server-outline',
      link: '/storage',
    });
  }
  if (input.walletLowLabel) {
    insights.push({
      id: 'wallet-low',
      count: null,
      label: input.walletLowLabel,
      tone: 'warn',
      icon: 'wallet-outline',
      link: '/wallet',
    });
  }
  if (input.unreadChats) {
    insights.push({
      id: 'unread-chats',
      count: input.unreadChats,
      label: input.unreadChats === 1 ? 'Unread chat message' : 'Unread chat messages',
      tone: 'info',
      icon: 'chatbubbles-outline',
      link: '/chat',
    });
  }
  return insights;
}
