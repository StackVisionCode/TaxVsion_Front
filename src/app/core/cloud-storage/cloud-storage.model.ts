/**
 * DTOs genéricos de TaxVision.CloudStorage (servicio `/storage` vía Gateway),
 * usados por cualquier feature que necesite subir/descargar archivos —
 * promovido desde `features/documents` cuando `features/chat` (adjuntos)
 * necesitó exactamente el mismo cliente de subida (regla de ARCHITECTURE.md:
 * "si 2+ features necesitan la misma pieza, se promueve el mismo día que se
 * detecta"). Lo específico de navegación de documentos (carpetas, papelera)
 * se queda en `features/documents/data-access/documents.model.ts`.
 */

/** Espejo de TaxVision.CloudStorage.Domain.Files.OwnerType. */
export type OwnerType = 'Tenant' | 'Customer' | 'User' | 'Signature' | 'Invoice' | 'Communication';

/** Espejo de TaxVision.CloudStorage.Domain.Files.FolderType (bucket fiscal, no la carpeta navegable). */
export type FolderType =
  | 'Documents'
  | 'Receipts'
  | 'Invoices'
  | 'EmailIncoming'
  | 'EmailOutgoing'
  | 'Tasks'
  | 'Signatures'
  | 'Avatars'
  | 'Imports'
  | 'Recordings'
  | 'Transcripts'
  | 'Backups'
  | 'Templates'
  | 'Branding'
  | 'Other';

/** Espejo de TaxVision.CloudStorage.Domain.Files.FileStatus. */
export type FileStatus =
  | 'PendingUpload'
  | 'PendingScan'
  | 'Scanning'
  | 'Available'
  | 'Infected'
  | 'ScanFailed'
  | 'SoftDeleted'
  | 'BlockedByPolicy'
  | 'PendingReview';

/** GET /storage/files/{id} y filas de GET /storage/folders. */
export interface FileResponse {
  id: string;
  ownerType: OwnerType;
  ownerId: string | null;
  folderType: FolderType;
  taxYear: number | null;
  originalName: string;
  declaredContentType: string;
  detectedContentType: string | null;
  sizeBytes: number;
  checksumSha256: string | null;
  status: FileStatus;
  scanReport: string | null;
  createdAtUtc: string;
  scannedAtUtc: string | null;
}

/** Body de POST /storage/files/uploads. */
export interface InitiateUploadRequest {
  originalName: string;
  contentType: string;
  sizeBytes: number;
  ownerType: OwnerType;
  // null para owner Tenant (oficina). Debe ir null, NO "" — el backend lo bindea a Guid?.
  ownerId: string | null;
  folderType: FolderType;
  taxYear: number | null;
}

/** Respuesta de POST /storage/files/uploads. */
export interface InitiatedUploadResponse {
  fileId: string;
  uploadUrl: string;
  formData: Record<string, string>;
  expiresAtUtc: string;
  status: FileStatus;
}

/** Respuesta de POST /storage/files/{id}/download-url. */
export interface DownloadUrlResponse {
  fileId: string;
  downloadUrl: string;
  expiresAtUtc: string;
}

/** Estados en los que el archivo todavía no está listo para descargar (escaneo en curso). */
export function isFilePending(status: FileStatus): boolean {
  return status === 'PendingUpload' || status === 'PendingScan' || status === 'Scanning';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
