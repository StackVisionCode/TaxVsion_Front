import { Component } from '@angular/core';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { optionsOf } from '../data-collection.utils';
import { DcFieldBase } from './dc-field-base';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';

@Component({
  selector: 'app-dc-checkbox-group-field',
  imports: [DcMarkdownComponent, FormCheckboxControlComponent],
  template: `<fieldset
    [id]="inputId"
    tabindex="-1"
    class="space-y-3"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="!!errorMessage"
  >
    <legend class="text-sm font-semibold text-gray-900">
      {{ component.label || 'Choose all that apply' }}
      @if (component.required) {
        <span class="text-red-600" aria-hidden="true">*</span><span class="sr-only"> (required)</span>
      }
    </legend>
    @if (component.help) {
      <div [id]="helpId" class="text-sm text-gray-600">
        <app-dc-markdown [document]="component.help" />
      </div>
    }
    <div class="grid gap-2 sm:grid-cols-2">
      @for (option of options; track option.value) {
        <app-form-checkbox-control
            [id]="inputId + '-' + option.value"
            [checked]="selected(option.value)"
            [disabled]="readonly"
            [describedBy]="describedBy"
            (checkedChange)="toggle(option.value, $event)"
          >{{ option.label }}</app-form-checkbox-control>
      }
    </div>
    @if (errorMessage) {
      <p [id]="errorId" class="text-sm font-medium text-red-700">{{ errorMessage }}</p>
    }
  </fieldset>`,
})
export class DcCheckboxGroupFieldComponent extends DcFieldBase<string[]> {
  get options() {
    return optionsOf(this.component);
  }
  selected(option: string): boolean {
    return (this.value ?? []).includes(option);
  }
  toggle(option: string, checked: boolean): void {
    const current = this.value ?? [];
    this.emitValue(checked ? [...current, option] : current.filter((value) => value !== option));
  }
}
