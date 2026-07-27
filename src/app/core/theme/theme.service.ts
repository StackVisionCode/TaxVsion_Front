import { Injectable, signal } from '@angular/core';

/** Shades que sobreescribimos en tailwind.config.js (colors.indigo y colors.orange). */
const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700] as const;
type ShadeStep = (typeof SHADE_STEPS)[number];

/**
 * Offset de luminosidad (HSL) según la distancia (en pasos de shade) al
 * "shade ancla" — el que se pinta EXACTAMENTE con el color que el usuario
 * eligió. Se indexa por distancia y no por shade absoluto para poder
 * reusarse con anclas distintas (primary ancla en 600, secondary en 500,
 * que son los shades que más se repiten hoy como indigo-600/orange-500 en
 * la app). No busca replicar la curva exacta de Tailwind, solo generar una
 * rampa coherente (clara -> oscura) a partir de un solo hex.
 */
const DISTANCE_LIGHTNESS_OFFSET: Record<number, number> = {
  '-6': 42,
  '-5': 35,
  '-4': 27,
  '-3': 18,
  '-2': 9,
  '-1': 4,
  '0': 0,
  '1': -10,
  '2': -18,
};

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
  defaultHex: '#4f46e5',
  anchorShade: 600,
};
const SECONDARY: ColorChannel = {
  cssPrefix: 'orange',
  storageKey: 'tvf.theme.secondaryColor',
  defaultHex: '#f97316',
  anchorShade: 500,
};

export interface ThemePreset {
  label: string;
  hex: string;
}

/** Paleta curada compartida por los swatches de primary/secondary en Settings > Overview. */
export const THEME_PRESETS: ThemePreset[] = [
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
      const offset = DISTANCE_LIGHTNESS_OFFSET[index - anchorIndex] ?? 0;
      const l = clamp(hsl.l + offset, 4, 97);
      const shadeHex = hslToHex({ h: hsl.h, s: hsl.s, l });
      // Triplete RGB sin comas: es el formato que espera rgb(var(...) / <alpha-value>) en tailwind.config.js.
      applyCssVar(`--color-${channel.cssPrefix}-${shade}-rgb`, hexToRgbTriplet(shadeHex));
    });
    target.set(normalized);
    if (options.persist !== false) {
      write(channel.storageKey, normalized);
    }
  }
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
