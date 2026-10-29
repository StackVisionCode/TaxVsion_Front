import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/** 'solid': barra llena. 'striped': rayada, para distinguir la serie sin depender del color. */
export type TrendBarTone = 'solid' | 'striped';

export interface TrendBarSeries {
  name: string;
  values: readonly number[];
  tone: TrendBarTone;
}

/**
 * Tope "redondo" y par del eje para que la línea guía del medio también caiga en un entero.
 * Con pocos datos el mínimo es 4 (0 · 2 · 4).
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const factor = [1, 2, 4, 6, 8, 10].find((item) => item * magnitude >= value) ?? 10;
  return factor * magnitude;
}

/** Cada cuántos buckets se rotula el eje X para no amontonar etiquetas. */
export function labelStride(count: number, maxLabels = 7): number {
  return count <= maxLabels ? 1 : Math.ceil(count / maxLabels);
}

/**
 * Barras agrupadas de una serie temporal (p. ej. enviadas vs completadas por día). Sin librería: HTML +
 * CSS, nítido a cualquier ancho. Accesible: el gráfico es una imagen con `ariaLabel` (el resumen lo
 * arma quien lo usa) y debajo va la tabla con los mismos datos. El tooltip al pasar el ratón es solo
 * visual; la tabla es la alternativa de teclado y lector de pantalla.
 */
@Component({
  selector: 'app-trend-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    .bar {
      transform-origin: bottom;
      animation: bar-grow 520ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    @keyframes bar-grow {
      from { transform: scaleY(0); }
      to { transform: scaleY(1); }
    }
    .striped {
      background-image: repeating-linear-gradient(
        135deg,
        currentColor 0 3px,
        transparent 3px 6px
      );
      box-shadow: inset 0 0 0 1px currentColor;
    }
    @media (prefers-reduced-motion: reduce) {
      .bar { animation: none; }
    }
  `,
  template: `
    <div class="flex flex-wrap items-center gap-4 text-xs text-gray-600" aria-hidden="true">
      @for (item of series(); track item.name) {
        <span class="inline-flex items-center gap-1.5">
          <span class="h-3 w-3 rounded-sm text-brand-bold" [class]="swatchClass(item.tone)"></span>
          {{ item.name }}
        </span>
      }
    </div>

    <div class="relative mt-3 flex gap-2" role="img" [attr.aria-label]="ariaLabel()">
      <div class="flex w-8 shrink-0 flex-col justify-between pb-6 text-right text-xs text-gray-400" aria-hidden="true">
        <span>{{ max() }}</span>
        <span>{{ max() / 2 }}</span>
        <span>0</span>
      </div>
      <div class="relative min-w-0 flex-1" aria-hidden="true">
        <div class="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
          <div class="border-t border-dashed border-gray-100"></div>
          <div class="border-t border-dashed border-gray-100"></div>
          <div class="border-t border-gray-200"></div>
        </div>
        <div class="relative flex h-48 items-end gap-[3px] sm:gap-1.5" [style.padding-bottom.rem]="1.5">
          @for (label of labels(); track $index; let index = $index) {
            <div class="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              (mouseenter)="active.set(index)" (mouseleave)="active.set(null)">
              <div class="flex h-full items-end justify-center gap-[2px]"
                [class.opacity-60]="active() !== null && active() !== index">
                @for (item of series(); track item.name) {
                  <div class="bar w-full max-w-4 rounded-t text-brand-bold" [class]="barClass(item.tone)"
                    [style.height.%]="height(valueAt(item, index))"
                    [style.min-height.px]="valueAt(item, index) > 0 ? 2 : 0"></div>
                }
              </div>
              <!-- Centrada y sin recorte: la barra es más angosta que "Oct 12"; el stride evita solapes. -->
              <span class="absolute left-1/2 -bottom-6 w-max -translate-x-1/2 whitespace-nowrap text-xs text-gray-400"
                [class.invisible]="index % stride() !== 0">{{ label }}</span>
              @if (active() === index) {
                <div class="absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-xl bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
                  <p class="font-semibold">{{ label }}</p>
                  @for (item of series(); track item.name) {
                    <p class="mt-0.5 text-white/80">{{ item.name }}: <span class="font-semibold text-white">{{ valueAt(item, index) }}</span></p>
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>

    <details class="mt-4 text-sm">
      <summary class="cursor-pointer select-none text-xs font-semibold text-brand-bold hover:text-brand-ink">
        View as table
      </summary>
      <div class="mt-2 max-h-64 overflow-auto rounded-xl border border-gray-100">
        <table class="w-full text-left text-xs">
          <caption class="sr-only">{{ ariaLabel() }}</caption>
          <thead class="sticky top-0 bg-gray-50 text-gray-500">
            <tr>
              <th scope="col" class="px-3 py-2 font-semibold">{{ periodHeader() }}</th>
              @for (item of series(); track item.name) {
                <th scope="col" class="px-3 py-2 text-right font-semibold">{{ item.name }}</th>
              }
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            @for (label of labels(); track $index; let index = $index) {
              <tr>
                <th scope="row" class="px-3 py-1.5 font-medium text-gray-700">{{ label }}</th>
                @for (item of series(); track item.name) {
                  <td class="px-3 py-1.5 text-right tabular-nums text-gray-700">{{ valueAt(item, index) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </details>
  `,
})
export class TrendBarsComponent {
  readonly labels = input<readonly string[]>([]);
  readonly series = input<readonly TrendBarSeries[]>([]);
  /** Resumen en texto del gráfico (lo lee el lector de pantalla y titula la tabla). */
  readonly ariaLabel = input('Trend');
  readonly periodHeader = input('Period');

  readonly active = signal<number | null>(null);
  readonly max = computed(() => niceMax(Math.max(0, ...this.series().flatMap((item) => item.values))));
  readonly stride = computed(() => labelStride(this.labels().length));

  /** Un bucket sin dato en una serie cuenta como 0. */
  valueAt(series: TrendBarSeries, index: number): number {
    return series.values[index] ?? 0;
  }

  height(value: number): number {
    return Math.min(100, (value / this.max()) * 100);
  }

  barClass(tone: TrendBarTone): string {
    return tone === 'striped' ? 'striped opacity-70' : 'bg-current';
  }

  swatchClass(tone: TrendBarTone): string {
    return tone === 'striped' ? 'striped opacity-70' : 'bg-current';
  }
}
