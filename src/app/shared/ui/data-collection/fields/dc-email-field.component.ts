import { Component } from '@angular/core';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

@Component({
  selector: 'app-dc-email-field',
  imports: [DcFieldShellComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><input
      [id]="inputId"
      type="email"
      inputmode="email"
      autocomplete="email"
      class="dc-input"
      [value]="value ?? ''"
      [required]="component.required === true"
      [attr.aria-describedby]="describedBy"
      [attr.aria-invalid]="!!errorMessage"
      [readOnly]="readonly"
      (input)="emitValue($any($event.target).value)"
  /></app-dc-field-shell>`,
})
export class DcEmailFieldComponent extends DcFieldBase<string> {}
