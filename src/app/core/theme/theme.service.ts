import { Injectable, signal } from '@angular/core';

/** Shades que sobreescribimos en tailwind.config.js (colors.indigo y colors.orange). */
const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700] as const;
type ShadeStep = (typeof SHADE_STEPS)[number];

/**
 * Offset de luminosidad para los shades MÁS OSCUROS que el ancla (distancia > 0).
 * Un offset fijo funciona bien acá porque solo hay uno o dos pasos.
 */
const DARKER_LIGHTNESS_OFFSET: Record<number, number> = {
  1: -10,
  2: -18,
};

/**
 * Los shades MÁS CLAROS que el ancla no pueden usar un offset fijo: con un color
 * base oscuro (p. ej. el Bold Blue de marca, #1e466b, luminosidad ~27%) sumarle
 * 42 puntos deja el shade 50 en ~69% — un azul medio donde la app espera un fondo
 * casi blanco (`bg-indigo-50` se usa como fondo de página en el login y en ~150
 * sitios más). En vez de eso se interpola la luminosidad HACIA EL BLANCO según la
 * distancia al ancla, de modo que el shade más claro siempre acaba casi blanco sea
 * cual sea el color elegido.
 */
const LIGHTEST_LIGHTNESS = 98;

/**
 * Exponente de la curva de interpolación (1 = lineal). Por debajo de 1 los shades
 * intermedios se aclaran antes, que es como se comportan las escalas de Tailwind:
 * el salto grande está cerca del extremo claro, no repartido por igual.
 */
const LIGHTNESS_CURVE = 0.8;

/**
 * Cuánta saturación se le quita al shade más claro. Sin esto un 50 casi blanco
 * conserva toda la saturación del base y se ve como un pastel chillón en vez de
 * un fondo neutro.
 */
const MAX_SATURATION_DROP = 0.35;

/**
 * Rampa base de los neutros (los mismos fallbacks del `gray` en tailwind.config.js: default de
 * Tailwind 50-800 + Jet Black en 900). applyNeutrals conserva la LUMINOSIDAD de cada shade y solo
 * gira su hue hacia el primary a baja saturación → tinte sutil de marca con el contraste preservado.
 */
const NEUTRAL_BASE: Record<number, string> = {
  50: '#f9fafb',
  100: '#f3f4f6',
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#0d0d0d',
};

/** Saturación del tinte de neutros (%). Sutil a propósito: un tinte fuerte se ve sucio y arriesga contraste. */
const NEUTRAL_TINT_SATURATION = 8;

interface ColorChannel {
  cssPrefix: 'indigo' | 'orange';
  storageKey: string;
  defaultHex: string;
  /** Shade que queda igual al hex elegido, sin ajuste de luminosidad. */
  anchorShade: ShadeStep;
}

// indigo-600 y orange-500 son los shades que más se repiten hoy en la app para cada color — el
// "color base" que el usuario ve reflejado tal cual al elegir uno nuevo.
const PRIMARY: ColorChannel = {
  cssPrefix: 'indigo',
  storageKey: 'tvf.theme.primaryColor',
  /** Bold Blue del brandbook. Los fallbacks de tailwind.config.js son esta misma rampa. */
  defaultHex: '#1e466b',
  anchorShade: 600,
};
const SECONDARY: ColorChannel = {
  cssPrefix: 'orange',
  storageKey: 'tvf.theme.secondaryColor',
  /** Light Blue del brandbook. */
  defaultHex: '#67baf4',
  anchorShade: 500,
};

export interface ThemePreset {
  label: string;
  hex: string;
}

