/**
 * Contrato de `NotesController` (`/notes`, servicio Notes.Api vía Gateway).
 *
 * El vínculo nota ↔ cliente es la referencia polimórfica `NoteReference`
 * (`targetType` + `targetId`): una nota del perfil de cliente es siempre
 * `targetType: 'Customer'` + `targetId: <customerId>`, y ese mismo par es el
 * filtro de `GET /notes?targetType=Customer&targetId=...`. El backend NO valida
 * que el customer exista (validación "soft", solo loguea si la proyección va
 * atrasada), así que basta con mandar el id del cliente del perfil.
 *
 * Todos los enums viajan como STRING (JsonStringEnumConverter global).
 */

import { parseUtcDate } from '../../../shared/utils/utc-date.util';

// ---------- Espejos de los enums del dominio ----------

/** Espejo de TaxVision.Notes.Domain.Notes.NoteTargetType. */
export type NoteTargetType =
  | 'None'
  | 'Customer'
  | 'Task'
  | 'Appointment'
  | 'Meeting'
  | 'SignatureRequest'
  | 'Employee'
  | 'TaxCase'
  | 'Tenant';

/** Espejo de TaxVision.Notes.Domain.Notes.NoteVisibility. */
export type NoteVisibility = 'Private' | 'Team' | 'ClientVisible';

/** Espejo de TaxVision.Notes.Domain.ValueObjects.NoteColorKind — paleta semántica; el hex vive acá, en el front. */
export type NoteColorKind = 'Default' | 'Important' | 'FollowUp' | 'Idea' | 'Warning' | 'Info';

/** Espejo de TaxVision.Notes.Domain.Notes.NoteStatus. `Deleted` nunca llega al staff sin `notes.view_all`. */
export type NoteStatus = 'Active' | 'Archived' | 'Deleted';

/** Espejo de NoteAttachment.Status (se serializa con `.ToString()`, no como enum tipado). */
export type NoteAttachmentStatus = 'Pending' | 'Available' | 'Rejected' | 'Detached';

/** Body de POST /notes/{id}/attachments — enlaza un fileId ya subido a CloudStorage (Caso B). */
export interface AttachFileToNoteRequest {
  cloudStorageFileId: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
}

/** Target de las notas de esta pestaña: siempre el cliente del perfil. */
export const CLIENT_NOTE_TARGET_TYPE: NoteTargetType = 'Customer';

/** `size` máximo que acepta el controller (NormalizeSize: fuera de 1..100 cae a 20). */
export const NOTES_PAGE_SIZE = 100;

// ---------- DTOs de la API ----------

export interface NoteAttachmentResponse {
  id: string;
  cloudStorageFileId: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  status: NoteAttachmentStatus;
  rejectionReason: string | null;
  linkedAtUtc: string;
}

/** Respuesta de todos los endpoints de nota (create, get, y cada acción devuelve la nota completa). */
export interface NoteResponse {
  id: string;
  tenantId: string;
  createdByUserId: string;
  contentHtml: string;
  /** Texto plano derivado del HTML, cortado a 280 chars — lo usa el backend para buscar. */
  contentPreview: string;
  targetType: NoteTargetType;
  targetId: string | null;
  visibility: NoteVisibility;
  colorKind: NoteColorKind | null;
  isPinned: boolean;
  status: NoteStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
  attachments: NoteAttachmentResponse[];
}

/** Body de POST /notes. `html` se sanitiza en el servidor (Ganss.Xss) antes de guardarse. */
export interface CreateNoteRequest {
  html: string;
  targetType: NoteTargetType;
  targetId: string | null;
  visibility: NoteVisibility;
  colorKind: NoteColorKind | null;
}

export interface UpdateNoteContentRequest {
  html: string;
}

export interface ChangeNoteVisibilityRequest {
  visibility: NoteVisibility;
}

export interface SetNoteColorRequest {
  colorKind: NoteColorKind | null;
}

/** Fila mínima de GET /auth/users — solo para resolver el nombre del autor. */
export interface NoteAuthorSummary {
  id: string;
  name: string;
  lastName: string;
}

// ---------- View-model de la pestaña ----------

