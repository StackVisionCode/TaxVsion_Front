import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, input, output } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { DayHoursForm } from '../../data-access/company-settings.model';
import { copyMondayToWeekdays, hoursErrors } from '../../utils/business-hours';

/** Editor semanal: por día abierto/cerrado y abre/cierra (`HH:mm`); el cierre debe ser posterior. */
@Component({
  selector: 'app-business-hours-editor',
  imports: [SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p id="hours-label" class="text-sm font-semibold text-gray-900">Business hours</p>
      <button type="button" class="pf-btn pf-btn--ghost pf-btn--sm" (click)="copyMonday()" [disabled]="disabled()">
        <ion-icon name="copy-outline"></ion-icon>Copy Monday to weekdays
      </button>
    </div>
    <ul class="mt-3 flex flex-col divide-y divide-gray-100 rounded-2xl border border-gray-100" aria-labelledby="hours-label">
      @for (d of hours(); track d.day; let i = $index) {
        <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div class="flex items-center justify-between gap-3 sm:w-40 sm:shrink-0">
            <span class="text-sm font-medium text-gray-900">{{ d.day }}</span>
            <app-switch size="sm" [checked]="d.open" [disabled]="disabled()" [ariaLabel]="'Open on ' + d.day"
              (checkedChange)="update(i, { open: $event })" />
          </div>
          @if (d.open) {
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex items-center gap-2">
                <input type="time" class="pf-input tabular-nums" [value]="d.opens" (input)="time(i, 'opens', $event)" [disabled]="disabled()"
                  [class.border-red-400]="!!errors()[d.day]" [attr.aria-label]="d.day + ' opens'" [attr.aria-invalid]="!!errors()[d.day]" />
                <span class="text-sm text-gray-400" aria-hidden="true">–</span>
                <input type="time" class="pf-input tabular-nums" [value]="d.closes" (input)="time(i, 'closes', $event)" [disabled]="disabled()"
                  [class.border-red-400]="!!errors()[d.day]" [attr.aria-label]="d.day + ' closes'" [attr.aria-invalid]="!!errors()[d.day]" />
              </div>
              @if (errors()[d.day]; as err) {
                <span class="text-xs text-red-600" role="alert">{{ err }}</span>
              }
            </div>
          } @else {
            <span class="text-sm text-gray-400">Closed</span>
          }
        </li>
      }
    </ul>
    @if (backendError(); as err) {
      <p class="mt-2 text-xs text-red-600" role="alert">{{ err }}</p>
    }
  `,
})
export class BusinessHoursEditorComponent {
  readonly hours = input.required<DayHoursForm[]>();
  readonly disabled = input(false);
  /** Error del 400 de Tenant (`Tenant.Profile.BusinessHours`), sin día concreto. */
  readonly backendError = input<string | null | undefined>(null);

  readonly hoursChange = output<DayHoursForm[]>();

  readonly errors = computed(() => hoursErrors(this.hours()));

  update(index: number, patch: Partial<DayHoursForm>): void {
    this.hoursChange.emit(this.hours().map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  time(index: number, key: 'opens' | 'closes', event: Event): void {
    this.update(index, { [key]: (event.target as HTMLInputElement).value });
  }

  copyMonday(): void {
    this.hoursChange.emit(copyMondayToWeekdays(this.hours()));
  }
}
