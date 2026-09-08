import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Placeholder de carga genérico.
 *
 * Existe para que "cargando" deje de ser un hueco en blanco: reserva EXACTAMENTE el alto
 * del contenido real, así el layout no salta cuando llega — mismo criterio que ya usaban
 * a mano varias pantallas con su `min-h-[260px]`.
 *
 * - `card`  → tarjeta de widget (barra de título + n líneas).
 * - `rows`  → n filas de tabla/lista.
 * - `block` → un solo bloque del alto indicado.
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="animate-pulse" [style.min-height]="minHeight()" aria-hidden="true">
      @switch (variant()) {
        @case ('card') {
          <div class="h-full rounded-[28px] bg-white p-6">
            <div class="h-4 w-1/3 rounded-full bg-gray-200"></div>
            <div class="mt-6 space-y-3">
              @for (row of rowList(); track $index) {
                <div class="h-3 rounded-full bg-gray-100"></div>
              }
            </div>
          </div>
        }
        @case ('rows') {
          <div class="space-y-3">
            @for (row of rowList(); track $index) {
              <div class="h-10 rounded-2xl bg-gray-100"></div>
            }
          </div>
        }
        @default {
          <div class="h-full w-full rounded-[28px] bg-gray-100"></div>
        }
      }
    </div>
  `,
  styles: `
    /* Accesibilidad: sin pulso con reduced-motion. El hueco reservado ya comunica
       "esto está por llegar" sin necesidad de animación. */
    @media (prefers-reduced-motion: reduce) {
      .animate-pulse {
        animation: none;
      }
    }
  `,
})
export class SkeletonComponent {
  readonly variant = input<'card' | 'rows' | 'block'>('card');
  readonly minHeight = input('10rem');
  readonly rows = input(3);

  protected readonly rowList = computed(() => Array.from({ length: this.rows() }));
}
