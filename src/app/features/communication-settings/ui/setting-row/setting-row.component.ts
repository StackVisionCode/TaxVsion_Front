import { CUSTOM_ELEMENTS_SCHEMA, Component, Input } from '@angular/core';

/** Una fila de ajuste: texto a la izquierda, control a la derecha (proyectado). */
@Component({
  selector: 'app-comm-setting-row',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div class="min-w-0">
        <p class="text-sm font-semibold text-gray-900" [class.text-gray-400]="locked">{{ label }}</p>
        @if (hint) {
          <p class="mt-0.5 text-xs text-gray-500">{{ hint }}</p>
        }
        @if (locked && lockedReason) {
          <p class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700" data-role="setting-locked">
            <ion-icon name="information-circle-outline" class="text-sm"></ion-icon>{{ lockedReason }}
          </p>
        }
      </div>
      <div class="shrink-0">
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class CommSettingRowComponent {
  @Input({ required: true }) label = '';
  @Input() hint = '';
  /** El plan o la plataforma fijan este valor: se muestra pero no se puede cambiar. */
  @Input() locked = false;
  @Input() lockedReason = '';
}
