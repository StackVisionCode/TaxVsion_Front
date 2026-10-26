import { Component } from '@angular/core';
import { intProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';
import { FormTextareaControlComponent } from '@shared/ui/form-controls/form-textarea-control.component';

@Component({
  selector: 'app-dc-textarea-field',
  imports: [DcFieldShellComponent, FormTextareaControlComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
  >
    <app-form-textarea-control
      [id]="inputId"
      [rows]="rows"
      [maxLength]="maxLength"
      [required]="component.required === true"
      [describedBy]="describedBy"
      [invalid]="!!errorMessage"
      [readonly]="readonly"
      [value]="value ?? ''"
      (valueChange)="emitValue($event)"
    />
  </app-dc-field-shell>`,
})
export class DcTextareaFieldComponent extends DcFieldBase<string> {
  get rows(): number {
    return intProp(this.component.props, 'rows', 4);
  }
  get maxLength(): number {
    return intProp(this.component.props, 'maxLength', 2000);
  }
}
