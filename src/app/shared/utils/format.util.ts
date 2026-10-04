import { parseUtcDate } from './utc-date.util';

/**
 * Formateadores de presentación compartidos (bytes, dinero, tiempo relativo).
 *
 * - `formatBytes(bytes, { maxUnit })`: base = core/cloud-storage `formatBytes` (que ahora re-exporta
 *   este). "512 B" / "12 KB" (redondeado) / "3.4 MB" (1 decimal). `maxUnit` (default 'MB', la salida
 *   de hoy: nunca pasa a GB) puede subirse a 'GB'/'TB' para cuotas grandes. Mismo resultado que las
 *   copias de signature-wizard.presenter y mail.model (`formatFileSize`).
 * - `formatMoney(amount, currency = 'USD', { fromCents, minFraction })`: base = billing `formatCents`
 *   (Intl en-US, 2 decimales mínimo). `fromCents: true` divide entre 100; `minFraction` (default 2).
 * - `formatRelativeTime(isoUtc, now)`: base = notifications `relativeTimeLabel` — "Just now" / "20m ago"
 *   / "3h ago" / "Yesterday" / "3 days ago" / fecha local. Diferencia normalizada: interpreta el ISO con
 *   `parseUtcDate` (los servicios sin `Z` ya no salen corridos por la zona del navegador). La copia de
 *   dashboard-notes decía "3d ago" y "Mar 4"; se unifica al formato de notifications.
 * - `currencySymbol(code)`: símbolo corto ("$", "€", "RD$") para el prefijo de un input de precio.
 */

export type ByteUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB';

const BYTE_UNITS: ByteUnit[] = ['B', 'KB', 'MB', 'GB', 'TB'];

export interface FormatBytesOptions {
  /** Unidad más grande a usar (default 'MB', como la versión original). */
  maxUnit?: ByteUnit;
}

export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const maxIndex = Math.max(0, BYTE_UNITS.indexOf(options.maxUnit ?? 'MB'));
  if (value < 1024 || maxIndex === 0) {
    return `${Math.round(value)} B`;
  }
  let unit = 0;
  let scaled = value;
  while (scaled >= 1024 && unit < maxIndex) {
    scaled /= 1024;
    unit++;
  }
  // KB sin decimales; MB en adelante con 1 decimal (igual que antes).
  return unit === 1 ? `${Math.round(scaled)} KB` : `${scaled.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export interface FormatMoneyOptions {
  /** El importe viene en centavos (billing): se divide entre 100. */
  fromCents?: boolean;
  /** Decimales mínimos (default 2). */
  minFraction?: number;
}

export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined = 'USD',
  options: FormatMoneyOptions = {},
): string {
  const raw = Number(amount ?? 0);
  const value = Number.isFinite(raw) ? raw : 0;
  const minFraction = options.minFraction ?? 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: minFraction,
      maximumFractionDigits: Math.max(minFraction, 2),
    }).format(options.fromCents ? value / 100 : value);
  } catch {
    // Código de moneda inválido: no romper la vista.
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: minFraction,
      maximumFractionDigits: Math.max(minFraction, 2),
    }).format(options.fromCents ? value / 100 : value);
  }
}

/**
 * Símbolo corto de una moneda ISO para prefijos de inputs de precio: 'USD' → "$", 'EUR' → "€",
 * 'DOP' → "RD$" (lo que dé Intl en-US con narrowSymbol). Código inválido o vacío → el propio código
 * en mayúsculas (o "$" si no hay nada).
 */
export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase();
  if (!code) {
    return '$';
  }
  try {
    const part = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find(p => p.type === 'currency');
    return part?.value || code;
  } catch {
    return code;
  }
}

/** "Just now" / "20m ago" / "3h ago" / "Yesterday" / "3 days ago" / fecha local ('' si no es válida). */
export function formatRelativeTime(
  isoUtc: string | null | undefined,
  now: number | Date = Date.now(),
): string {
  if (!isoUtc) {
    return '';
  }
  const then = parseUtcDate(isoUtc).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const nowMs = now instanceof Date ? now.getTime() : now;
  const minutes = Math.floor(Math.max(0, nowMs - then) / 60_000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return new Date(then).toLocaleDateString();
}
