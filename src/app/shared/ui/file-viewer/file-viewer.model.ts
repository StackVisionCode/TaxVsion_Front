import { Observable } from 'rxjs';

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
  /** Dato libre del llamador (p. ej. el id del archivo) — vuelve en el evento `download`. */
  readonly ref?: unknown;
}

/** Evento de descarga: el archivo y su posición en la lista. */
export interface FileViewerDownload {
  readonly item: FileViewerItem;
  readonly index: number;
}

export type FileViewerKind = 'pdf' | 'image' | 'text' | 'csv' | 'unsupported';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']);
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'md', 'json', 'xml', 'yml', 'yaml', 'ini']);
/** Tipos que el navegador NO pinta en un <img> aunque sean imágenes. */
const UNRENDERABLE_IMAGES = new Set(['image/tiff', 'image/heic', 'image/heif']);
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

function extensionOf(name: string): string {
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

/**
 * CSV → filas. Respeta comillas dobles (`"a, b"`, `""` como comilla escapada) y saltos de línea
 * dentro de un campo. Corta en `maxRows` para no colgar la UI con un archivo enorme.
 */
export function parseCsv(text: string, maxRows = 500): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

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
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) {
        return { rows, truncated: i < source.length - 1 };
      }
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows, truncated: false };
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;

/** Siguiente nivel de zoom (in = acercar), acotado a [MIN_ZOOM, MAX_ZOOM]. */
export function stepZoom(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current * ZOOM_STEP : current / ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
}

/** Índice válido tras moverse `delta` posiciones; null si se sale de la lista (no hay vuelta). */
export function moveIndex(current: number, delta: number, length: number): number | null {
  const next = current + delta;
  return next >= 0 && next < length ? next : null;
}

/** "2.4 MB" — solo para el subtítulo del visor. */
export function formatViewerBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
