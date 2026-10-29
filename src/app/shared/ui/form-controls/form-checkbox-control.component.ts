import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-form-checkbox-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3">
      <input
        [id]="id"
        type="checkbox"
        class="mt-0.5 h-4 w-4 accent-brand-bold"
        [checked]="checked"
        [required]="required"
        [disabled]="disabled"
        [attr.aria-describedby]="describedBy"
        [attr.aria-invalid]="invalid"
        (change)="checkedChange.emit($any($event.target).checked)"
      />
      <span class="text-sm text-gray-800"><ng-content /></span>
    </label>
  `,
})
export class FormCheckboxControlComponent {
  @Input() id = '';
  @Input() checked = false;
  @Input() required = false;
  @Input() disabled = false;
  @Input() describedBy: string | null = null;
  @Input() invalid = false;
  @Output() readonly checkedChange = new EventEmitter<boolean>();
}
