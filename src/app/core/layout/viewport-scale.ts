import { provideAppInitializer } from '@angular/core';

/**
 * Escala automática de la interfaz según el espacio REAL de la ventana.
 *
 * En un portátil con la pantalla escalada (Windows al 125–200 %) el navegador recibe un viewport en
 * px CSS mucho más pequeño que el monitor (1920×1080 al 175 % ≈ 1097×520), y como todo el diseño
 * se mide en `rem`, la interfaz se ve enorme. Aquí se achica el `font-size` raíz —y con él todo lo
 * que está en `rem`— hasta que el viewport "efectivo" vuelva a ser de unos 1370–1520 × 720 px.
 * No se usa `zoom` CSS porque encoge los elementos que miden `vh`/`dvh`.
 *
 * - 100 % y 125 % → factor 1 (sin cambios).
 * - Preferencia manual: `?scale=0.85` en la URL (se recuerda) o `localStorage['ui.scale']`;
 *   `?scale=auto` vuelve al modo automático.
 */

const BASE_FONT_PX = 16;
const DESIGN_WIDTH = 1366;
const DESIGN_HEIGHT = 720;
const MIN_SCALE = 0.65;
export const UI_SCALE_STORAGE_KEY = 'ui.scale';

/** Factor 0.65–1 que hace que el viewport efectivo ronde el de diseño; nunca amplía. */
export function computeScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) {
    return 1;
  }
  const raw = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return Math.round(Math.min(1, Math.max(MIN_SCALE, raw)) * 100) / 100;
}

/** Valor manual válido (0.5–1.25) o `null` si es "auto"/inválido. */
export function parseScaleOverride(value: string | null | undefined): number | null {
  if (value == null || value === '' || value === 'auto') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.5 && n <= 1.25 ? n : null;
}

function readOverride(): number | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('scale');
    if (fromUrl !== null) {
      if (fromUrl === 'auto') {
        localStorage.removeItem(UI_SCALE_STORAGE_KEY);
      } else if (parseScaleOverride(fromUrl) !== null) {
        localStorage.setItem(UI_SCALE_STORAGE_KEY, fromUrl);
      }
    }
    return parseScaleOverride(localStorage.getItem(UI_SCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function applyScale(root: HTMLElement, scale: number): void {
  if (scale >= 1) {
    root.style.removeProperty('font-size');
  } else {
    root.style.fontSize = `${(BASE_FONT_PX * scale).toFixed(2)}px`;
  }
  root.style.setProperty('--ui-scale', String(scale));
}

/** Aplica la escala ahora y la recalcula al redimensionar o cambiar el zoom del navegador. */
export function initViewportScale(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  const update = () => {
    const override = readOverride();
    applyScale(root, override ?? computeScale(window.innerWidth, window.innerHeight));
  };
  update();
  let timer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(update, 120);
  });
}

export function provideViewportScale() {
  return provideAppInitializer(() => initViewportScale());
}
