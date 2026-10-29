import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';
import type { FormRepeat } from '@shared/utils/data-collection/form-definition.model';

@Component({
  selector: 'app-repeater-settings',
  imports: [FormCheckboxControlComponent, FormTextControlComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="border-t border-gray-100 pt-4">
      <h3 class="text-sm font-bold text-gray-900">Repeating rows</h3>
      <app-form-checkbox-control
        class="mt-3 block"
        [checked]="repeat != null"
        (checkedChange)="toggle($event)"
        >Allow multiple rows</app-form-checkbox-control
      >
      @if (repeat) {
        <div class="mt-3 grid grid-cols-2 gap-3">
          <label class="text-xs font-semibold text-gray-600"
            >Minimum rows<app-form-text-control
              class="mt-1 block"
              type="number"
              [value]="String(repeat.minRows)"
              (valueChange)="numberChanged('minRows', $event)"
          /></label>
          <label class="text-xs font-semibold text-gray-600"
            >Maximum rows<app-form-text-control
              class="mt-1 block"
              type="number"
              [value]="String(repeat.maxRows)"
              (valueChange)="numberChanged('maxRows', $event)"
          /></label>
          <label class="col-span-2 text-xs font-semibold text-gray-600"
            >Row label<app-form-text-control
              class="mt-1 block"
              [value]="repeat.rowLabel"
              [maxLength]="60"
              (valueChange)="patch({ rowLabel: $event })"
          /></label>
          <label class="col-span-2 text-xs font-semibold text-gray-600"
            >Add button label<app-form-text-control
              class="mt-1 block"
              [value]="repeat.addLabel"
              [maxLength]="60"
              (valueChange)="patch({ addLabel: $event })"
          /></label>
        </div>
      }
    </section>
  `,
})
export class RepeaterSettingsComponent {
  @Input() repeat: FormRepeat | null = null;
  @Output() readonly repeatChange = new EventEmitter<FormRepeat | null>();
  readonly String = String;

  toggle(enabled: boolean): void {
    this.repeatChange.emit(
      enabled ? { minRows: 0, maxRows: 5, rowLabel: 'Row', addLabel: 'Add row' } : null,
    );
  }

  patch(update: Partial<FormRepeat>): void {
    if (this.repeat) this.repeatChange.emit({ ...this.repeat, ...update });
  }

  numberChanged(key: 'minRows' | 'maxRows', value: string): void {
    const number = Number(value);
    if (Number.isInteger(number)) this.patch({ [key]: Math.max(0, Math.min(50, number)) });
  }
}
