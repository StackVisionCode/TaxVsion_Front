import { Component } from '@angular/core';
import { intProp, numberProp, stringProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

@Component({
  selector: 'app-dc-number-field',
  imports: [DcFieldShellComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><div class="flex items-center gap-2">
      <input
        [id]="inputId"
        type="number"
        inputmode="decimal"
        class="dc-input"
        [value]="value ?? ''"
        [min]="min"
        [max]="max"
        [step]="step"
        [required]="component.required === true"
        [attr.aria-describedby]="describedBy"
        [attr.aria-invalid]="!!errorMessage"
        [readOnly]="readonly"
        (input)="emitValue($any($event.target).value)"
      />
      @if (unitLabel) {
        <span class="text-sm font-medium text-gray-600">{{ unitLabel }}</span>
      }
    </div></app-dc-field-shell
  >`,
})
export class DcNumberFieldComponent extends DcFieldBase<string> {
  get min(): number | null {
    return numberProp(this.component.props, 'min');
  }
  get max(): number | null {
    return numberProp(this.component.props, 'max');
  }
  get step(): string {
    const decimals = intProp(this.component.props, 'decimals', 0);
    return decimals === 0 ? '1' : `0.${'0'.repeat(Math.max(0, decimals - 1))}1`;
  }
  get unitLabel(): string {
    return stringProp(this.component.props, 'unitLabel') ?? '';
  }
}
