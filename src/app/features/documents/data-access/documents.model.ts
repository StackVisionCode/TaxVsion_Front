import { FileResponse, FolderType, OwnerType } from '@core/cloud-storage/cloud-storage.model';

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
