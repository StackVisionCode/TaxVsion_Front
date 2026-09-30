/**
 * Helpers de overlays (modal, drawer): bloqueo de scroll del body, foco y focus-trap.
 *
 * Extraídos de `shared/ui/modal` sin cambiar su comportamiento, para que `app-drawer` comparta el
 * MISMO contador de bloqueo de scroll (un drawer abierto sobre un modal, o al revés, no libera el
 * scroll antes de tiempo).
 */

/** Selector de elementos enfocables dentro de un panel (foco inicial y focus-trap). */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Bloqueo de scroll del fondo con contador: mientras haya ≥1 overlay montado, el body no scrollea.
 * El contador cubre overlays anidados/apilados. Cada instancia debe sumar/restar una sola vez.
 */
let openOverlayCount = 0;
export function setBodyScrollLock(locked: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  openOverlayCount = Math.max(0, openOverlayCount + (locked ? 1 : -1));
  document.body.style.overflow = openOverlayCount > 0 ? 'hidden' : '';
}

/** Enfocables visibles del panel (o el que ya tiene el foco). */
export function focusablesIn(panel: HTMLElement | null | undefined): HTMLElement[] {
  if (!panel) {
    return [];
  }
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Focus-trap: Tab/Shift+Tab ciclan dentro del panel en vez de escaparse al fondo. Si el foco se
 * salió, lo trae de vuelta. Llamar desde un listener de `document:keydown.tab`/`shift.tab`.
 */
export function trapTabKey(event: KeyboardEvent, panel: HTMLElement): void {
  const focusables = focusablesIn(panel);
  if (focusables.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const insidePanel = active !== null && panel.contains(active);

  if (event.shiftKey && (active === first || !insidePanel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Elemento con foco en este momento (para devolvérselo al cerrar), ignorando el body. */
export function captureActiveElement(): HTMLElement | null {
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  return active && active !== document.body ? active : null;
}
