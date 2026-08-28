/**
 * Contrato de `customers/imports` (TaxVision.Customer.Api / CustomerImportsController).
 *
 * Customer.Api registra `JsonStringEnumConverter` en AddJsonOptions, así que todo lo que
 * sale por el pipeline normal de MVC viaja en camelCase con los enums como string. La
 * ÚNICA excepción es el informe (`GET /{id}/report?format=json`), que el controller
 * serializa a mano con `JsonSerializer.Serialize(row)` SIN opciones: ahí las propiedades
 * salen en PascalCase y `Status` como número. Por eso las filas se normalizan abajo
 * (ver {@link toImportRow}) en vez de tiparse directo.
 */

/** Espejo de TaxVision.Customer.Domain.Imports.ImportStatus. */
export type ImportStatus =
  | 'Queued'
  | 'Validating'
  | 'Applying'
  | 'Completed'
  | 'Failed'
  | 'Canceling'
  | 'Canceled';

/** Espejo de TaxVision.Customer.Domain.Imports.DuplicateStrategy (campo `Strategy` del form). */
export type DuplicateStrategy = 'Skip' | 'Merge' | 'Overwrite';

/** Espejo de TaxVision.Customer.Domain.Imports.ImportSourceKind. El backend lo deduce de la extensión del archivo. */
export type ImportSourceKind = 'Csv' | 'Xlsx';

/** Espejo de TaxVision.Customer.Domain.Imports.RowStatus. */
export type ImportRowStatus = 'Pending' | 'Success' | 'Updated' | 'Skipped' | 'Failed';

/** Respuesta de POST /customers/imports, GET /customers/imports/{id} y GET /customers/imports. */
export interface CustomerImportAttempt {
  id: string;
  tenantId: string;
  createdByUserId: string;
  idempotencyKey: string;
  status: ImportStatus;
  strategy: DuplicateStrategy;
  sourceKind: ImportSourceKind;
  sourceFileName: string;
  totalRows: number;
  processedRows: number;
  successCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  createdAtUtc: string;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  canceledAtUtc: string | null;
  canceledByUserId: string | null;
  failureReason: string | null;
}

/** Fila del informe (espejo de CustomerImportRowResponse), ya normalizada. */
export interface CustomerImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  resultingCustomerId: string | null;
  displayName: string | null;
  /** Campo por el que el detector de duplicados hizo match (email, tax id…). Solo en filas Skipped/Updated. */
  matchedBy: string | null;
  errorCode: string | null;
  message: string | null;
}

/**
 * Estados terminales según CustomerImportAttempt.RequestCancel: desde Completed/Failed/Canceled
 * el backend responde `Import.AlreadyTerminal`. Todo lo demás sigue vivo y hay que seguir sondeando.
 */
const TERMINAL_STATUSES: readonly ImportStatus[] = ['Completed', 'Failed', 'Canceled'];

/** true si la importación ya no va a cambiar más: se corta el polling y se pide el informe. */
export function isTerminalImport(status: ImportStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * `POST /{id}/cancel` acepta cualquier estado no terminal; en `Canceling` es idempotente,
 * así que el botón se oculta ahí para no invitar a un click que no hace nada.
 */
export function isCancelableImport(status: ImportStatus): boolean {
  return !isTerminalImport(status) && status !== 'Canceling';
}

/**
 * Porcentaje procesado, o null cuando todavía no se conoce el total: el worker sólo fija
 * `totalRows` después de leer el archivo, así que hasta entonces la barra va indeterminada
 * en vez de mostrar un 0% que parece un cuelgue.
 */
export function importProgressPercent(attempt: CustomerImportAttempt): number | null {
  if (attempt.totalRows <= 0) {
    return null;
  }
  const ratio = (attempt.processedRows / attempt.totalRows) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

/** Etiqueta legible del estado, en inglés (los enums del backend ya lo son, pero `Canceling` conviene suavizarlo). */
export function importStatusLabel(status: ImportStatus): string {
  return status === 'Canceling' ? 'Canceling…' : status;
}

// ============ Normalización del informe (GET /{id}/report?format=json) ============

/** Orden de RowStatus en el enum de C#: el informe manda el ordinal, no el nombre. */
const ROW_STATUS_BY_ORDINAL: readonly ImportRowStatus[] = [
  'Pending',
  'Success',
  'Updated',
  'Skipped',
  'Failed',
];

/**
 * Convierte una fila cruda del informe a {@link CustomerImportRow}. Acepta las dos formas
 * posibles (PascalCase + enum numérico, que es lo que serializa hoy el controller, y
 * camelCase + enum string por si algún día pasa por el pipeline normal de MVC) para que la
 * UI no se rompa con ninguna de las dos.
 */
export function toImportRow(raw: unknown): CustomerImportRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    rowNumber: asNumber(pick(row, 'RowNumber', 'rowNumber')),
    status: asRowStatus(pick(row, 'Status', 'status')),
    resultingCustomerId: asStringOrNull(pick(row, 'ResultingCustomerId', 'resultingCustomerId')),
    displayName: asStringOrNull(pick(row, 'DisplayName', 'displayName')),
    matchedBy: asStringOrNull(pick(row, 'MatchedBy', 'matchedBy')),
    errorCode: asStringOrNull(pick(row, 'ErrorCode', 'errorCode')),
    message: asStringOrNull(pick(row, 'Message', 'message')),
  };
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asRowStatus(value: unknown): ImportRowStatus {
  if (typeof value === 'number') {
    return ROW_STATUS_BY_ORDINAL[value] ?? 'Pending';
  }
  if (typeof value === 'string' && (ROW_STATUS_BY_ORDINAL as readonly string[]).includes(value)) {
    return value as ImportRowStatus;
  }
  return 'Pending';
}
