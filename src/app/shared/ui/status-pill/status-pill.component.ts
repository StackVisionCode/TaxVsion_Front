import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'muted' | 'brand';
export type StatusPillSize = 'sm' | 'xs';

interface ToneClasses {
  /** Borde + texto (estilo "outline", el de product-table/signature-table). */
  chip: string;
  /** Variante `soft`: además fondo pastel (el de user-table). */
  soft: string;
  dot: string;
}

/**
 * Tonos derivados de los mapas `statusChip`/`statusDot` de las features:
 * - success  → Active/Completed (inventory, signature)          emerald
 * - warning  → Pending (signature)                               orange (tematizable = acento claro)
 * - danger   → Rejected/Suspended                                red
 * - info     → Ready (signature)                                 blue
 * - neutral  → Draft/Inactive/Canceled                           gray-300/500
 * - muted    → estados terminales poco relevantes (Removed)      gray-200/400
 * - brand    → In progress (signature, indigo = primario)        indigo
 */
export const STATUS_TONES: Record<StatusTone, ToneClasses> = {
  success: {
    chip: 'border-emerald-200 text-emerald-600',
    soft: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
  warning: {
    chip: 'border-orange-200 text-orange-500',
    soft: 'border-orange-200 bg-orange-50 text-orange-600',
    dot: 'bg-orange-500',
  },
  danger: {
    chip: 'border-red-200 text-red-500',
    soft: 'border-red-200 bg-red-50 text-red-700',
    dot: 'bg-red-500',
  },
  info: {
    chip: 'border-indigo-100 text-blue-600',
    soft: 'border-blue-200 bg-blue-50 text-blue-700',
    dot: 'bg-blue-500',
  },
  neutral: {
    chip: 'border-gray-300 text-gray-500',
    soft: 'border-gray-200 bg-gray-100 text-gray-600',
    dot: 'bg-gray-400',
  },
  muted: {
    chip: 'border-gray-200 text-gray-400',
    soft: 'border-gray-200 bg-gray-50 text-gray-400',
    dot: 'bg-gray-300',
  },
  brand: {
    chip: 'border-indigo-200 text-indigo-500',
    soft: 'border-indigo-200 bg-indigo-50 text-indigo-600',
    dot: 'bg-indigo-500',
  },
};

/**
 * Píldora de estado (borde + punto + etiqueta proyectada), la que repetían las tablas.
 *
 * Uso: `<app-status-pill tone="success">Active</app-status-pill>`
 *
 * - `tone`: ver `STATUS_TONES` (default 'neutral'). Si una feature necesita un color fuera de la
 *   paleta, `toneClass`/`dotClass` sobreescriben chip y punto (para migrar mapas existentes 1:1).
 * - `dot` (default true), `soft` (fondo pastel, estilo user-table; default false).
 * - `size`: 'sm' (default, `px-3 py-0.5 text-xs`) | 'xs' (`px-2 py-0.5 text-[10px]`, badges densos).
 *
 * Normalizado: product-table/signature-table usan outline sin fondo (default aquí); user-table
 * añade fondo → `soft`.
 */
@Component({
  selector: 'app-status-pill',
  imports: [NgClass],
  host: { class: 'inline-flex' },
  template: `
    <span class="inline-flex items-center rounded-full border font-medium whitespace-nowrap" [ngClass]="pillClass">
      @if (dot) {
        <span class="h-1.5 w-1.5 shrink-0 rounded-full" [ngClass]="dotClass || tones.dot" aria-hidden="true"></span>
      }
      <ng-content></ng-content>
    </span>
  `,
})
export class StatusPillComponent {
  @Input() tone: StatusTone = 'neutral';
  @Input() dot = true;
  @Input() soft = false;
  @Input() size: StatusPillSize = 'sm';
  @Input() toneClass = '';
  @Input() dotClass = '';

  get tones(): ToneClasses {
    return STATUS_TONES[this.tone] ?? STATUS_TONES.neutral;
  }

  get pillClass(): string {
    const sizing = this.size === 'xs' ? 'gap-1.5 px-2 py-0.5 text-[10px]' : 'gap-2 px-3 py-0.5 text-xs';
    const colors = this.toneClass || (this.soft ? this.tones.soft : this.tones.chip);
    return `${sizing} ${colors}`;
  }
}
