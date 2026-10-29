import { Component } from '@angular/core';
import { stringProp } from '@shared/utils/data-collection/properties';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { DcFieldBase } from './dc-field-base';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';

@Component({
  selector: 'app-dc-checkbox-field',
  imports: [DcMarkdownComponent, FormCheckboxControlComponent],
  template: `<div class="space-y-2">
    <app-form-checkbox-control
        [id]="inputId"
        [checked]="value === true"
        [required]="component.required === true"
        [disabled]="readonly"
        [describedBy]="describedBy"
        [invalid]="!!errorMessage"
        (checkedChange)="emitValue($event)"
      >{{ text }}
        @if (component.required) {
          <span class="text-red-600" aria-hidden="true">*</span>
        }
    </app-form-checkbox-control>
    @if (component.help) {
      <div [id]="helpId" class="text-sm text-gray-600">
        <app-dc-markdown [document]="component.help" />
      </div>
    }
    @if (errorMessage) {
      <p [id]="errorId" class="text-sm font-medium text-red-700">{{ errorMessage }}</p>
    }
  </div>`,
})
export class DcCheckboxFieldComponent extends DcFieldBase<boolean> {
  get text(): string {
    return stringProp(this.component.props, 'text') ?? this.component.label ?? 'Confirm';
  }
}
