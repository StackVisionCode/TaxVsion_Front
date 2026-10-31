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

import { parseUtcDate } from '@shared/utils/utc-date.util';

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
export type NoteAttachmentStatus = 'Pending' | 'Available' | 'Rejected' | 'Detached' | 'UnderReview';

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

/** Espejo de `NoteContent.MaxHtmlLength` (100 KB de HTML ya escapado). */
export const NOTE_MAX_HTML_LENGTH = 102_400;

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

// ---------- View-model de la pestaña ----------

export interface ClientNoteCard {
  id: string;
  authorUserId: string;
  authorName: string;
  /** Foto del autor (la pone el store desde el directorio de staff); null = iniciales. */
  authorAvatarUrl: string | null;
  /** true si la escribió el usuario logueado: habilita editar/pin/color (solo el autor puede). */
  isMine: boolean;
  createdAtUtc: string;
  /** Fecha absoluta de creación ("Oct 28, 2026, 3:45 PM") para el `title` del tiempo relativo. */
  timestamp: string;
  /**
   * `updatedAtUtc` se separó de `createdAtUtc`. OJO: el backend lo toca en CUALQUIER cambio (pin,
   * color, visibilidad, adjuntos, archivo), no solo al editar el texto: por eso se rotula "Updated".
   */
  wasUpdated: boolean;
  /** Fecha absoluta de la última modificación. */
  updatedTimestamp: string;
  html: string;
  /** Texto plano del HTML (búsqueda y "Show more"). */
  plainText: string;
  isPinned: boolean;
  isArchived: boolean;
  visibility: NoteVisibility;
  visibilityLabel: string;
  colorKind: NoteColorKind;
  colorLabel: string;
  /** Barra de acento izquierda según el color semántico ('' sin color). */
  accentClass: string;
  /** Punto del color semántico. */
  dotClass: string;
  /** Contenido, visibilidad, pin y color: SOLO el autor (`NoteVisibilityPolicy.CanEditContent`). */
  canEdit: boolean;
  /** Archivar/restaurar/borrar: autor o `notes.view_all` (`NoteVisibilityPolicy.CanManage`). */
  canManage: boolean;
  attachments: NoteAttachmentResponse[];
}

export interface NoteVisibilityOption {
  value: NoteVisibility;
  label: string;
  hint: string;
  icon: string;
  /** Clases de la insignia de la tarjeta. */
  badgeClass: string;
}

/** Orden del selector: lo habitual primero, lo que sale de la oficina al final. */
export const NOTE_VISIBILITY_OPTIONS: NoteVisibilityOption[] = [
  {
    value: 'Team',
    label: 'Team',
    hint: 'Everyone in your office can read this note.',
    icon: 'people-outline',
    badgeClass: 'border-gray-200 bg-gray-50 text-gray-600',
  },
  {
    value: 'Private',
    label: 'Only me',
    hint: 'Only you can read this note.',
    icon: 'lock-closed-outline',
    badgeClass: 'border-gray-200 bg-gray-50 text-gray-600',
  },
  {
    value: 'ClientVisible',
    label: 'Visible to client',
    hint: 'The client will be able to read this note in their portal.',
    icon: 'eye-outline',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
  },
];

export interface NoteColorOption {
  value: NoteColorKind;
  label: string;
  dotClass: string;
  accentClass: string;
}

export const NOTE_COLOR_OPTIONS: NoteColorOption[] = [
  { value: 'Default', label: 'No label', dotClass: 'bg-gray-300', accentClass: '' },
  { value: 'Important', label: 'Important', dotClass: 'bg-red-500', accentClass: 'bg-red-400' },
  { value: 'FollowUp', label: 'Follow up', dotClass: 'bg-amber-500', accentClass: 'bg-amber-400' },
  { value: 'Idea', label: 'Idea', dotClass: 'bg-violet-500', accentClass: 'bg-violet-400' },
  { value: 'Warning', label: 'Warning', dotClass: 'bg-orange-500', accentClass: 'bg-orange-400' },
  { value: 'Info', label: 'Info', dotClass: 'bg-sky-500', accentClass: 'bg-sky-400' },
];

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** HTML saneado del servidor → texto plano (sin DOM: puro y barato para ≤100 notas). */
export function noteHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, entity: string) => HTML_ENTITIES[entity] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatNoteTimestamp(value: string): string {
  return parseUtcDate(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function visibilityLabelOf(visibility: NoteVisibility): string {
  return NOTE_VISIBILITY_OPTIONS.find(option => option.value === visibility)?.label ?? visibility;
}

/**
 * `NoteResponse` → tarjeta. El backend solo devuelve `createdByUserId`, así que el nombre
 * se resuelve con el directorio de staff compartido (fallback "Team member": sin el
 * permiso `users.view` ese listado responde 403 y no hay otra fuente de nombres).
 */
export function toClientNoteCard(
  note: NoteResponse,
  userNames: ReadonlyMap<string, string>,
  currentUserId: string | null,
  hasViewAll: boolean,
  // Una nota recién creada la escribió el usuario actual por definición: se marca propia en el
  // alta optimista para que sus controles (editar/pin/adjuntar) salgan al instante, sin depender
  // de que `currentUser()` ya haya resuelto en ese milisegundo. El listado real la sobrescribe.
  forceMine = false,
): ClientNoteCard {
  const isMine = forceMine || (currentUserId !== null && note.createdByUserId === currentUserId);
  const authorName = isMine ? 'You' : userNames.get(note.createdByUserId) ?? 'Team member';
  const colorKind = note.colorKind ?? 'Default';
  const color = NOTE_COLOR_OPTIONS.find(option => option.value === colorKind) ?? NOTE_COLOR_OPTIONS[0];
  return {
    id: note.id,
    authorUserId: note.createdByUserId,
    authorName,
    authorAvatarUrl: null,
    isMine,
    createdAtUtc: note.createdAtUtc,
    timestamp: formatNoteTimestamp(note.createdAtUtc),
    wasUpdated: note.updatedAtUtc !== note.createdAtUtc,
    updatedTimestamp: formatNoteTimestamp(note.updatedAtUtc),
    html: note.contentHtml,
    plainText: noteHtmlToPlainText(note.contentHtml),
    isPinned: note.isPinned,
    isArchived: note.status === 'Archived',
    visibility: note.visibility,
    visibilityLabel: visibilityLabelOf(note.visibility),
    colorKind,
    colorLabel: color.label,
    accentClass: color.accentClass,
    dotClass: color.dotClass,
    canEdit: isMine,
    canManage: isMine || hasViewAll,
    attachments: note.attachments,
  };
}