/** Paleta curada compartida por los swatches de primary/secondary en Settings > Overview. */
export const THEME_PRESETS: ThemePreset[] = [
  // Los dos primeros son los colores del brandbook (defaults de PRIMARY/SECONDARY).
  { label: 'Bold Blue', hex: '#1e466b' },
  { label: 'Light Blue', hex: '#67baf4' },
  { label: 'Indigo', hex: '#4f46e5' },
  { label: 'Violet', hex: '#7c3aed' },
  { label: 'Blue', hex: '#2563eb' },
  { label: 'Teal', hex: '#0d9488' },
  { label: 'Emerald', hex: '#059669' },
  { label: 'Amber', hex: '#d97706' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Rose', hex: '#e11d48' },
  { label: 'Pink', hex: '#db2777' },
];

/**
 * Aplica los dos colores de marca (hoy hardcodeados como `indigo-*`/`orange-*`
 * en toda la app) vía variables CSS en :root — ver el override de
 * `colors.indigo`/`colors.orange` en tailwind.config.js. Generar la rampa de
 * shades a partir de un solo hex por color evita tener que tocar los ~340
 * usos de `bg-indigo-600`/`text-orange-500`/etc. repartidos en ~90 archivos.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _primaryColor = signal(PRIMARY.defaultHex);
  private readonly _secondaryColor = signal(SECONDARY.defaultHex);

  readonly primaryColor = this._primaryColor.asReadonly();
  readonly secondaryColor = this._secondaryColor.asReadonly();
  readonly presets = THEME_PRESETS;

  constructor() {
    this.setPrimaryColor(read(PRIMARY.storageKey) ?? PRIMARY.defaultHex, { persist: false });
    this.setSecondaryColor(read(SECONDARY.storageKey) ?? SECONDARY.defaultHex, { persist: false });
  }

  setPrimaryColor(hex: string, options: { persist?: boolean } = {}): void {
    this.applyChannel(PRIMARY, hex, this._primaryColor, options);
  }

  setSecondaryColor(hex: string, options: { persist?: boolean } = {}): void {
    this.applyChannel(SECONDARY, hex, this._secondaryColor, options);
  }

  resetToDefaults(): void {
    this.setPrimaryColor(PRIMARY.defaultHex);
    this.setSecondaryColor(SECONDARY.defaultHex);
  }

  /**
   * Aplica la marca resuelta del tenant (TenantBrands): primary → canal indigo,
   * accent → canal orange. Persiste en localStorage como CACHE DE ARRANQUE para
   * evitar el flash de color equivocado en la próxima carga (la fuente de verdad es
   * la API; localStorage solo adelanta el pintado). Un hex inválido se ignora en
   * `applyChannel`, así que un branding incompleto nunca deja la app sin color.
   */
  applyBranding(colors: { primary?: string | null; accent?: string | null }): void {
    if (colors.primary) {
      this.setPrimaryColor(colors.primary);
    }
    if (colors.accent) {
      this.setSecondaryColor(colors.accent);
    }
  }

  /**
   * Tiñe los neutros (gray-*) con el HUE del primary conservando la LUMINOSIDAD de cada shade de
   * hoy — solo gira el matiz a baja saturación. Al no mover la luminosidad, el contraste texto/fondo
   * se preserva por construcción (ver el test de contraste). Un hex inválido se ignora. Se dispara
   * solo desde el canal primary (los neutros siguen al primary, no al accent).
   */
  applyNeutrals(primaryHex: string): void {
    const normalized = normalizeHex(primaryHex);
    if (!normalized) {
      return;
    }
    const hue = hexToHsl(normalized).h;
    Object.entries(NEUTRAL_BASE).forEach(([shade, baseHex]) => {
      const { l } = hexToHsl(baseHex);
      // En los extremos (casi blanco / casi negro) se tiñe aún menos para que no se ensucien.
      const saturation = l > 92 || l < 12 ? NEUTRAL_TINT_SATURATION / 2 : NEUTRAL_TINT_SATURATION;
      const tinted = hslToHex({ h: hue, s: saturation, l });
      applyCssVar(`--color-gray-${shade}-rgb`, hexToRgbTriplet(tinted));
    });
  }

  private applyChannel(
    channel: ColorChannel,
    hex: string,
    target: ReturnType<typeof signal<string>>,
    options: { persist?: boolean },
  ): void {
    const normalized = normalizeHex(hex);
    if (!normalized) {
      return;
    }
    const hsl = hexToHsl(normalized);
    const anchorIndex = SHADE_STEPS.indexOf(channel.anchorShade);
    SHADE_STEPS.forEach((shade, index) => {
      const shadeHex = shadeFor(hsl, index - anchorIndex, anchorIndex);
      // Triplete RGB sin comas: es el formato que espera rgb(var(...) / <alpha-value>) en tailwind.config.js.
      applyCssVar(`--color-${channel.cssPrefix}-${shade}-rgb`, hexToRgbTriplet(shadeHex));
    });
    // Los neutros siguen al primary: al cambiarlo, se re-tiñe la escala de grises.
    if (channel === PRIMARY) {
      this.applyNeutrals(normalized);
    }
    target.set(normalized);
    if (options.persist !== false) {
      write(channel.storageKey, normalized);
    }
  }
}

/**
 * Color de un shade a partir del HSL base y su distancia al ancla (negativa = más
 * claro). Los oscuros bajan luminosidad con un offset fijo; los claros interpolan
 * hacia el blanco y pierden saturación, para que el extremo sea un fondo neutro
 * aunque el color elegido sea muy oscuro o muy saturado.
 */
function shadeFor(base: Hsl, distance: number, anchorIndex: number): string {
  if (distance === 0) {
    return hslToHex(base);
  }

  if (distance > 0) {
    const offset = DARKER_LIGHTNESS_OFFSET[distance] ?? 0;
    return hslToHex({ ...base, l: clamp(base.l + offset, 4, 97) });
  }

  // `anchorIndex` es cuántos pasos claros existen por encima del ancla: normaliza
  // la distancia para que el shade más claro siempre llegue al extremo.
  const steps = Math.max(anchorIndex, 1);
  const progress = Math.pow(Math.min(-distance / steps, 1), LIGHTNESS_CURVE);
  return hslToHex({
    h: base.h,
    s: base.s * (1 - MAX_SATURATION_DROP * progress),
    l: clamp(base.l + (LIGHTEST_LIGHTNESS - base.l) * progress, 4, 97),
  });
}

function applyCssVar(name: string, value: string): void {
  try {
    document.documentElement.style.setProperty(name, value);
  } catch {
    // SSR / sin DOM disponible — no es crítico, el fallback hex del config se usa igual.
  }
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n: number) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

function hexToRgbTriplet(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin persistencia disponible: el color elegido vive solo en memoria de esta sesión.
  }
}
