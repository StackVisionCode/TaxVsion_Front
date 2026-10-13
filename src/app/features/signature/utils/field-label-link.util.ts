/**
 * Etiqueta (instrucción) de un campo de texto que puede ser un ENLACE.
 *
 * Formatos que entiende `parseFieldLabel`:
 * - texto normal ................... "Social Security Number"
 * - enlace en crudo ................ "https://example.com/terms"   (toda la etiqueta es una URL http/https)
 * - enlace enmascarado ............. "[Read the terms](https://example.com/terms)"
 *
 * El enmascarado solo cambia el TEXTO que se muestra; la dirección real viaja en la misma etiqueta
 * (sigue siendo un string, sin tocar el contrato con el backend) y se muestra siempre junto al texto
 * (host) para que enmascarar no sirva de engaño. Solo se aceptan http/https.
 */

export interface FieldLabelLink {
  /** URL real si la etiqueta es un enlace (en crudo o enmascarado). */
  url: string | null;
  /** Texto visible del enlace enmascarado; null si no está enmascarado. */
  text: string | null;
  masked: boolean;
  /** Lo que se muestra como etiqueta: el texto enmascarado, o la etiqueta tal cual. */
  display: string;
}

const MASKED = /^\[([^\]]{1,120})\]\((\S+)\)$/;

/** Solo http/https, con host. Cualquier otro esquema (javascript:, data:, mailto:…) no es un enlace válido. */
export function isSafeHttpUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function parseFieldLabel(label: string | null | undefined): FieldLabelLink {
  const value = (label ?? '').trim();
  const masked = MASKED.exec(value);
  if (masked && isSafeHttpUrl(masked[2])) {
    return { url: masked[2], text: masked[1].trim(), masked: true, display: masked[1].trim() };
  }
  if (isSafeHttpUrl(value)) {
    return { url: value, text: null, masked: false, display: value };
  }
  return { url: null, text: null, masked: false, display: value };
}

/** Etiqueta enmascarada: `[texto](url)`. Sin texto, deja la URL en crudo (no hay nada que mostrar). */
export function buildMaskedLabel(text: string, url: string): string {
  const clean = text.replace(/[[\]()]/g, '').trim().slice(0, 120);
  return clean ? `[${clean}](${url})` : url;
}

/** Texto a mostrar para una etiqueta (el del enlace enmascarado, o la etiqueta tal cual). */
export function labelDisplayText(label: string | null | undefined): string {
  return parseFieldLabel(label).display;
}

/** Dominio legible de la URL (sin "www."), para mostrarlo junto al texto enmascarado. */
export function linkHost(url: string | null | undefined): string {
  if (!url || !isSafeHttpUrl(url)) {
    return '';
  }
  return new URL(url).hostname.replace(/^www\./i, '');
}