export interface ClientNoteCard {
  id: string;
  authorUserId: string;
  authorName: string;
  /** true si la escribió el usuario logueado: habilita editar/pin/color (solo el autor puede). */
  isMine: boolean;
  avatarColor: string;
  timestamp: string;
  /** Marca "edited" solo cuando updatedAtUtc se separó de createdAtUtc. */
  edited: boolean;
  html: string;
  isPinned: boolean;
  isArchived: boolean;
  visibility: NoteVisibility;
  visibilityLabel: string;
  colorKind: NoteColorKind;
  /** Clases del borde/fondo de la tarjeta según el color semántico. */
  cardClass: string;
  /** Contenido, visibilidad, pin y color: SOLO el autor (`NoteVisibilityPolicy.CanEditContent`). */
  canEdit: boolean;
  /** Archivar/restaurar/borrar: autor o `notes.view_all` (`NoteVisibilityPolicy.CanManage`). */
  canManage: boolean;
  attachments: NoteAttachmentResponse[];
}

export const NOTE_VISIBILITY_OPTIONS: { value: NoteVisibility; label: string; hint: string }[] = [
  { value: 'Team', label: 'Team', hint: 'Visible for everyone in the office' },
  { value: 'Private', label: 'Private', hint: 'Only you can read it' },
  { value: 'ClientVisible', label: 'Client visible', hint: 'The client sees it in their portal' },
];

export const NOTE_COLOR_OPTIONS: { value: NoteColorKind; label: string; dotClass: string }[] = [
  { value: 'Default', label: 'None', dotClass: 'bg-gray-300' },
  { value: 'Important', label: 'Important', dotClass: 'bg-red-500' },
  { value: 'FollowUp', label: 'Follow up', dotClass: 'bg-amber-500' },
  { value: 'Idea', label: 'Idea', dotClass: 'bg-violet-500' },
  { value: 'Warning', label: 'Warning', dotClass: 'bg-orange-500' },
  { value: 'Info', label: 'Info', dotClass: 'bg-sky-500' },
];

const NOTE_COLOR_CARD_CLASS: Record<NoteColorKind, string> = {
  Default: 'border-gray-100',
  Important: 'border-red-200 bg-red-50/50',
  FollowUp: 'border-amber-200 bg-amber-50/50',
  Idea: 'border-violet-200 bg-violet-50/50',
  Warning: 'border-orange-200 bg-orange-50/50',
  Info: 'border-sky-200 bg-sky-50/50',
};

/** Paleta de avatares del mock original; se elige de forma determinista por autor. */
const AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

export function formatNoteTimestamp(value: string): string {
  return parseUtcDate(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function avatarColorFor(userId: string, isMine: boolean): string {
  if (isMine) {
    return 'bg-brand-bold';
  }
  // Hash barato y estable: el mismo autor conserva su color entre recargas.
  const seed = [...userId].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_COLORS[seed % AVATAR_COLORS.length];
}

function visibilityLabelOf(visibility: NoteVisibility): string {
  return NOTE_VISIBILITY_OPTIONS.find(option => option.value === visibility)?.label ?? visibility;
}

/**
 * `NoteResponse` → tarjeta. El backend solo devuelve `createdByUserId`, así que el nombre
 * se resuelve con el mapa best-effort de GET /auth/users (fallback "Team member": sin el
 * permiso `users.view` ese listado responde 403 y no hay otra fuente de nombres).
 */
export function toClientNoteCard(
  note: NoteResponse,
  userNames: ReadonlyMap<string, string>,
  currentUserId: string | null,
  hasViewAll: boolean,
): ClientNoteCard {
  const isMine = currentUserId !== null && note.createdByUserId === currentUserId;
  const authorName = isMine ? 'You' : userNames.get(note.createdByUserId) ?? 'Team member';
  const colorKind = note.colorKind ?? 'Default';
  return {
    id: note.id,
    authorUserId: note.createdByUserId,
    authorName,
    isMine,
    avatarColor: avatarColorFor(note.createdByUserId, isMine),
    timestamp: formatNoteTimestamp(note.createdAtUtc),
    edited: note.updatedAtUtc !== note.createdAtUtc,
    html: note.contentHtml,
    isPinned: note.isPinned,
    isArchived: note.status === 'Archived',
    visibility: note.visibility,
    visibilityLabel: visibilityLabelOf(note.visibility),
    colorKind,
    cardClass: NOTE_COLOR_CARD_CLASS[colorKind],
    canEdit: isMine,
    canManage: isMine || hasViewAll,
    attachments: note.attachments,
  };
}
