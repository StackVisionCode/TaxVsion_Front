import { Component } from '@angular/core';
import { intProp, stringProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';
import { FormTextControlComponent } from '@shared/ui/form-controls/form-text-control.component';

@Component({
  selector: 'app-dc-text-field',
  imports: [DcFieldShellComponent, FormTextControlComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><app-form-text-control
      [id]="inputId"
      [value]="value ?? ''"
      [required]="component.required === true"
      [maxLength]="maxLength"
      [minLength]="minLength"
      [autocomplete]="autocomplete"
      [describedBy]="describedBy"
      [invalid]="!!errorMessage"
      [readonly]="readonly"
      (valueChange)="emitValue($event)"
  /></app-dc-field-shell>`,
})
export class DcTextFieldComponent extends DcFieldBase<string> {
  get maxLength(): number {
    return intProp(this.component.props, 'maxLength', 200);
  }
  get minLength(): number {
    return intProp(this.component.props, 'minLength', 0);
  }
  get autocomplete(): string {
    return stringProp(this.component.props, 'autocomplete') ?? 'off';
  }
}
