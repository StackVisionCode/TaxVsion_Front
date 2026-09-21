/**
 * Marca local de "este enlace de firma ya se usó en este dispositivo".
 *
 * El backend revoca el token cuando la solicitud se completa o se rechaza, pero en una
 * solicitud con varios firmantes el enlace de quien ya firmó sigue resolviendo hasta que
 * firman los demás. Con esta marca, al recargar o volver a abrir el enlace, la página
 * muestra que expiró en vez de volver a cargar el recorrido.
 *
 * Se guarda un hash del token (nunca el token: es una credencial). Todo es best-effort:
 * sin `crypto.subtle` (contexto no seguro) o sin `localStorage` (modo privado) no se marca
 * nada y la página se apoya solo en lo que responda el backend.
 */
export type UsedLinkOutcome = 'signed' | 'declined';

export interface UsedLinkRecord {
  outcome: UsedLinkOutcome;
  atUtc: string;
}

const KEY_PREFIX = 'taxvision.sign.used.';

async function storageKey(token: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!token || !subtle) {
    return null;
  }
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    return KEY_PREFIX + hex.slice(0, 32);
  } catch {
    return null;
  }
}

export async function markLinkUsed(token: string, outcome: UsedLinkOutcome, now: Date = new Date()): Promise<void> {
  const key = await storageKey(token);
  if (!key) {
    return;
  }
  try {
    const record: UsedLinkRecord = { outcome, atUtc: now.toISOString() };
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Almacenamiento bloqueado: se sigue sin marca.
  }
}

export async function readUsedLink(token: string): Promise<UsedLinkRecord | null> {
  const key = await storageKey(token);
  if (!key) {
    return null;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<UsedLinkRecord>;
    return parsed.outcome === 'signed' || parsed.outcome === 'declined'
      ? { outcome: parsed.outcome, atUtc: String(parsed.atUtc ?? '') }
      : null;
  } catch {
    return null;
  }
}
