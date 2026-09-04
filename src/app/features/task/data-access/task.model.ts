/**
 * View-model del tablero Kanban + re-export del contrato HTTP compartido.
 *
 * El contrato del backend (enums, TaskResponse, PagedResult, request DTOs, EmployeeDirectoryEntry,
 * avatarColorFor/initialsFor) vive UNA sola vez en `@core/tasks/task-contract.model` y se re-exporta
 * acá para no romper a los consumidores que importan desde `./task.model`. Lo que queda en este
 * archivo es SOLO lo específico de la superficie tablero.
 */
export * from '@core/tasks/task-contract.model';

import {
  ApiTaskPriority,
  ApiTaskStatus,
  TaskResponse,
  avatarColorFor,
  initialsFor,
} from '@core/tasks/task-contract.model';

// ---------- Respuestas específicas del tablero ----------

/** GET /tasks/board — una columna por valor de TaskItemStatus, incluidas las vacías. */
export interface TaskBoardColumnResponse {
  status: ApiTaskStatus;
  tasks: TaskResponse[];
}

export interface TaskBoardApiResponse {
  columns: TaskBoardColumnResponse[];
  totalCount: number;
}

/** Subset mínimo de GET /customers para el picker de cliente (réplica, no import de features/clients). */
export interface TaskClientSummary {
  id: string;
  displayName: string;
  primaryEmail: string;
  status: 'Active' | 'Inactive' | 'Archived';
}

/** Fila mínima de GET /auth/users — solo para resolver nombre del asignado en las tarjetas (best-effort). */
export interface TaskUserSummary {
  id: string;
  name: string;
  lastName: string;
  email: string;
  isActive: boolean;
}

// ---------- View-model del tablero ----------

/**
 * Columnas del Kanban. `waiting` reemplaza al viejo `blocked`: el backend no tiene estado
 * Blocked (el bloqueo por dependencias es ortogonal) y su tercer estado es WaitingOnClient.
 * Cancelled no tiene columna: las canceladas salen del tablero.
 */
export type TaskStatus = 'not-started' | 'in-progress' | 'waiting' | 'completed';

export interface StatusColumn {
  id: TaskStatus;
  label: string;
  dotClass: string;
}

export const TASK_COLUMNS: StatusColumn[] = [
  { id: 'not-started', label: 'Not Started', dotClass: 'bg-gray-400' },
  { id: 'in-progress', label: 'In Progress', dotClass: 'bg-brand-bold' },
  { id: 'waiting', label: 'Waiting on Client', dotClass: 'bg-red-500' },
  { id: 'completed', label: 'Completed', dotClass: 'bg-emerald-500' },
];

/** Tarjeta del tablero: campos de presentación + los crudos que necesita el panel de edición. */
export interface TaskItem {
  id: string;
  title: string;
  description: string;
  /** Nombre del cliente resuelto vía GET /customers ('' si la tarea no tiene cliente). */
  client: string;
  customerId: string | null;
  /** YYYY-MM-DD (fecha UTC del vencimiento) o '' si no tiene. */
  dueDate: string;
  dueIsStatutory: boolean;
  priority: ApiTaskPriority;
  /** Columna del tablero (derivada de apiStatus). */
  status: TaskStatus;
  /** Estado real del backend — la fuente de verdad para decidir transiciones. */
  apiStatus: ApiTaskStatus;
  assigneeUserId: string | null;
  assigneeName: string;
  assigneeInitials: string;
  assigneeColor: string;
  isBlocked: boolean;
  taxYear: number | null;
  estimatedHours: number | null;
  expectedItems: string;
  completedAtUtc: string | null;
}

/** Lo que emite el panel de crear/editar; el store lo traduce a requests reales. */
export interface TaskFormValue {
  title: string;
  description: string;
  customerId: string | null;
  /** YYYY-MM-DD o ''. */
  dueDate: string;
  priority: ApiTaskPriority;
  status: TaskStatus;
  assignee: { userId: string; displayName: string } | null;
  /** Solo relevante cuando status === 'waiting' (obligatorio para el backend). */
  expectedItems: string;
}

// ---------- Mapeos ----------

export function statusToColumn(status: ApiTaskStatus): TaskStatus | null {
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

/**
 * TaskResponse → tarjeta. Devuelve null para Cancelled (sin columna). Los nombres de
 * cliente/asignado se resuelven contra los mapas id→nombre que arma el store.
 */
export function toTaskItem(
  response: TaskResponse,
  clientNameById: ReadonlyMap<string, string>,
  userNameById: ReadonlyMap<string, string>,
): TaskItem | null {
  const column = statusToColumn(response.status);
  if (column === null) {
    return null;
  }

  const assigneeName = response.assigneeUserId
    ? (userNameById.get(response.assigneeUserId) ?? 'Team member')
    : 'Unassigned';

  return {
    id: response.id,
    title: response.title,
    description: response.description ?? '',
    client: response.customerId ? (clientNameById.get(response.customerId) ?? 'Client') : '',
    customerId: response.customerId,
    dueDate: response.dueAtUtc ? response.dueAtUtc.slice(0, 10) : '',
    dueIsStatutory: response.dueIsStatutory,
    priority: response.priority,
    status: column,
    apiStatus: response.status,
    assigneeUserId: response.assigneeUserId,
    assigneeName,
    assigneeInitials: response.assigneeUserId ? initialsFor(assigneeName) : '—',
    assigneeColor: response.assigneeUserId ? avatarColorFor(response.assigneeUserId) : 'bg-gray-300',
    isBlocked: response.isBlocked,
    taxYear: response.taxYear,
    estimatedHours: response.estimatedHours,
    expectedItems: response.expectedItems ?? '',
    completedAtUtc: response.completedAtUtc,
  };
}
