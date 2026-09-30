import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';

export type StateBlockVariant = 'card' | 'inline';

/**
 * Bloque de estado genérico: cargando / error / vacío, o el contenido proyectado cuando ninguno aplica.
 * Promovido desde `features/dashboard/ui/dashboard-widget-state` (que sigue existiendo hasta la fase 2)
 * y generalizado con los bloques de error/vacío que se repetían en clients, import-history, etc.
 *
 * Uso:
 * ```html
 * <app-state-block [loading]="store.loading()" [error]="store.error()" [empty]="rows().length === 0"
 *   emptyTitle="No invoices yet" icon="receipt-outline" (retry)="store.reload()">
 *   <app-invoice-table [rows]="rows()" />
 * </app-state-block>
 * ```
 *
 * Prioridad: loading > error > empty > contenido.
 * - Loading: spinner `sync-outline` + `loadingText` ("Loading…"). No usa `app-skeleton` porque el
 *   tamaño del contenido real varía por pantalla; quien quiera skeleton lo pinta fuera.
 * - Error: `rounded-2xl border border-red-100 bg-red-50 px-6 py-8` + `<p class="text-sm text-red-600">`
 *   y botón Retry (píldora brand) si `showRetry` (default true). `(retry)` lo emite.
 * - Empty: icono `text-3xl text-gray-300` + `emptyTitle` (`mt-2 text-sm text-gray-500`) + `emptyMessage`
 *   opcional (`mt-1 text-xs text-gray-400`).
 * - `variant`: 'card' (default) envuelve vacío/cargando en un recuadro `rounded-2xl border border-gray-100`
 *   con `py-12` (como las pestañas del perfil de cliente); 'inline' sin borde y con menos aire.
 * - `minHeight`: alto mínimo (CSS) de los tres estados para que la grilla no salte.
 *
 * Normalizado respecto a dashboard-widget-state: el error allí era un círculo naranja + `errorTitle`;
 * aquí es el bloque rojo con Retry que usaban la mayoría de features (el dashboard lo adoptará en fase 2).
 */
@Component({
  selector: 'app-state-block',
  imports: [NgClass],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (loading) {
      <div class="flex items-center justify-center gap-2 text-sm text-gray-400" role="status"
        [ngClass]="variant === 'card' ? 'py-10' : 'py-6'" [style.min-height]="minHeight || null">
        <ion-icon name="sync-outline" class="animate-spin text-base"></ion-icon>
        {{ loadingText }}
      </div>
    } @else if (error) {
      <div class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-center"
        role="alert" [style.min-height]="minHeight || null">
        <p class="text-sm text-red-600">{{ error }}</p>
        @if (showRetry) {
          <button type="button" (click)="retry.emit()"
            class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink">
            {{ retryLabel }}
          </button>
        }
      </div>
    } @else if (empty) {
      <div class="flex flex-col items-center justify-center text-center"
        [ngClass]="variant === 'card' ? 'rounded-2xl border border-gray-100 px-4 py-12' : 'px-4 py-8'"
        [style.min-height]="minHeight || null">
        <ion-icon [name]="icon" class="text-3xl text-gray-300"></ion-icon>
        <p class="mt-2 text-sm text-gray-500">{{ emptyTitle }}</p>
        @if (emptyMessage) {
          <p class="mt-1 max-w-sm text-xs text-gray-400">{{ emptyMessage }}</p>
        }
      </div>
    } @else {
      <ng-content></ng-content>
    }
  `,
})
export class StateBlockComponent {
  @Input() loading = false;
  /** Mensaje de error ya normalizado (p. ej. `toApiError(err).message`); null/'' = sin error. */
  @Input() error: string | null | undefined = null;
  @Input() empty = false;
  @Input() emptyTitle = 'Nothing here yet';
  @Input() emptyMessage = '';
  /** Icono ionicons del estado vacío. */
  @Input() icon = 'file-tray-outline';
  @Input() loadingText = 'Loading…';
  @Input() variant: StateBlockVariant = 'card';
  /** Alto mínimo CSS de los estados (p. ej. '10rem'); vacío = sin mínimo. */
  @Input() minHeight = '';
  @Input() showRetry = true;
  @Input() retryLabel = 'Retry';
  @Output() readonly retry = new EventEmitter<void>();
}
