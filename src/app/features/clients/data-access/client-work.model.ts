/**
 * Espejo del contrato HTTP de Tasks (TaxVision.Tasks.Api, ruta `/tasks` vía Gateway) para
 * la pestaña "Work" del perfil de cliente + su view-model. Autocontenido, como el resto de
 * las pestañas del perfil (notes/reminders): no importa nada de `features/task` para no
 * acoplar features; el contrato se replica igual que allí.
 *
 * El vínculo con el cliente es REAL: cada tarea lleva `customerId` (VO `TaskReference` en el
 * dominio) y el listado por cliente es `GET /tasks/by-customer/{customerId}` — no hay
 * simulación. Los enums viajan como STRING (el JSON del servicio usa nombres; el tablero
 * global ya funciona así en vivo), se comparan por nombre.
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

/** POST /tasks/{id}/cancel — el dominio rechaza cancelar sin razón (TaskErrors.CancellationReasonRequired). */
export interface CancelTaskRequest {
  reason: string;
}

export interface AssignTaskRequest {
  assigneeUserId: string;
}

/** POST /tasks/{id}/wait-on-client — `expectedItems` es obligatorio (viaja al cliente). */
export interface WaitOnClientRequest {
  expectedItems: string;
  clientDueAtUtc: string | null;
}

// ---------- Réplicas mínimas de otros servicios (sin imports cross-feature) ----------

/** Fila de GET /communication/directory/employees (mismo shape que usa el chat / el módulo Task). */
export interface EmployeeDirectoryEntry {
  userId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  actorType: string;
}

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
