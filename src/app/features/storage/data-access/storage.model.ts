/**
 * DTOs y view-models del feature Storage (CloudStorage.Api vía Gateway, `/storage`).
 * Los DTOs son espejos 1:1 de los records del backend (camelCase, enums como string
 * por JsonStringEnumConverter — ver TaxVision.CloudStorage.Api/Program.cs).
 */

// ---------- GET /storage/usage (StorageAdministrationController → StorageUsageResponse) ----------

/**
 * Uso/cuota del tenant. OJO: el backend NO trae desglose por categoría —
 * solo totales; el desglose del donut se computa client-side desde
 * GET /storage/files (ver StorageStore.groups).
 */
export interface StorageUsageResponse {
  planCode: string;
  usedBytes: number;
  reservedBytes: number;
  maxBytes: number;
  availableBytes: number;
  maxFileSizeBytes: number;
  isSuspended: boolean;
  allowPublicShareLinks: boolean;
}

// ---------- GET /storage/shares/shared-with-me (ShareLinksController → ShareLinkResponse) ----------

/** Espejos de TaxVision.CloudStorage.Domain.Sharing.ShareEnums. */
export type ShareResourceType = 'File' | 'Folder';
export type ShareVisibility = 'Public' | 'TenantOnly' | 'SpecificUsers' | 'TenantCustomers' | 'ExternalRecipients';
export type SharePermission = 'View' | 'Preview' | 'Download' | 'Upload' | 'EditMetadata';
export type ShareLinkEffectiveStatus = 'Active' | 'Expired' | 'Revoked' | 'Exhausted';

/**
 * Fila de GET /storage/shares/shared-with-me (y de los listados por recurso).
 * NO trae nombre de archivo ni de quien compartió — solo `resourceId` y
 * `createdByUserId`; el store los enriquece con GET /storage/files/{id} y
 * GET /auth/users/{id} respectivamente.
 */
export interface ShareLinkResponse {
  id: string;
  resourceId: string;
  resourceType: ShareResourceType;
  visibility: ShareVisibility;
  permission: SharePermission;
  tokenLast4: string;
  hasPassword: boolean;
  expiresAtUtc: string;
  maxAccessCount: number | null;
  accessCount: number;
  status: ShareLinkEffectiveStatus;
  createdByUserId: string;
  createdAtUtc: string;
  revokedAtUtc: string | null;
}

/**
 * Subset mínimo de GET /auth/users/{id} (UserSummary de Auth.Api), replicado acá
 * porque ARCHITECTURE.md prohíbe imports cross-feature (mismo criterio que
 * documents-clients.service.ts). El endpoint exige el permiso `users.view`,
 * así que la resolución de nombres es best-effort.
 */
export interface SharerSummary {
  id: string;
  name: string;
  lastName: string;
  email: string;
}

/** Fila mínima de GET /storage/recycle-bin, usada solo para el grupo "Trash". */
export interface RecycleBinEntry {
  id: string;
  originalName: string;
  sizeBytes: number;
  softDeletedAtUtc: string;
}

// ---------- Categorías (client-side) ----------

/**
 * El backend no clasifica archivos por categoría (FileResponse trae folderType
 * fiscal, no una categoría visual), así que la categoría se computa client-side
 * por extensión del nombre — misma decisión que kindFromFileName en Documents.
 */
export type StorageCategory = 'Documents' | 'Images' | 'Video & Audio' | 'Others';

export const STORAGE_CATEGORIES: StorageCategory[] = ['Documents', 'Images', 'Video & Audio', 'Others'];

/** Colores/íconos por grupo — misma paleta de acentos que el diseño original. */
export const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  Documents: { icon: 'document-text-outline', color: '#1E466B' },
  Images: { icon: 'image-outline', color: '#67BAF4' },
  'Video & Audio': { icon: 'videocam-outline', color: '#3275B3' },
  Others: { icon: 'ellipsis-horizontal-circle-outline', color: '#A8C6E0' },
  Trash: { icon: 'trash-outline', color: '#7A8794' },
};

const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'xml', 'json', 'html', 'md',
]);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'svg', 'heic']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Categoría visual por extensión (el DTO no trae ninguna). */
export function categoryFromFileName(name: string): StorageCategory {
  const ext = extensionOf(name);
  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return 'Documents';
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'Images';
  }
  if (AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
    return 'Video & Audio';
  }
  return 'Others';
}

/** Ícono ionicon por extensión — mismos glifos que usaba el mock. */
export function iconForFileName(name: string): string {
  const ext = extensionOf(name);
  if (ext === 'ppt' || ext === 'pptx') {
    return 'easel-outline';
  }
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') {
    return 'grid-outline';
  }
  if (ext === 'doc' || ext === 'docx') {
    return 'document-outline';
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image-outline';
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return 'musical-notes-outline';
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'videocam-outline';
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) {
    return 'archive-outline';
  }
  return 'document-text-outline';
}

// ---------- View models ----------

/** Tarjeta/segmento de categoría — mismo shape que consumía el diseño con seeds. */
export interface StorageGroup {
  name: string;
  icon: string;
  /** Color sólido (hex) compartido por el punto de la leyenda, el donut y el círculo de la tarjeta. */
  color: string;
  fileCount: number;
  sizeBytes: number;
  lastUpdate: string;
}

/** Fila de la tabla "Shared with me": ShareLinkResponse + metadata resuelta. */
export interface SharedWithMeItem {
  shareLinkId: string;
  resourceType: ShareResourceType;
  /** null para shares de carpeta (no hay GET folder-by-id en el backend). */
  fileId: string | null;
  name: string;
  icon: string;
  /** StorageCategory, o 'Folder' para shares de carpeta (chip gris, fuera del filtro). */
  category: string;
  permission: SharePermission;
  status: ShareLinkEffectiveStatus;
  sharedByName: string;
  sharedByInitials: string;
  /** Clase Tailwind de fondo del avatar, estable por usuario. */
  sharedByColor: string;
  sharedAtUtc: string;
  /** null cuando no se pudo resolver la metadata del archivo (o es carpeta). */
  sizeBytes: number | null;
  /** true solo si el backend emitiría el download-url: archivo Available + link Active + permiso con descarga. */
  canDownload: boolean;
}

// ---------- Formateo ----------

/** 'Jul 5, 2026' — mismo formato que la columna Date del diseño. */
export function formatShareDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** '10:15 am, Jul 2' — mismo formato que el "Last update" de las tarjetas. */
export function formatLastUpdate(iso: string): string {
  const date = new Date(iso);
  const time = date
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${time}, ${day}`;
}

/** Iniciales para el avatar de quien compartió ('Maria Alvarez' → 'MA'). */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
}

/** Paleta de avatares (misma que los contactos del mock); estable por userId. */
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

export function avatarColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
