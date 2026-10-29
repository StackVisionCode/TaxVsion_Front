import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-form-radio-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label
      class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2"
    >
      <input
        [id]="id"
        type="radio"
        class="h-4 w-4 accent-brand-bold"
        [name]="name"
        [value]="value"
        [checked]="checked"
        [disabled]="disabled"
        [attr.aria-describedby]="describedBy"
        (change)="selected.emit(value)"
      />
      <span class="text-sm text-gray-800"><ng-content /></span>
    </label>
  `,
})
export class FormRadioControlComponent {
  @Input() id = '';
  @Input() name = '';
  @Input() value = '';
  @Input() checked = false;
  @Input() disabled = false;
  @Input() describedBy: string | null = null;
  @Output() readonly selected = new EventEmitter<string>();
}
