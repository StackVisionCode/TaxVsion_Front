import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface FormControlOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-form-select-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<select
    [id]="id"
    class="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-light focus:ring-2 focus:ring-brand-light/30 disabled:bg-gray-100"
    [value]="value ?? ''"
    [required]="required"
    [disabled]="disabled"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="invalid"
    (change)="valueChange.emit($any($event.target).value)"
  >
    <!-- [selected] por opción: el [value] del select se aplica antes de que existan las opciones. -->
    @if (placeholder) {
      <option value="" [selected]="!value">{{ placeholder }}</option>
    }
    @for (option of options; track option.value) {
      <option [value]="option.value" [selected]="option.value === value">{{ option.label }}</option>
    }
  </select>`,
})
export class FormSelectControlComponent {
  @Input() id = '';
  @Input() value: string | null = null;
  @Input() options: readonly FormControlOption[] = [];
  @Input() placeholder = 'Select an option';
  @Input() required = false;
  @Input() disabled = false;
  @Input() describedBy: string | null = null;
  @Input() invalid = false;
  @Output() readonly valueChange = new EventEmitter<string>();
}
