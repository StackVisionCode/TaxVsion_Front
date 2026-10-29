import { Component } from '@angular/core';
import { stringProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';
import { optionsOf } from '../data-collection.utils';
import { FormSelectControlComponent } from '@shared/ui/form-controls/form-select-control.component';

@Component({
  selector: 'app-dc-select-field',
  imports: [DcFieldShellComponent, FormSelectControlComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><app-form-select-control
      [id]="inputId"
      [value]="value ?? ''"
      [options]="options"
      [placeholder]="placeholder"
      [required]="component.required === true"
      [describedBy]="describedBy"
      [invalid]="!!errorMessage"
      [disabled]="readonly"
      (valueChange)="emitValue($event)"
    /></app-dc-field-shell
  >`,
})
export class DcSelectFieldComponent extends DcFieldBase<string> {
  get options() {
    return optionsOf(this.component);
  }
  get placeholder(): string {
    return stringProp(this.component.props, 'placeholder') ?? 'Select an option';
  }
}
