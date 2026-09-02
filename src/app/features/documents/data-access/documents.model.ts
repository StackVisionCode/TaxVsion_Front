import { FileResponse, FileStatus, FolderType, OwnerType } from '@core/cloud-storage/cloud-storage.model';

export type { OwnerType, FolderType, FileStatus, FileResponse, InitiateUploadRequest, InitiatedUploadResponse, DownloadUrlResponse } from '@core/cloud-storage/cloud-storage.model';
export { isFilePending, formatBytes } from '@core/cloud-storage/cloud-storage.model';

/** GET /storage/folders (subcarpeta) y respuesta de POST /storage/folders. */
export interface FolderResponse {
  id: string;
  ownerType: OwnerType;
  ownerId: string | null;
  parentFolderId: string | null;
  name: string;
  relativePath: string;
  category: string | null;
  createdAtUtc: string;
}

/** GET /storage/folders?parentFolderId=&ownerType=&ownerId= */
export interface FolderContentsResponse {
  subfolders: FolderResponse[];
  files: FileResponse[];
}

/** Body de POST /storage/folders. */
export interface CreateFolderRequest {
  parentFolderId: string | null;
  name: string;
  ownerType: OwnerType;
  ownerId: string;
  category?: string | null;
}

/** Fila de GET /storage/recycle-bin. */
export interface RecycleBinItemResponse {
  id: string;
  ownerType: OwnerType;
  ownerId: string | null;
  folderType: FolderType;
  originalName: string;
  sizeBytes: number;
  softDeletedAtUtc: string;
  softDeleteExpiresAtUtc: string;
}

// ---------- Formateo para UI ----------

export type FileKind = 'pdf' | 'xlsx' | 'img' | 'doc';

/** Igual al mock original: por extensión, no por contentType (más fiel a lo que ve el usuario). */
export function kindFromFileName(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return 'xlsx';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    return 'img';
  }
  if (['doc', 'docx'].includes(ext)) {
    return 'doc';
  }
  return 'pdf';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------- Workspace (gestor documental de toda la oficina) ----------

/** Secciones del navegador del workspace. */
export type WorkspaceSection = 'office' | 'client' | 'recent' | 'shared' | 'trash';

/**
 * Contexto activo del workspace. `office` = archivos de la oficina (ownerType Tenant);
 * `client` = los de un customer (ownerType Customer + ese ownerId). El cliente es un
 * CONTEXTO dentro del gestor, no una pantalla previa.
 */
export interface WorkspaceContext {
  section: WorkspaceSection;
  clientId: string | null;
  clientName: string | null;
}

/** GET /storage/folders/tree — nodo del árbol lógico de carpetas de un dueño. */
export interface FolderTreeNode {
  id: string;
  name: string;
  relativePath: string;
  category: string | null;
  children: FolderTreeNode[];
}

/** GET /storage/usage — cuota/uso del tenant. */
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

/** Estado "amable" que ve el preparador — nunca el FileStatus técnico del backend. */
export type FileDisplayStatus = 'uploading' | 'processing' | 'ready' | 'blocked';

/** Traduce el FileStatus del backend al estado visible (sin jerga técnica). */
export function displayStatus(status: FileStatus): FileDisplayStatus {
  if (status === 'Available') {
    return 'ready';
  }
  if (status === 'Infected' || status === 'BlockedByPolicy') {
    return 'blocked';
  }
  if (status === 'PendingUpload') {
    return 'uploading';
  }
  return 'processing';
}

/** Un archivo solo se puede descargar/previsualizar cuando ya está listo. */
export function isFileReady(status: FileStatus): boolean {
  return status === 'Available';
}

export function isFileBlocked(status: FileStatus): boolean {
  return status === 'Infected' || status === 'BlockedByPolicy';
}

// ---------- Fase 4: vista, filtros, orden, compartir ----------

export type ViewMode = 'list' | 'grid';
export type SortKey = 'name' | 'modified' | 'size';
export type SortDir = 'asc' | 'desc';
export interface DocumentSort {
  key: SortKey;
  dir: SortDir;
}

/** Filtros activos del explorador (chips removibles). */
export interface FileFilters {
  years: number[];
  types: string[];
  statuses: FileDisplayStatus[];
}

export function emptyFilters(): FileFilters {
  return { years: [], types: [], statuses: [] };
}

/** FolderType de cara al usuario (los que el explorer navega/muestra en raíz). Espejo de SystemFolderCatalog del backend. */
const USER_FACING_FOLDER_TYPES: ReadonlySet<FolderType> = new Set<FolderType>([
  'Documents',
  'Receipts',
  'Invoices',
  'EmailIncoming',
  'EmailOutgoing',
  'Tasks',
  'Signatures',
]);

export function isUserFacingFolderType(folderType: FolderType): boolean {
  return USER_FACING_FOLDER_TYPES.has(folderType);
}

// ---------- Compartir (share links) ----------

export type ShareVisibility = 'TenantOnly' | 'SpecificUsers' | 'TenantCustomers' | 'ExternalRecipients' | 'Public';
export type SharePermission = 'View' | 'Download';

/** POST /storage/files/{id}/shares */
export interface CreateShareLinkRequest {
  visibility: ShareVisibility;
  permission: SharePermission;
  password?: string | null;
  expiresAtUtc?: string | null;
  maxAccessCount?: number | null;
  recipientEmails?: string[] | null;
}

/** ShareLinkResponse (subset que usa el front). */
export interface ShareLinkResponse {
  id: string;
  resourceId: string;
  resourceType: 'File' | 'Folder';
  visibility: ShareVisibility;
  permission: SharePermission;
  tokenLast4: string;
  expiresAtUtc: string | null;
  status: string;
  createdAtUtc: string;
}

/** Respuesta de crear un link — plainToken SOLO al crear. */
export interface CreatedShareLinkResponse {
  link: ShareLinkResponse;
  plainToken: string;
}
