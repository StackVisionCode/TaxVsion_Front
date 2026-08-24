/**
 * Espejos del contrato HTTP de Tasks (TaxVision.Tasks.Api, ruta `/tasks` vía Gateway)
 * + view-model del tablero. Los enums viajan como STRING (JsonStringEnumConverter en
 * Program.cs del servicio): `TaskItemStatus` y `TaskPriority` se comparan por nombre.
 */

// ---------- Enums del backend (TaxVision.Tasks.Domain) ----------

/** Espejo de TaskItemStatus. No hay `Blocked`: el bloqueo es `isBlocked` (contador de dependencias). */
export type ApiTaskStatus = 'NotStarted' | 'InProgress' | 'WaitingOnClient' | 'Completed' | 'Cancelled';

/** Espejo de TaskPriority. Ojo: es `Normal`, no `Medium`. */
export type ApiTaskPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

// ---------- Respuestas ----------

/** Espejo de TaxVision.Tasks.Application.Tasks.TaskResponse (camelCase). */
export interface TaskResponse {
  id: string;
  title: string;
  description: string | null;
  status: ApiTaskStatus;
  priority: ApiTaskPriority;
  createdByUserId: string;
  assigneeUserId: string | null;
  customerId: string | null;
  taxYear: number | null;
  dueAtUtc: string | null;
  dueTimeZoneId: string | null;
  dueIsStatutory: boolean;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  createdAtUtc: string;
  parentTaskId: string | null;
  depth: number;
  openSubtaskCount: number;
  openBlockerCount: number;
  isBlocked: boolean;
  estimatedHours: number | null;
  actualHours: number;
  expectedItems: string | null;
  clientDueAtUtc: string | null;
  clientRequestedByUserId: string | null;
  clientRequestedAtUtc: string | null;
}

/** GET /tasks/board — una columna por valor de TaskItemStatus, incluidas las vacías. */
export interface TaskBoardColumnResponse {
  status: ApiTaskStatus;
  tasks: TaskResponse[];
}

export interface TaskBoardApiResponse {
  columns: TaskBoardColumnResponse[];
  totalCount: number;
}

/** Espejo de BuildingBlocks.Common.PagedResult<T> (campo `size`, no `pageSize`). */
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

// ---------- Requests (TaxVision.Tasks.Api.Requests) ----------

export interface CreateTaskRequest {
  title: string;
  description: string | null;
  priority: ApiTaskPriority;
  assigneeUserId: string | null;
  customerId: string | null;
  taxYear: number | null;
  dueAtUtc: string | null;
  dueTimeZoneId: string | null;
  dueIsStatutory: boolean;
  estimatedHours: number | null;
}

export interface UpdateTaskDetailsRequest {
  title: string;
  description: string | null;
}

export interface ChangeTaskPriorityRequest {
  priority: ApiTaskPriority;
}

export interface ChangeTaskDueRequest {
  dueAtUtc: string | null;
  timeZoneId: string | null;
  isStatutory: boolean;
  statutoryChangeReason: string | null;
}

export interface CancelTaskRequest {
  /** Obligatoria: el dominio rechaza cancelar sin razón (TaskErrors.CancellationReasonRequired). */
  reason: string;
}

export interface AssignTaskRequest {
  assigneeUserId: string;
}

/** POST /tasks/{id}/wait-on-client — `expectedItems` es obligatorio (viaja al correo del cliente). */
export interface WaitOnClientRequest {
  expectedItems: string;
  clientDueAtUtc: string | null;
}

// ---------- Réplicas mínimas de otros servicios (sin imports cross-feature) ----------

/** Fila de GET /communication/directory/employees (mismo shape que usa el chat). */
export interface EmployeeDirectoryEntry {
  userId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  actorType: string;
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

const AVATAR_COLORS = [
  'bg-brand-bold',
  'bg-sky-700',
  'bg-brand-ink',
  'bg-slate-500',
  'bg-indigo-400',
  'bg-cyan-800',
  'bg-slate-700',
  'bg-indigo-600',
];

/** Color estable por usuario: hash simple del userId sobre la paleta de avatares. */
export function avatarColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
