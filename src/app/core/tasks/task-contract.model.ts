/**
 * Contrato HTTP ÚNICO de Tasks (TaxVision.Tasks.Api, ruta `/tasks` vía Gateway).
 *
 * Fuente de verdad compartida entre `features/task` y `features/clients` (pestaña Work): antes cada
 * uno tenía su copia byte-idéntica de estos tipos, así que un cambio del backend había que replicarlo
 * en dos (o tres) lugares — exactamente el tipo de drift que causó el bug de enums del Portal. Aquí
 * viven UNA sola vez y ambas features los re-exportan desde su propio `*.model.ts`.
 *
 * ⚠️ Los enums viajan como STRING (JsonStringEnumConverter global en el `Program.cs` del servicio):
 * `TaskItemStatus`/`TaskPriority` se comparan por nombre (`'Normal'`, no `'Medium'`; no hay `Blocked`).
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

// ---------- Etiquetas / taxonomías (F11) ----------

/** Una etiqueta NO se adjunta a tareas: renombra un estado por tenant (mapea a un TaskItemStatus). */
export interface TaskLabelResponse {
  id: string;
  code: string;
  displayName: string;
  mapsToStatus: ApiTaskStatus;
  labelColor: string | null;
}

export interface UpsertTaskLabelRequest {
  code: string;
  displayName: string;
  mapsToStatus: ApiTaskStatus;
  labelColor: string | null;
}

/** GET /tasks/taxonomies — enums del server + catálogo de labels del tenant. */
export interface TaskTaxonomiesResponse {
  statuses: string[];
  priorities: string[];
  labels: TaskLabelResponse[];
}

// ---------- Series / recurrencia (F9) ----------

export type SeriesStatus = 'Active' | 'Paused' | 'Ended';

/** Espejo de TaskSeriesResponse (gestión de recurrencia; las ocurrencias se leen por /tasks). */
export interface TaskSeriesResponse {
  id: string;
  rule: string | null;
  timeZoneId: string | null;
  mode: RecurrenceMode;
  status: SeriesStatus;
  title: string;
  assigneeUserId: string | null;
  anchorUtc: string;
  openInstanceId: string | null;
  generatedCount: number;
  skippedOccurrences: number;
  endsAtUtc: string | null;
  maxOccurrences: number | null;
}

/** POST /tasks/series — crear serie recurrente manual (además de las que abren las plantillas). */
export interface CreateTaskSeriesRequest {
  title: string;
  description: string | null;
  priority: ApiTaskPriority;
  customerId: string | null;
  taxYear: number | null;
  estimatedHours: number | null;
  assigneeUserId: string | null;
  isStatutory: boolean;
  rule: string | null;
  timeZoneId: string | null;
  mode: RecurrenceMode;
  anchorUtc: string;
  endsAtUtc: string | null;
  maxOccurrences: number | null;
}

// ---------- Timers (F10) ----------

export interface TaskTimerResponse {
  id: string;
  taskId: string;
  userId: string;
  startedAtUtc: string;
  stoppedAtUtc: string | null;
  durationMinutes: number | null;
  isBillable: boolean;
}

export interface StartTimerRequest {
  isBillable: boolean;
}

// ---------- Adjuntos de tarea (F5) ----------

/** Espejo de AttachmentStatus (Tasks.Domain). Nace `Pending` aunque ya esté escaneado; el front pollea. */
export type AttachmentStatus = 'Pending' | 'Available' | 'Rejected' | 'Detached';

/** Espejo de AttachmentOrigin. */
export type AttachmentOrigin = 'Linked' | 'Uploaded' | 'FromTemplate';

/** Espejo de TaxVision.Tasks.Application.Attachments.AttachmentResponse (camelCase). */
export interface TaskAttachmentResponse {
  id: string;
  taskId: string;
  fileId: string;
  displayName: string;
  contentType: string | null;
  sizeBytes: number;
  origin: AttachmentOrigin;
  status: AttachmentStatus;
  rejectionReason: string | null;
  attachedByUserId: string;
  attachedAtUtc: string;
  detachedAtUtc: string | null;
}

/** POST /tasks/{taskId}/attachments (upload → Pending) y /link (ya escaneado → Available). Mismo shape. */
export interface TaskAttachmentUpsertRequest {
  fileId: string;
  displayName: string | null;
  contentType: string | null;
  sizeBytes: number;
}

