import { Observable } from 'rxjs';

/**
 * Modelo y funciones puras del visor global de archivos (`app-file-viewer`).
 * Sin dependencias de Angular para poder probarlas aisladas.
 */

/**
 * Un archivo que el visor sabe abrir. La URL puede venir ya resuelta (`url`) o resolverse al
 * abrirlo (`resolveUrl`), que es lo normal con URLs presignadas de CloudStorage: vencen en minutos
 * y no conviene pedirlas para toda la lista de antemano.
 */
export interface FileViewerItem {
  /** Nombre visible (y el que se usa al descargar desde el visor). */
  readonly name: string;
  /** MIME declarado; si falta o es genérico se deduce de la extensión del nombre. */
  readonly contentType?: string | null;
  /** URL lista para `fetch` (presignada, blob:, data: o pública). */
  readonly url?: string | null;
  /** Alternativa a `url`: se llama recién al mostrar este archivo. */
  readonly resolveUrl?: () => Observable<string> | Promise<string>;
  /** Tamaño en bytes, solo para el subtítulo. */
  readonly sizeBytes?: number | null;
  /** Dato libre del llamador (p. ej. el id del archivo); vuelve en el evento `download`. */
  readonly ref?: unknown;
}

/** Evento de descarga: el archivo y su posición en la lista. */
export interface FileViewerDownload {
  readonly item: FileViewerItem;
  readonly index: number;
}

export type FileViewerKind = 'pdf' | 'image' | 'text' | 'csv' | 'unsupported';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']);
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'md', 'json', 'xml', 'yml', 'yaml', 'ini', 'tsv']);
/** Tipos que el navegador NO pinta en un <img> aunque sean imágenes. */
const UNRENDERABLE_IMAGES = new Set(['image/tiff', 'image/heic', 'image/heif']);
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

/** Texto más grande que esto se corta (un <pre> con megas de texto congela la pestaña). */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Filas máximas de un CSV en la tabla. */
export const MAX_CSV_ROWS = 500;
/** Columnas máximas por fila de un CSV (un CSV "ancho" roto no debe pintar miles de celdas). */
export const MAX_CSV_COLUMNS = 50;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Qué renderizador usar. El MIME manda; si es genérico o falta, decide la extensión. */
export function detectViewerKind(name: string, contentType?: string | null): FileViewerKind {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!GENERIC_TYPES.has(mime)) {
    if (mime === 'application/pdf') return 'pdf';
    if (mime === 'text/csv' || mime === 'application/csv') return 'csv';
    if (mime.startsWith('image/')) return UNRENDERABLE_IMAGES.has(mime) ? 'unsupported' : 'image';
    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return 'text';
  }
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'unsupported';
}

/** Etiqueta corta del tipo para el subtítulo ("PDF", "Image"…). */
export function kindLabel(kind: FileViewerKind, name = ''): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return 'Image';
    case 'csv':
      return 'CSV';
    case 'text':
      return 'Text';
    default: {
      const ext = extensionOf(name);
      return ext ? ext.toUpperCase() : 'File';
    }
  }
}

export interface ParsedCsv {
  rows: string[][];
  /** Se cortaron filas o columnas. */
  truncated: boolean;
}

/**
 * CSV → filas. Respeta comillas dobles (`"a, b"`, `""` como comilla escapada) y saltos de línea
 * dentro de un campo. Corta en `maxRows` filas y `maxColumns` columnas para no colgar la UI.
 */
export function parseCsv(text: string, maxRows = MAX_CSV_ROWS, maxColumns = MAX_CSV_COLUMNS): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let truncated = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = (): void => {
    if (row.length < maxColumns) {
      row.push(field);
    } else {
      truncated = true;
    }
    field = '';
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i++;
      }
      pushField();
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) {
        return { rows, truncated: truncated || i < source.length - 1 };
      }
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    pushField();
    rows.push(row);
  }
  return { rows, truncated };
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;

/** Siguiente nivel de zoom (in = acercar), acotado a [MIN_ZOOM, MAX_ZOOM]. */
export function stepZoom(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current * ZOOM_STEP : current / ZOOM_STEP;
  return clampZoom(Math.round(next * 100) / 100);
}

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Índice válido tras moverse `delta` posiciones; null si se sale de la lista (no hay vuelta). */
export function moveIndex(current: number, delta: number, length: number): number | null {
  const next = current + delta;
  return next >= 0 && next < length ? next : null;
}

/** Índice acotado a la lista (0 si está vacía). */
export function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(index) || 0), length - 1);
}

/** Página válida (1-based) a partir de lo que el usuario escribió; null si no es un número. */
export function parsePageInput(raw: string | number, pageCount: number): number | null {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(value) || pageCount < 1) {
    return null;
  }
  return Math.min(pageCount, Math.max(1, Math.trunc(value)));
}

/**
 * Mensaje legible a partir de un fallo de carga. Nunca se muestra el texto técnico de pdf.js ni del
 * navegador; solo se distinguen los casos que el usuario puede entender.
 */
export function friendlyViewerError(err: unknown): string {
  const status = err instanceof ViewerHttpError ? err.status : null;
  if (status === 403 || status === 401) {
    return 'This link has expired. Close the preview and open it again.';
  }
  if (status === 404) {
    return "We couldn't find this file. It may have been moved or deleted.";
  }
  const name = (err as { name?: string } | null)?.name;
  if (name === 'PasswordException') {
    return 'This PDF is password protected and can’t be previewed here.';
  }
  if (name === 'InvalidPDFException') {
    return 'This PDF looks damaged and can’t be previewed.';
  }
  return "We couldn't load this preview.";
}

/** Error HTTP al bajar los bytes (para distinguir 403/404 en el mensaje). */
export class ViewerHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'ViewerHttpError';
  }
}
