import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-form-text-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<input
    [id]="id"
    [type]="type"
    class="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-light focus:ring-2 focus:ring-brand-light/30 disabled:bg-gray-100"
    [value]="value ?? ''"
    [required]="required"
    [readOnly]="readonly"
    [disabled]="disabled"
    [attr.maxlength]="maxLength"
    [attr.minlength]="minLength"
    [attr.min]="min"
    [attr.max]="max"
    [attr.step]="step"
    [attr.autocomplete]="autocomplete"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="invalid"
    (input)="valueChange.emit($any($event.target).value)"
  />`,
})
export class FormTextControlComponent {
  @Input() id = '';
  @Input() type = 'text';
  @Input() value: string | null = null;
  @Input() required = false;
  @Input() readonly = false;
  @Input() disabled = false;
  @Input() maxLength: number | null = null;
  @Input() minLength: number | null = null;
  @Input() min: number | string | null = null;
  @Input() max: number | string | null = null;
  @Input() step: number | string | null = null;
  @Input() autocomplete: string | null = null;
  @Input() describedBy: string | null = null;
  @Input() invalid = false;
  @Output() readonly valueChange = new EventEmitter<string>();
}