// ---------- Plantillas fiscales (F8) ----------

export interface TaskTemplateStepResponse {
  order: number;
  title: string;
  description: string | null;
  dueOffsetDays: number;
  isStatutory: boolean;
  priority: ApiTaskPriority;
  dependsOnStepOrder: number | null;
  parentStepOrder: number | null;
  suggestedRoleName: string | null;
  estimatedHours: number | null;
}

export interface TaskTemplateAttachmentResponse {
  id: string;
  fileId: string;
  displayName: string;
  contentType: string | null;
  sizeBytes: number;
  stepOrder: number | null;
}

export interface TaskTemplateResponse {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  recurrenceRule: string | null;
  recurrenceTimeZoneId: string | null;
  recurrenceMode: RecurrenceMode | null;
  steps: TaskTemplateStepResponse[];
  attachments: TaskTemplateAttachmentResponse[];
}

/** PUT /tasks/templates/{id}/attachments — reemplaza el set completo de archivos de referencia. */
export interface SaveTaskTemplateAttachmentRequest {
  fileId: string;
  displayName: string | null;
  contentType: string | null;
  sizeBytes: number;
  stepOrder: number | null;
}

export interface SaveTaskTemplateAttachmentsRequest {
  attachments: SaveTaskTemplateAttachmentRequest[];
}

/** POST /tasks/templates/{id}/apply → resultado de materializar la plantilla sobre cliente/año. */
export interface TemplateApplicationResponse {
  templateId: string;
  tasksCreated: number;
  dependenciesCreated: number;
  firstTaskId: string;
  taskIds: string[];
  seriesId: string | null;
}

/** Modo de recurrencia (espejo de RecurrenceMode). */
export type RecurrenceMode = 'FixedSchedule' | 'AfterCompletion';

/** POST/PUT /tasks/templates — autoría del guion. Con `recurrenceRule` DEBE haber exactamente 1 paso. */
export interface SaveTaskTemplateStepRequest {
  order: number;
  title: string;
  description: string | null;
  priority: ApiTaskPriority;
  estimatedHours: number | null;
  dueOffsetDays: number;
  isStatutory: boolean;
  dependsOnStepOrder: number | null;
  parentStepOrder: number | null;
  suggestedRoleName: string | null;
}

export interface SaveTaskTemplateRequest {
  name: string;
  description: string | null;
  recurrenceRule: string | null;
  recurrenceTimeZoneId: string | null;
  recurrenceMode: RecurrenceMode;
  steps: SaveTaskTemplateStepRequest[];
}

export interface SetTaskTemplateActiveRequest {
  isActive: boolean;
}

export interface ApplyTaskTemplateRequest {
  assigneeUserId: string | null;
  customerId: string | null;
  taxYear: number | null;
  /** Ancla del encargo: DueAtUtc del que se derivan los offsets de cada paso. */
  dueAtUtc: string;
  timeZoneId: string | null;
  allowDuplicate: boolean;
}

/** GET /tasks/calendar — entrada ligera por tarea con fecha (para pintar el mes). */
export interface TaskCalendarEntry {
  id: string;
  title: string;
  dueAtUtc: string;
  timeZoneId: string | null;
  isStatutory: boolean;
  status: ApiTaskStatus;
  priority: ApiTaskPriority;
  assigneeUserId: string | null;
  customerId: string | null;
  isBlocked: boolean;
}

/** GET /tasks/{id}/graph — aristas dirigidas "TaskId depende de DependsOnTaskId" (aguas arriba). */
export interface TaskDependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

export interface TaskDependencyGraphResponse {
  taskId: string;
  edges: TaskDependencyEdge[];
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

/** POST /tasks/{id}/subtasks — hereda CustomerId/TaxYear del padre (por eso no los lleva). */
export interface CreateSubtaskRequest {
  title: string;
  description: string | null;
  priority: ApiTaskPriority;
  assigneeUserId: string | null;
  dueAtUtc: string | null;
  dueTimeZoneId: string | null;
  dueIsStatutory: boolean;
  estimatedHours: number | null;
}

/** POST /tasks/{id}/dependencies — la tarea {id} pasa a depender de (ser bloqueada por) dependsOnTaskId. */
export interface AddDependencyRequest {
  dependsOnTaskId: string;
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

// ---------- Helpers de presentación (avatar estable por usuario) ----------

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
