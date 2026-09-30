/**
 * Preferencias de la sala que sobreviven a recargar / re-entrar. Todo envuelto en try/catch: en modo
 * privado, con storage bloqueado o lleno, el acceso puede lanzar — la sala funciona igual sin esto.
 */

const PIN_KEY_PREFIX = 'taxvision.meeting.pinned.';
const FLOATING_POS_KEY = 'taxvision.meeting.floating-position';

/** Participante fijado de un meeting (localStorage, por meetingId) — se restaura al volver a entrar. */
export function loadPinnedParticipant(meetingId: string): string | null {
  try {
    return localStorage.getItem(PIN_KEY_PREFIX + meetingId) || null;
  } catch {
    return null;
  }
}

export function savePinnedParticipant(meetingId: string, userId: string | null): void {
  try {
    if (userId) {
      localStorage.setItem(PIN_KEY_PREFIX + meetingId, userId);
    } else {
      localStorage.removeItem(PIN_KEY_PREFIX + meetingId);
    }
  } catch {
    /* storage no disponible: el pin vive solo en memoria */
  }
}

export interface FloatingPosition {
  x: number;
  y: number;
}

/** Posición del panel flotante de cámaras (sessionStorage: solo esta pestaña/sesión). */
export function loadFloatingPosition(): FloatingPosition | null {
  try {
    const raw = sessionStorage.getItem(FLOATING_POS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<FloatingPosition>;
    return typeof parsed.x === 'number' && typeof parsed.y === 'number' && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

export function saveFloatingPosition(pos: FloatingPosition | null): void {
  try {
    if (pos) {
      sessionStorage.setItem(FLOATING_POS_KEY, JSON.stringify(pos));
    } else {
      sessionStorage.removeItem(FLOATING_POS_KEY);
    }
  } catch {
    /* storage no disponible */
  }
}

/**
 * Limita la posición (esquina superior izquierda) de un panel de `size` para que quede entero dentro
 * de `bounds`, con `margin` de aire. Si el panel es más grande que el área, se pega al margen.
 */
export function clampPosition(
  pos: FloatingPosition,
  size: { width: number; height: number },
  bounds: { width: number; height: number },
  margin = 8,
): FloatingPosition {
  const maxX = Math.max(margin, bounds.width - size.width - margin);
  const maxY = Math.max(margin, bounds.height - size.height - margin);
  return {
    x: Math.round(Math.min(Math.max(pos.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, margin), maxY)),
  };
}
