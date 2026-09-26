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
  /** true si la carpeta tiene un link de compartir vigente (lo marca el listado). */
  isShared?: boolean;
}

/** Opciones de paginación + filtro/orden server-side para GET /storage/folders. */
export interface FolderContentsQueryOpts {
  skip?: number;
  take?: number;
  /** FolderType visibles (el explorador manda el set "user-facing"). */
  folderTypes?: string[];
  taxYears?: number[];
  /** Extensiones en mayúscula (PDF, XLSX…). */
  extensions?: string[];
  /** FileStatus del backend (Available, Infected…). */
  statuses?: string[];
  /** 'Name' | 'Modified' | 'Size'. */
  sort?: string;
  desc?: boolean;
}

/** GET /storage/folders?parentFolderId=&ownerType=&ownerId=&skip=&take= */
export interface FolderContentsResponse {
  subfolders: FolderResponse[];
  files: FileResponse[];
  /** Totales sin paginar (para los controles de página). Opcionales por compat con respuestas viejas. */
  folderCount?: number;
  fileCount?: number;
  totalCount?: number;
  skip?: number;
  take?: number | null;
}

/** Body de POST /storage/folders. */
export interface CreateFolderRequest {
  parentFolderId: string | null;
  name: string;
  ownerType: OwnerType;
  // null en la oficina (owner Tenant). Debe ir null, NO "" — el backend lo bindea a Guid? y un
  // string vacío revienta la validación con 400.
  ownerId: string | null;
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
  /** 'File' | 'Folder'. Una carpeta borrada es una sola entrada que restaura todo su contenido. */
  itemType?: string;
  /** Para carpetas: cuántos archivos contiene el batch. */
  itemCount?: number;
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
/**
 * `clients` es el SELECTOR (la lista de clientes, a pantalla completa); `client` es ya el
 * workspace de uno concreto. Son dos cosas distintas: el selector necesita su propia
 * búsqueda, filtro y paginación, y en el rail lateral no cabían — con más de una página de
 * clientes la lista quedaba truncada y había que adivinar el nombre para encontrarlos.
 */
export type WorkspaceSection = 'office' | 'clients' | 'client' | 'recent' | 'shared' | 'trash';

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
export const USER_FACING_FOLDER_TYPES: readonly FolderType[] = [
  'Documents',
  'Receipts',
  'Invoices',
  'EmailIncoming',
  'EmailOutgoing',
  'Tasks',
  'Signatures',
];

const USER_FACING_FOLDER_TYPE_SET: ReadonlySet<FolderType> = new Set(USER_FACING_FOLDER_TYPES);

export function isUserFacingFolderType(folderType: FolderType): boolean {
  return USER_FACING_FOLDER_TYPE_SET.has(folderType);
}

/** Traduce el estado visible (chip) a los FileStatus del backend que lo componen. */
export function displayStatusToFileStatuses(status: FileDisplayStatus): FileStatus[] {
  switch (status) {
    case 'ready':
      return ['Available'];
    case 'blocked':
      return ['Infected', 'BlockedByPolicy'];
    case 'uploading':
      return ['PendingUpload'];
    default:
      return ['PendingScan', 'Scanning', 'ScanFailed', 'PendingReview'];
  }
}

// ---------- Compartir (share links) ----------

export type ShareVisibility =
  | 'TenantOnly'
  | 'SpecificUsers'
  | 'TenantCustomers'
  | 'ExternalRecipients'
  | 'ExternalLink'
  | 'Public';
export type SharePermission = 'View' | 'Download';

/** POST /storage/files/{id}/shares */
export interface CreateShareLinkRequest {
  visibility: ShareVisibility;
  permission: SharePermission;
  password?: string | null;
  expiresAtUtc?: string | null;
  maxAccessCount?: number | null;
  recipientEmails?: string[] | null;
  /** 'Es' | 'En' — idioma del email al destinatario externo (solo ExternalRecipients). */
  recipientLanguage?: string | null;
}

/** POST /storage/folders/{id}/shares — como el de file + semántica propia de carpeta. */
export interface CreateFolderShareLinkRequest extends CreateShareLinkRequest {
  /** Cubre todo el subárbol (true) o solo el contenido directo (false). */
  isRecursive: boolean;
  /** Cubre lo que se agregue después de crear el link (true) o solo lo que ya existía (false). */
  appliesToFutureItems: boolean;
}

/** ShareLinkResponse (subset que usa el front). */
export interface ShareLinkResponse {
  id: string;
  resourceId: string;
  resourceType: 'File' | 'Folder';
  visibility: ShareVisibility;
  permission: SharePermission;
  tokenLast4: string;
  hasPassword: boolean;
  expiresAtUtc: string | null;
  maxAccessCount: number | null;
  accessCount: number;
  status: string;
  createdAtUtc: string;
  isRecursive: boolean;
  appliesToFutureItems: boolean;
}

/** Respuesta de crear un link — plainToken SOLO al crear. */
export interface CreatedShareLinkResponse {
  link: ShareLinkResponse;
  plainToken: string;
}
