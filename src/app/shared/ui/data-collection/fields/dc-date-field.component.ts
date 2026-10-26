import { Component } from '@angular/core';
import { stringProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

@Component({
  selector: 'app-dc-date-field',
  imports: [DcFieldShellComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><input
      [id]="inputId"
      type="date"
      class="dc-input"
      [value]="value ?? ''"
      [min]="bound('min')"
      [max]="bound('max')"
      [required]="component.required === true"
      [attr.aria-describedby]="describedBy"
      [attr.aria-invalid]="!!errorMessage"
      [readOnly]="readonly"
      (input)="emitValue($any($event.target).value)"
  /></app-dc-field-shell>`,
})
export class DcDateFieldComponent extends DcFieldBase<string> {
  bound(name: string): string | null {
    const value = stringProp(this.component.props, name);
    return value === 'today' ? localToday() : value;
  }
}

// "Hoy" del calendario del usuario: toISOString() daría mañana en una tarde de EE. UU.
function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
