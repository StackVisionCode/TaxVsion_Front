import { Component } from '@angular/core';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { optionsOf } from '../data-collection.utils';
import { DcFieldBase } from './dc-field-base';
import { FormRadioControlComponent } from '@shared/ui/form-controls/form-radio-control.component';

@Component({
  selector: 'app-dc-radio-field',
  imports: [DcMarkdownComponent, FormRadioControlComponent],
  template: `<fieldset
    [id]="inputId"
    tabindex="-1"
    class="space-y-3"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="!!errorMessage"
  >
    <legend class="text-sm font-semibold text-gray-900">
      {{ component.label || 'Choose one' }}
      @if (component.required) {
        <span class="text-red-600" aria-hidden="true">*</span>
      }
    </legend>
    @if (component.help) {
      <div [id]="helpId" class="text-sm text-gray-600">
        <app-dc-markdown [document]="component.help" />
      </div>
    }
    <div class="grid gap-2" [class.sm:grid-cols-2]="horizontal">
      @for (option of options; track option.value) {
        <app-form-radio-control
          [id]="inputId + '-' + option.value"
          [name]="inputId"
          [value]="option.value"
          [checked]="value === option.value"
          [disabled]="readonly"
          [describedBy]="describedBy"
          (selected)="emitValue($event)"
        >{{ option.label }}</app-form-radio-control>
      }
    </div>
    @if (errorMessage) {
      <p [id]="errorId" class="text-sm font-medium text-red-700">{{ errorMessage }}</p>
    }
  </fieldset>`,
})
export class DcRadioFieldComponent extends DcFieldBase<string> {
  get options() {
    return optionsOf(this.component);
  }
  get horizontal(): boolean {
    return this.component.props?.['layout'] === 'horizontal';
  }
}
