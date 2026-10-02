import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { CountUpDirective } from '../../directives/count-up.directive';

export type StatCardTone = 'indigo-50' | 'indigo-100' | 'gray-200' | 'white';

export interface StatCardItem {
  label: string;
  /** Número o texto ya formateado ("$1,240.00"). null/undefined → "—". */
  value: number | string | null | undefined;
  /** Fondo de la tarjeta. Sin tono → rotación por posición (ver `DEFAULT_TONE_CYCLE`). */
  tone?: StatCardTone;
  /** Línea secundaria bajo la cifra. */
  hint?: string | null;
  /** Icono ionicons opcional (arriba a la derecha). */
  icon?: string;
  /** Anima la cifra con `appCountUp` (solo si `value` es número). */
  countUp?: boolean;
}

const TONE_CLASSES: Record<StatCardTone, string> = {
  'indigo-50': 'bg-indigo-50',
  'indigo-100': 'bg-indigo-100',
  'gray-200': 'bg-gray-200',
  white: 'bg-white',
};

/** Rotación que repiten task/meetings/inventory/signature: 50 → 100 → gray-200 → 100. */
const DEFAULT_TONE_CYCLE: StatCardTone[] = ['indigo-50', 'indigo-100', 'gray-200', 'indigo-100'];

/**
 * Fila de tarjetas de métricas de la cabecera de las páginas (inventory, task, meetings, signature…).
 *
 * Uso: `<app-stat-cards [items]="stats()" [loading]="store.loading()" />` con
 * `stats = computed<StatCardItem[]>(() => [{ label: 'Total tasks', value: total() }, …])`.
 *
 * Markup idéntico a las copias: grid `grid gap-4 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]`,
 * tarjeta `rounded-[24px] p-5`, etiqueta `text-sm text-gray-600`, cifra `mt-2 text-3xl font-bold
 * text-gray-900`. Con `countUp` la cifra lleva además `inline-block` (lo necesita el "pop" del
 * count-up, igual que en client-import). `loading` pinta "—" en todas (como signature/calls).
 */
@Component({
  selector: 'app-stat-cards',
  imports: [NgClass, CountUpDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
      @for (item of items; track item.label; let i = $index) {
        <div class="rounded-[24px] p-5" [ngClass]="toneClass(item, i)">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm text-gray-600">{{ item.label }}</p>
            @if (item.icon) {
              <ion-icon [name]="item.icon" class="shrink-0 text-lg text-gray-500" aria-hidden="true"></ion-icon>
            }
          </div>
          @if (!loading && item.countUp && isNumber(item.value)) {
            <p class="mt-2 inline-block text-3xl font-bold text-gray-900" [appCountUp]="$any(item.value)">0</p>
          } @else {
            <p class="mt-2 text-3xl font-bold text-gray-900">{{ display(item) }}</p>
          }
          @if (item.hint) {
            <p class="mt-1 text-xs text-gray-500">{{ item.hint }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class StatCardsComponent {
  @Input() items: readonly StatCardItem[] = [];
  /** Mientras carga, todas las cifras muestran "—". */
  @Input() loading = false;

  toneClass(item: StatCardItem, index: number): string {
    const tone = item.tone ?? DEFAULT_TONE_CYCLE[index % DEFAULT_TONE_CYCLE.length];
    return TONE_CLASSES[tone];
  }

  isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  display(item: StatCardItem): string {
    if (this.loading || item.value === null || item.value === undefined || item.value === '') {
      return '—';
    }
    return String(item.value);
  }
}
