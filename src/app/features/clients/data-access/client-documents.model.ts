import { FileResponse, FileStatus, formatBytes, isFilePending } from '@core/cloud-storage/cloud-storage.model';

/**
 * View-model de la pestaña "Documents" del perfil de cliente. El listado es REAL y por cliente:
 * `GET /storage/files?ownerType=Customer&ownerId={clientId}` devuelve todos los archivos de ese
 * cliente cross-carpeta, más recientes primero (el core `CloudStorageUploadService.listFiles`
 * lo acota por dueño para staff). Los tipos crudos (FileResponse/FileStatus) y el flujo de
 * subida/descarga viven en `@core/cloud-storage` (compartidos); aquí solo la presentación.
 */

/** Estado "amable" que ve el preparador — nunca el FileStatus técnico del backend. */
export type DocDisplayStatus = 'uploading' | 'processing' | 'ready' | 'blocked';

export function docDisplayStatus(status: FileStatus): DocDisplayStatus {
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

export type DocKind = 'pdf' | 'xlsx' | 'img' | 'doc';

/** Por extensión (más fiel a lo que ve el usuario que el contentType). */
export function docKind(name: string): DocKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return 'xlsx';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) {
    return 'img';
  }
  if (['doc', 'docx'].includes(ext)) {
    return 'doc';
  }
  return 'pdf';
}

/** Icono ionicon por tipo. */
export function docKindIcon(kind: DocKind): string {
  switch (kind) {
    case 'xlsx':
      return 'grid-outline';
    case 'img':
      return 'image-outline';
    case 'doc':
      return 'document-outline';
    case 'pdf':
    default:
      return 'document-text-outline';
  }
}

export interface ClientDocumentItem {
  id: string;
  name: string;
  kind: DocKind;
  kindIcon: string;
  sizeLabel: string;
  status: DocDisplayStatus;
  dateLabel: string;
  taxYear: number | null;
  isReady: boolean;
  isBlocked: boolean;
  isPending: boolean;
}

export function toClientDocumentItem(file: FileResponse): ClientDocumentItem {
  const kind = docKind(file.originalName);
  const status = docDisplayStatus(file.status);
  const when = file.scannedAtUtc ?? file.createdAtUtc;
  return {
    id: file.id,
    name: file.originalName,
    kind,
    kindIcon: docKindIcon(kind),
    sizeLabel: formatBytes(file.sizeBytes),
    status,
    dateLabel: new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    taxYear: file.taxYear,
    isReady: file.status === 'Available',
    isBlocked: status === 'blocked',
    isPending: isFilePending(file.status),
  };
}

// ---------- Carpetas (GET /storage/folders?ownerType=Customer&ownerId=) ----------

/** Espejo mínimo de `FolderResponse` de CloudStorage. */
export interface ClientFolderResponse {
  id: string;
  parentFolderId: string | null;
  name: string;
  relativePath: string;
  category: string | null;
  createdAtUtc: string;
}

/** Espejo mínimo de `FolderContentsResponse` (un nivel: subcarpetas + archivos). */
export interface ClientFolderContents {
  subfolders: ClientFolderResponse[];
  files: FileResponse[];
  folderCount?: number;
  fileCount?: number;
  totalCount?: number;
}

export interface ClientFolderItem {
  id: string;
  name: string;
  dateLabel: string;
}

/** Un escalón del breadcrumb. La raíz ("All documents") es el breadcrumb vacío. */
export interface ClientFolderCrumb {
  id: string;
  name: string;
}

export function toClientFolderItem(folder: ClientFolderResponse): ClientFolderItem {
  return {
    id: folder.id,
    name: folder.name,
    dateLabel: new Date(folder.createdAtUtc).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

/** Navegar a un escalón del breadcrumb: corta el camino ahí (índice -1 = raíz). */
export function trimPath(path: readonly ClientFolderCrumb[], index: number): ClientFolderCrumb[] {
  return index < 0 ? [] : path.slice(0, index + 1);
}

/** Nombre de carpeta válido (lo mismo que exige el backend: no vacío, sin separadores, ≤ 255). */
export function folderNameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) {
    return 'Enter a folder name.';
  }
  if (name.length > 255) {
    return 'Use 255 characters or fewer.';
  }
  if (/[\\/]/.test(name)) {
    return 'Folder names can’t contain slashes.';
  }
  return null;
}
