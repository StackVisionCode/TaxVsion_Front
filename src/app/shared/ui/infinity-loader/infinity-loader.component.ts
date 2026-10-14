import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type InfinityLoaderSize = 'xs' | 'sm' | 'md' | 'lg';
export type InfinityLoaderTone = 'brand' | 'light';

const SIZE_PX: Record<InfinityLoaderSize, number> = { xs: 18, sm: 26, md: 44, lg: 72 };

/**
 * Indicador de carga de toda la app: un infinito (el símbolo de Taxoffix) que se dibuja con la
 * misma luz azul del hero del landing — una cabeza brillante recorre el trazo dejando estela.
 *
 * Reemplaza a los `animate-spin`. Es `inline-flex`, así que entra igual en un botón (`xs`/`sm`),
 * junto a un texto o centrado en una pantalla (`md`/`lg`). `tone="light"` es para fondos oscuros
 * (botones Twilight/azules).
 */
@Component({
  selector: 'app-infinity-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.aria-label]': 'label()', class: 'inline-flex shrink-0 align-middle' },
  template: `
    <svg
      class="infinity-loader"
      [class.infinity-light]="tone() === 'light'"
      [attr.width]="px()"
      [attr.height]="px() / 2"
      viewBox="0 0 64 32"
      fill="none"
      aria-hidden="true"
    >
      <path class="il-base" [attr.d]="path" pathLength="100" />
      <path class="il-trail" [attr.d]="path" pathLength="100" />
      <path class="il-head" [attr.d]="path" pathLength="100" />
    </svg>
  `,
  styles: [
    `
      .infinity-loader {
        overflow: visible;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 3;
      }
      .il-base {
        stroke: #057bc1;
        opacity: 0.18;
      }
      .il-trail {
        stroke: #057bc1;
        stroke-dasharray: 26 74;
        animation: il-run 1.6s cubic-bezier(0.45, 0, 0.35, 1) infinite;
        opacity: 0.55;
      }
      .il-head {
        stroke: #4dd8ff;
        stroke-dasharray: 8 92;
        animation: il-run 1.6s cubic-bezier(0.45, 0, 0.35, 1) infinite;
        filter: drop-shadow(0 0 3px rgba(77, 216, 255, 0.95));
      }
      .infinity-light .il-base {
        stroke: #ffffff;
        opacity: 0.25;
      }
      .infinity-light .il-trail {
        stroke: #4dd8ff;
        opacity: 0.6;
      }
      .infinity-light .il-head {
        stroke: #ffffff;
      }
      @keyframes il-run {
        from {
          stroke-dashoffset: 0;
        }
        to {
          stroke-dashoffset: -100;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .il-trail,
        .il-head {
          animation: il-pulse 2s ease-in-out infinite;
          stroke-dasharray: 100 0;
        }
        .il-trail {
          opacity: 0.3;
        }
      }
      @keyframes il-pulse {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 1;
        }
      }
    `,
  ],
})
export class InfinityLoaderComponent {
  readonly size = input<InfinityLoaderSize>('sm');
  readonly tone = input<InfinityLoaderTone>('brand');
  readonly label = input('Loading');

  protected readonly px = computed(() => SIZE_PX[this.size()]);

  /** Lemniscata: dos lazos unidos en el centro (32,16). */
  protected readonly path =
    'M32 16 C24 4 14 4 10 4 C5 4 2 9 2 16 C2 23 5 28 10 28 C14 28 24 28 32 16 C40 4 50 4 54 4 C59 4 62 9 62 16 C62 23 59 28 54 28 C50 28 40 28 32 16 Z';
}
