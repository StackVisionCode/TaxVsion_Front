import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-form-textarea-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<textarea
    [id]="id"
    class="min-h-24 w-full resize-y rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-light focus:ring-2 focus:ring-brand-light/30 disabled:bg-gray-100"
    [rows]="rows"
    [value]="value ?? ''"
    [required]="required"
    [readOnly]="readonly"
    [disabled]="disabled"
    [attr.maxlength]="maxLength"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="invalid"
    (input)="valueChange.emit($any($event.target).value)"
  ></textarea>`,
})
export class FormTextareaControlComponent {
  @Input() id = '';
  @Input() value: string | null = null;
  @Input() rows = 4;
  @Input() required = false;
  @Input() readonly = false;
  @Input() disabled = false;
  @Input() maxLength: number | null = null;
  @Input() describedBy: string | null = null;
  @Input() invalid = false;
  @Output() readonly valueChange = new EventEmitter<string>();
}
