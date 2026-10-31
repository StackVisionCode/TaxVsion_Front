import { Component, Input } from '@angular/core';

/** Tarjeta de un grupo de ajustes (mismo estilo que Settings → Signature). Las filas van proyectadas. */
@Component({
  selector: 'app-comm-settings-section',
  template: `
    <section class="rounded-[1.5rem] border border-gray-100 bg-white p-6 shadow-sm">
      <h2 class="text-lg font-bold text-gray-900">{{ heading }}</h2>
      @if (description) {
        <p class="mt-1 text-sm text-gray-500">{{ description }}</p>
      }
      <div class="mt-4 divide-y divide-gray-100">
        <ng-content></ng-content>
      </div>
    </section>
  `,
})
export class CommSettingsSectionComponent {
  @Input({ required: true }) heading = '';
  @Input() description = '';
}
