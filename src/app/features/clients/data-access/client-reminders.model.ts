import { parseUtcDate } from '../../../shared/utils/utc-date.util';

/**
 * Contrato de `RemindersController` (`/reminders`, servicio Reminder.Api vía Gateway).
 *
 * ⚠️ HALLAZGO CLAVE — **un recordatorio NO se puede vincular a un cliente**. El vínculo
 * de Reminder es `ReminderTarget` = (`category`, `targetId`) y `ReminderCategory` solo
 * tiene `General | Calendar | Task | Note`: no existe `Customer`. Además el VO valida que
 * `General` NO lleve `targetId` y que cualquier otra categoría SÍ lo exija, así que no hay
 * ninguna combinación legal que signifique "recordatorio de este cliente" (mandar el
 * customerId con categoría `Task`/`Calendar`/`Note` sería mentirle al contrato, y encima
 * los consumers `reminder.target_closed/target_moved` resuelven por (tenant, categoría,
 * targetId) y podrían cancelarlo).
 *
 * Tampoco hay listado filtrable: `GET /reminders/mine` y `GET /reminders/upcoming` filtran
 * por el `UserId` del JWT dentro del SQL y no aceptan ningún parámetro de target. Por eso
 * la pestaña crea con `category: 'General'` (sin target) y avisa en pantalla que la lista
 * son los recordatorios DEL USUARIO, no los de este cliente.
 *
 * Los enums viajan como STRING (JsonStringEnumConverter global).
 */

// ---------- Espejos de los enums del dominio ----------

/** Espejo de TaxVision.Reminder.Domain.ValueObjects.ReminderCategory. No incluye `Customer`. */
export type ReminderCategory = 'General' | 'Calendar' | 'Task' | 'Note';

/** Espejo de TaxVision.Reminder.Domain.Reminders.ReminderStatus. */
export type ReminderStatus = 'Scheduled' | 'Fired' | 'Snoozed' | 'Dismissed' | 'Cancelled' | 'Missed';

/** Única categoría que el dominio acepta sin `targetId` (invariante T1/T2 de `ReminderTarget`). */
export const REMINDER_DEFAULT_CATEGORY: ReminderCategory = 'General';

/** `size` máximo del controller (NormalizeSize: fuera de 1..100 cae a 20). */
export const REMINDERS_PAGE_SIZE = 100;

/** Razón canónica de cancelación del usuario (`ReminderCancellationReasons.UserRequest`); el aggregate la exige no vacía. */
export const REMINDER_CANCEL_REASON = 'user_request';

/** Tope de posposiciones del aggregate (`ReminderAggregate.MaxSnoozeCount`). */
export const REMINDER_MAX_SNOOZE_COUNT = 10;

// ---------- DTOs de la API ----------

export interface ReminderResponse {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  category: ReminderCategory;
  targetId: string | null;
  fireAtUtc: string;
  anchorAtUtc: string | null;
  leadMinutes: number | null;
  timeZone: string;
  status: ReminderStatus;
  requestKey: string;
  createdAtUtc: string;
  firedAtUtc: string | null;
  resolvedAtUtc: string | null;
  cancellationReason: string | null;
  snoozeCount: number;
}

/**
 * Body de POST /reminders. `requestKey` es OBLIGATORIA (idempotencia, ADR-R-07) y la pone
 * el cliente. `fireAtUtc` solo → schedule absoluto; `anchorAtUtc` + `leadMinutes` → anclado
 * (la UI del perfil solo crea absolutos: no hay ancla que seguir sin objetivo).
 */
export interface CreateReminderRequest {
  title: string;
  body: string | null;
  category: ReminderCategory;
  targetId: string | null;
  fireAtUtc: string | null;
  anchorAtUtc: string | null;
  leadMinutes: number | null;
  timeZone: string;
  requestKey: string;
}

export interface UpdateReminderScheduleRequest {
  fireAtUtc: string | null;
  anchorAtUtc: string | null;
  leadMinutes: number | null;
}

export interface UpdateReminderSubjectRequest {
  title: string;
  body: string | null;
}

export interface SnoozeReminderRequest {
  minutes: number;
}

export interface CancelReminderRequest {
  reason: string;
}

// ---------- View-model de la tabla ----------

