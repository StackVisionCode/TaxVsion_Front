import { Component } from '@angular/core';
import { numberProp, stringProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

@Component({
  selector: 'app-dc-currency-field',
  imports: [DcFieldShellComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><div class="relative">
      <span
        class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-gray-600"
        >{{ currency }}</span
      ><input
        [id]="inputId"
        type="number"
        inputmode="decimal"
        step="0.01"
        class="dc-input pl-14"
        [value]="value ?? ''"
        [min]="min"
        [max]="max"
        [required]="component.required === true"
        [attr.aria-describedby]="describedBy"
        [attr.aria-invalid]="!!errorMessage"
        [readOnly]="readonly"
        (input)="emitValue($any($event.target).value)"
      /></div
  ></app-dc-field-shell>`,
})
export class DcCurrencyFieldComponent extends DcFieldBase<string> {
  get currency(): string {
    return stringProp(this.component.props, 'currency') ?? 'USD';
  }
  get min(): number | null {
    return numberProp(this.component.props, 'min');
  }
  get max(): number | null {
    return numberProp(this.component.props, 'max');
  }
}
