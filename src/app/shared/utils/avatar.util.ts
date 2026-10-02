/**
 * Helpers de avatar compartidos (iniciales + color estable por semilla).
 *
 * Unifica las ~6 copias que vivían en features (user-management `deriveInitials`/`pickAvatarColor`,
 * chat.store, client-notes, core/tasks `initialsFor`/`avatarColorFor`, meetings).
 *
 * API:
 * - `initialsOf(name, { fallback = '?' })`: iniciales en MAYÚSCULA.
 *     · 2+ palabras → primera letra de la PRIMERA y de la ÚLTIMA palabra ("Ana María Pérez" → "AP").
 *     · 1 palabra   → sus 2 primeras letras ("Acme" → "AC").
 *     · vacío/null  → `fallback`.
 *   Es la regla de user-management y core/tasks (la mayoría). Diferencias normalizadas:
 *   client-notes y meetings tomaban las DOS PRIMERAS palabras ("Ana María Pérez" → "AM") y con una
 *   sola palabra devolvían 1 letra ("Acme" → "A"); user-management usaba 'NM' como fallback.
 * - `AVATAR_PALETTE`: las 5 clases de fondo de la paleta de marca (la de chat/notes/meetings).
 *   user-management tenía 4 (sin `bg-indigo-400`) y core/tasks 8; se normaliza a 5.
 * - `avatarColorFor(seed)`: hash estable `hash * 31 + charCode` (uint32) sobre la paleta — el mismo
 *   de chat.store/core-tasks, así esos avatares conservan su color. (user-management sumaba char codes
 *   y meetings usaba `| 0` + `Math.abs`: con la paleta común el color puede cambiar allí.)
 */

export const AVATAR_PALETTE: readonly string[] = [
  'bg-brand-bold',
  'bg-sky-700',
  'bg-brand-ink',
  'bg-slate-500',
  'bg-indigo-400',
];

export interface InitialsOptions {
  /** Lo que se devuelve cuando no hay nombre utilizable. */
  fallback?: string;
}

export function initialsOf(name: string | null | undefined, options: InitialsOptions = {}): string {
  const fallback = options.fallback ?? '?';
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return fallback;
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}

/** Hash de cadena estable (uint32). Mismo algoritmo que chat.store y core/tasks. */
export function stringHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Clase de fondo estable para una semilla (id de usuario/cliente o, en su defecto, el nombre). */
export function avatarColorFor(seed: string | null | undefined, palette: readonly string[] = AVATAR_PALETTE): string {
  return palette[stringHash(String(seed ?? '')) % palette.length];
}