export interface ClientReminderRow {
  id: string;
  title: string;
  body: string | null;
  /** Categoría real del backend (lo que la columna "Type" muestra); el alta desde el perfil siempre crea `General`. */
  category: ReminderCategory;
  status: ReminderStatus;
  statusLabel: string;
  statusChip: string;
  statusDot: string;
  fireAtUtc: string;
  fireAtLabel: string;
  /** `yyyy-MM-dd` local, para el filtro de rango de fechas. */
  fireAtLocalDate: string;
  snoozeCount: number;
  cancellationReason: string | null;
  /** PUT /subject — rechazado en estados terminales (Dismissed/Cancelled/Missed). */
  canEditSubject: boolean;
  /** PUT /schedule — solo Scheduled o Snoozed (`ChangeSchedule`). */
  canReschedule: boolean;
  /** POST /snooze — SOLO cuando ya disparó (`Snooze` exige Status == Fired) y con tope de 10. */
  canSnooze: boolean;
  /** POST /dismiss — Fired o Snoozed. */
  canDismiss: boolean;
  /** DELETE /{id} — Scheduled, Snoozed o Fired; no borra, transiciona a Cancelled. */
  canCancel: boolean;
}

export type ReminderStatusFilter = 'all' | ReminderStatus;

export const REMINDER_STATUS_FILTERS: { value: ReminderStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Scheduled', label: 'Scheduled' },
  { value: 'Fired', label: 'Fired' },
  { value: 'Snoozed', label: 'Snoozed' },
  { value: 'Dismissed', label: 'Dismissed' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Missed', label: 'Missed' },
];

/** Opciones de POST /{id}/snooze (el body es `minutes`, entero > 0). */
export const REMINDER_SNOOZE_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '1 day' },
];

const STATUS_CHIP: Record<ReminderStatus, string> = {
  Scheduled: 'border-indigo-200 text-indigo-600',
  Fired: 'border-orange-200 text-orange-500',
  Snoozed: 'border-amber-200 text-amber-600',
  Dismissed: 'border-emerald-200 text-emerald-600',
  Cancelled: 'border-gray-300 text-gray-500',
  Missed: 'border-red-200 text-red-500',
};

const STATUS_DOT: Record<ReminderStatus, string> = {
  Scheduled: 'bg-indigo-500',
  Fired: 'bg-orange-500',
  Snoozed: 'bg-amber-500',
  Dismissed: 'bg-emerald-500',
  Cancelled: 'bg-gray-400',
  Missed: 'bg-red-500',
};

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function formatReminderDateTime(fireAtUtc: string): string {
  return parseUtcDate(fireAtUtc).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `yyyy-MM-dd` en hora LOCAL (los inputs date/time del formulario trabajan en local). */
export function toLocalDateInput(fireAtUtc: string): string {
  const date = parseUtcDate(fireAtUtc);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalTimeInput(fireAtUtc: string): string {
  const date = parseUtcDate(fireAtUtc);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Fecha + hora locales del formulario → ISO en UTC con `Z`. La `Z` es imprescindible:
 * `ReminderSchedule` rechaza cualquier `DateTime` cuyo `Kind` no sea `Utc`.
 */
export function toUtcIso(localDate: string, localTime: string): string {
  return new Date(`${localDate}T${localTime || '09:00'}`).toISOString();
}

/** Clave de idempotencia de POST /reminders — obligatoria y provista por el cliente. */
export function newRequestKey(): string {
  const generator = globalThis.crypto;
  if (generator && typeof generator.randomUUID === 'function') {
    return generator.randomUUID();
  }
  return `rem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toClientReminderRow(reminder: ReminderResponse): ClientReminderRow {
  const status = reminder.status;
  const isTerminal = status === 'Dismissed' || status === 'Cancelled' || status === 'Missed';
  return {
    id: reminder.id,
    title: reminder.title,
    body: reminder.body,
    category: reminder.category,
    status,
    statusLabel: status,
    statusChip: STATUS_CHIP[status],
    statusDot: STATUS_DOT[status],
    fireAtUtc: reminder.fireAtUtc,
    fireAtLabel: formatReminderDateTime(reminder.fireAtUtc),
    fireAtLocalDate: toLocalDateInput(reminder.fireAtUtc),
    snoozeCount: reminder.snoozeCount,
    cancellationReason: reminder.cancellationReason,
    canEditSubject: !isTerminal,
    canReschedule: status === 'Scheduled' || status === 'Snoozed',
    canSnooze: status === 'Fired' && reminder.snoozeCount < REMINDER_MAX_SNOOZE_COUNT,
    canDismiss: status === 'Fired' || status === 'Snoozed',
    canCancel: status === 'Scheduled' || status === 'Snoozed' || status === 'Fired',
  };
}
