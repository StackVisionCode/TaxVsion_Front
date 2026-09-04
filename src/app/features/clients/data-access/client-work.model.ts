/**
 * View-model de la pestaña "Work" del perfil de cliente + re-export del contrato HTTP compartido.
 *
 * El contrato del backend (enums, TaskResponse, PagedResult, request DTOs, EmployeeDirectoryEntry,
 * avatarColorFor/initialsFor) vive UNA sola vez en `@core/tasks/task-contract.model` y se re-exporta
 * acá para no tocar a los consumidores de la pestaña. Lo que queda es SOLO lo específico de Work
 * (la lista por secciones, `WorkTaskItem` con `overdue`/`clientDueAtUtc`, y su mapeo).
 */
export * from '@core/tasks/task-contract.model';

import {
  ApiTaskPriority,
  ApiTaskStatus,
  TaskResponse,
  avatarColorFor,
  initialsFor,
} from '@core/tasks/task-contract.model';

/** Fila mínima de GET /auth/users — solo para resolver nombres de asignados (best-effort, requiere users.view). */
export interface WorkUserSummary {
  id: string;
  name: string;
  lastName: string;
  email: string;
  isActive: boolean;
}

// ---------- View-model de la pestaña ----------

/**
 * Secciones de la lista. `waiting` es WaitingOnClient (el tercer estado real; no existe
 * `Blocked`). Cancelled no tiene sección propia: se muestra aparte, plegada.
 */
export type WorkColumnId = 'not-started' | 'in-progress' | 'waiting' | 'completed';

export interface WorkStatusColumn {
  id: WorkColumnId;
  label: string;
  apiStatus: ApiTaskStatus;
  dotClass: string;
}

export const WORK_COLUMNS: WorkStatusColumn[] = [
  { id: 'not-started', label: 'Not started', apiStatus: 'NotStarted', dotClass: 'bg-gray-400' },
  { id: 'in-progress', label: 'In progress', apiStatus: 'InProgress', dotClass: 'bg-brand-bold' },
  { id: 'waiting', label: 'Waiting on client', apiStatus: 'WaitingOnClient', dotClass: 'bg-red-500' },
  { id: 'completed', label: 'Completed', apiStatus: 'Completed', dotClass: 'bg-emerald-500' },
];

/** Tarjeta de la lista: campos de presentación + los crudos que necesita el editor. */
export interface WorkTaskItem {
  id: string;
  title: string;
  description: string;
  /** YYYY-MM-DD (fecha UTC del vencimiento) o '' si no tiene. */
  dueDate: string;
  dueIsStatutory: boolean;
  overdue: boolean;
  priority: ApiTaskPriority;
  /** Sección de la lista (derivada de apiStatus); null para Cancelled. */
  column: WorkColumnId | null;
  /** Estado real del backend — la fuente de verdad para decidir transiciones. */
  apiStatus: ApiTaskStatus;
  assigneeUserId: string | null;
  assigneeName: string;
  assigneeInitials: string;
  assigneeColor: string;
  isBlocked: boolean;
  taxYear: number | null;
  expectedItems: string;
  clientDueAtUtc: string | null;
  completedAtUtc: string | null;
  createdAtUtc: string;
}

/** Lo que emite el editor; el store lo traduce a los requests reales. */
export interface WorkTaskFormValue {
  title: string;
  description: string;
  /** YYYY-MM-DD o ''. */
  dueDate: string;
  priority: ApiTaskPriority;
  status: WorkColumnId;
  assignee: { userId: string; displayName: string } | null;
  /** Solo relevante cuando status === 'waiting' (obligatorio para el backend). */
  expectedItems: string;
}

// ---------- Mapeos ----------

export function statusToColumn(status: ApiTaskStatus): WorkColumnId | null {
  switch (status) {
    case 'NotStarted':
      return 'not-started';
    case 'InProgress':
      return 'in-progress';
    case 'WaitingOnClient':
      return 'waiting';
    case 'Completed':
      return 'completed';
    case 'Cancelled':
      return null;
  }
}

/** TaskResponse → tarjeta. El nombre del asignado se resuelve contra el mapa id→nombre del store. */
export function toWorkTaskItem(response: TaskResponse, userNameById: ReadonlyMap<string, string>): WorkTaskItem {
  const column = statusToColumn(response.status);
  const dueDate = response.dueAtUtc ? response.dueAtUtc.slice(0, 10) : '';
  const assigneeName = response.assigneeUserId
    ? (userNameById.get(response.assigneeUserId) ?? 'Team member')
    : 'Unassigned';

  return {
    id: response.id,
    title: response.title,
    description: response.description ?? '',
    dueDate,
    dueIsStatutory: response.dueIsStatutory,
    overdue: isOverdue(dueDate, response.status),
    priority: response.priority,
    column,
    apiStatus: response.status,
    assigneeUserId: response.assigneeUserId,
    assigneeName,
    assigneeInitials: response.assigneeUserId ? initialsFor(assigneeName) : '—',
    assigneeColor: response.assigneeUserId ? avatarColorFor(response.assigneeUserId) : 'bg-gray-300',
    isBlocked: response.isBlocked,
    taxYear: response.taxYear,
    expectedItems: response.expectedItems ?? '',
    clientDueAtUtc: response.clientDueAtUtc,
    completedAtUtc: response.completedAtUtc,
    createdAtUtc: response.createdAtUtc,
  };
}

/** Vencida = tiene fecha, no está cerrada y la fecha ya pasó. */
function isOverdue(dueDate: string, status: ApiTaskStatus): boolean {
  if (!dueDate || status === 'Completed' || status === 'Cancelled') {
    return false;
  }
  return new Date(`${dueDate}T23:59:59`).getTime() < Date.now();
}
