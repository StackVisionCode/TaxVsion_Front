import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { CountUpDirective } from '../../directives/count-up.directive';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Tintes de la paleta armónica (mismos que los tiles del dashboard): sky, arena, salvia, y `navy`
 * como tile focal sólido (texto en blanco). Los tintes necesitan ir dentro de una tarjeta blanca:
 * sand-100 directo sobre el canvas crema casi no se distingue.
 */
export type StatCardTone = 'sky' | 'sand' | 'sage' | 'navy' | 'white';

/**
 * Variación contra un período anterior. La dirección pinta la flecha; el sentimiento, el color (una
 * subida puede ser mala, p. ej. más vencidas). El texto lleva el dato: el color nunca va solo.
 */
export interface StatCardDelta {
  label: string;
  direction: 'up' | 'down' | 'flat';
  sentiment: 'positive' | 'negative' | 'neutral';
}

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
  /** Variación opcional bajo la cifra (flecha + texto). */
  delta?: StatCardDelta | null;
  /** Definición de la métrica: botón (i) con tooltip y el mismo texto para lectores de pantalla. */
  info?: string | null;
}

const TONE_CLASSES: Record<StatCardTone, string> = {
  sky: 'bg-orange-100',
  sand: 'bg-sand-100',
  sage: 'bg-sage-100',
  navy: 'bg-brand-bold',
  white: 'bg-white ring-1 ring-brand-line',
};

/** Rotación por defecto: sky → arena → salvia → arena. */
const DEFAULT_TONE_CYCLE: StatCardTone[] = ['sky', 'sand', 'sage', 'sand'];

const DELTA_ICONS: Record<StatCardDelta['direction'], string> = {
  up: 'trending-up-outline',
  down: 'trending-down-outline',
  flat: 'remove-outline',
};

const DELTA_CLASSES: Record<StatCardDelta['sentiment'], string> = {
  positive: 'bg-emerald-50 text-emerald-700',
  negative: 'bg-red-50 text-red-700',
  neutral: 'bg-gray-100 text-gray-600',
};

/**
 * Fila de tarjetas de métricas de la cabecera de las páginas (inventory, task, meetings, signature…).
 *
 * Uso: `<app-stat-cards [items]="stats()" [loading]="store.loading()" />` con
 * `stats = computed<StatCardItem[]>(() => [{ label: 'Total tasks', value: total() }, …])`.
 *
 * Markup idéntico a las copias: grid `grid gap-4 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]`,
 * tarjeta `rounded-[1.5rem] p-5`, etiqueta `text-sm text-gray-600`, cifra `mt-2 text-3xl font-bold
 * text-gray-900`. Con `countUp` la cifra lleva además `inline-block` (lo necesita el "pop" del
 * count-up, igual que en client-import). `loading` pinta "—" en todas (como signature/calls).
 */
@Component({
  selector: 'app-stat-cards',
  imports: [NgClass, CountUpDirective, TooltipDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="grid gap-4 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
      @for (item of items; track item.label; let i = $index) {
        @let dark = isDark(item);
        <div class="rounded-[1.5rem] p-5" [ngClass]="toneClass(item, i)">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm" [ngClass]="dark ? 'text-white/75' : 'text-gray-600'">
              {{ item.label }}
              @if (item.info) {
                <button type="button" class="-my-1 ml-0.5 inline-grid h-6 w-6 place-items-center rounded-full align-middle transition-colors"
                  [ngClass]="dark ? 'text-white/70 hover:bg-white/10' : 'text-gray-400 hover:bg-black/5 hover:text-gray-600'"
                  [appTooltip]="item.info" [attr.aria-label]="'About ' + item.label">
                  <ion-icon name="information-circle-outline" class="text-sm" aria-hidden="true"></ion-icon>
                </button>
                <span class="sr-only">{{ item.info }}</span>
              }
            </p>
            @if (item.icon) {
              <ion-icon [name]="item.icon" class="shrink-0 text-lg" [ngClass]="dark ? 'text-white/75' : 'text-gray-500'"
                aria-hidden="true"></ion-icon>
            }
          </div>
          @if (!loading && item.countUp && isNumber(item.value)) {
            <p class="mt-2 inline-block text-3xl font-bold" [ngClass]="dark ? 'text-white' : 'text-gray-900'"
              [appCountUp]="$any(item.value)">0</p>
          } @else {
            <p class="mt-2 text-3xl font-bold" [ngClass]="dark ? 'text-white' : 'text-gray-900'">{{ display(item) }}</p>
          }
          @if (!loading && item.delta) {
            <p class="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              [ngClass]="deltaClass(item.delta)">
              <ion-icon [name]="deltaIcon(item.delta)" class="text-sm" aria-hidden="true"></ion-icon>
              {{ item.delta.label }}
            </p>
          }
          @if (item.hint) {
            <p class="mt-1 text-xs" [ngClass]="dark ? 'text-white/75' : 'text-gray-600'">{{ item.hint }}</p>
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

  deltaIcon(delta: StatCardDelta): string {
    return DELTA_ICONS[delta.direction];
  }

  deltaClass(delta: StatCardDelta): string {
    return DELTA_CLASSES[delta.sentiment];
  }

  /** El tono navy no entra en la rotación por defecto: solo aplica cuando se pide explícito. */
  isDark(item: StatCardItem): boolean {
    return item.tone === 'navy';
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
