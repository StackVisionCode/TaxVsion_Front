import { CUSTOM_ELEMENTS_SCHEMA, Component, input } from '@angular/core';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';

/** Encabezado de una tarjeta de Office Settings: icono, título (con id para aria-labelledby), cargando y bajada. */
@Component({
  selector: 'app-cs-section-header',
  imports: [InfinityLoaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'flex flex-wrap items-start gap-3' },
  template: `
    <span class="pf-icon-tile"><ion-icon [name]="icon()"></ion-icon></span>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h2 [id]="titleId()" class="text-lg font-bold text-gray-900">{{ heading() }}</h2>
        @if (loading()) {
          <app-infinity-loader size="xs" />
        }
      </div>
      <p class="mt-0.5 text-sm text-gray-500">{{ description() }}</p>
    </div>
    <ng-content />
  `,
})
export class SectionHeaderComponent {
  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  readonly titleId = input.required<string>();
  readonly description = input('');
  readonly loading = input(false);
}
