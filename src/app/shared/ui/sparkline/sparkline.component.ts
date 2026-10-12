import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SparklineTone = 'sky' | 'sand' | 'sage' | 'navy' | 'white';

const TONE_CLASSES: Record<SparklineTone, string> = {
  sky: 'text-orange-500',
  sand: 'text-sand-500',
  sage: 'text-sage-500',
  navy: 'text-brand-bold',
  white: 'text-white/80',
};

const WIDTH = 100;
const HEIGHT = 32;
const PAD = 2;

/**
 * Puntos "x,y x,y …" de una línea que recorre `values` de izquierda a derecha dentro de un lienzo
 * `w × h` (con `pad` de margen vertical). Sin valores → ''. Un solo valor o todos iguales → línea
 * plana sobre la base, para no inventar una pendiente.
 */
export function sparklinePoints(values: readonly number[], w = WIDTH, h = HEIGHT, pad = PAD): string {
  if (values.length === 0) {
    return '';
  }
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min;
  const step = w / (series.length - 1);
  return series
    .map((v, i) => {
      const y = range === 0 ? h - pad : h - pad - ((v - min) / range) * (h - pad * 2);
      return `${round(i * step)},${round(y)}`;
    })
    .join(' ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Mini-gráfica de tendencia (línea + área suave) para KPIs. Puro SVG, sin librería: el color sale de
 * `currentColor` vía tokens de Tailwind (`tone`), así que no hay hex sueltos. Se estira al tamaño del
 * host (darle alto con una clase, p. ej. `class="block h-8"`).
 *
 * Movimiento: la línea se "dibuja" al aparecer (stroke-dashoffset); con reduced-motion aparece fija.
 */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    .spark-line {
      animation: spark-draw 900ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    @keyframes spark-draw {
      from { stroke-dashoffset: 1; }
      to { stroke-dashoffset: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .spark-line { animation: none; }
    }
  `,
  template: `
    @if (points()) {
      <svg [attr.viewBox]="viewBox" preserveAspectRatio="none" class="h-full w-full overflow-visible"
        [class]="toneClass()" role="img" [attr.aria-label]="ariaLabel()">
        @if (area()) {
          <polygon [attr.points]="areaPoints()" fill="currentColor" fill-opacity="0.15" stroke="none"></polygon>
        }
        <polyline class="spark-line" [attr.points]="points()" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"
          pathLength="1" stroke-dasharray="1"></polyline>
      </svg>
    }
  `,
})
export class SparklineComponent {
  readonly values = input<readonly number[]>([]);
  readonly tone = input<SparklineTone>('navy');
  readonly area = input(true);
  readonly ariaLabel = input('Trend');

  readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  readonly points = computed(() => sparklinePoints(this.values()));
  readonly areaPoints = computed(() => {
    const line = this.points();
    return line ? `0,${HEIGHT} ${line} ${WIDTH},${HEIGHT}` : '';
  });
  readonly toneClass = computed(() => TONE_CLASSES[this.tone()]);
}
