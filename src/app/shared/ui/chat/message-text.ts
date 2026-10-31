/**
 * F8d — texto de los mensajes: enlaces clicables seguros (T-16) y tope de longitud (ADD-07 H-1/H-8).
 * Puro, sin DOM: el componente pinta los segmentos como texto y `<a>`; nunca se inserta HTML.
 */

/** Mismo tope que valida el servidor (`Chat.Message.TooLong`), en unidades UTF-16 (`string.length`). */
export const MESSAGE_MAX_LENGTH = 4000;
/** Desde aquí el composer muestra el contador. */
export const MESSAGE_LENGTH_WARNING = 3500;

export type MessageTextSegment = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'link'; readonly text: string; readonly href: string };

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/u;

/** Parte el texto en tramos de texto y enlaces http(s) (un `www.` se abre como https). */
export function linkifySegments(text: string | null | undefined): MessageTextSegment[] {
  if (!text) return [];
  const segments: MessageTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    const href = safeHref(raw);
    if (!href) continue;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'link', text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

function safeHref(raw: string): string | null {
  try {
    const url = new URL(/^www\./iu.test(raw) ? `https://${raw}` : raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Copy del error de longitud del servidor. */
export const MESSAGE_TOO_LONG_TEXT = `Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString('en-US')} characters.`;
