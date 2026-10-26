import { Component } from '@angular/core';
import { stringProp } from '@shared/utils/data-collection/properties';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { DcFieldBase } from './dc-field-base';

@Component({
  selector: 'app-dc-yes-no-field',
  imports: [DcMarkdownComponent],
  template: `<fieldset
    [id]="inputId"
    tabindex="-1"
    class="space-y-3"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="!!errorMessage"
  >
    <legend class="text-sm font-semibold text-gray-900">
      {{ component.label || 'Choose yes or no' }}
      @if (component.required) {
        <span class="text-red-600" aria-hidden="true">*</span>
      }
    </legend>
    @if (component.help) {
      <div [id]="helpId" class="text-sm text-gray-600">
        <app-dc-markdown [document]="component.help" />
      </div>
    }
    <div class="grid grid-cols-2 gap-3">
      <button
        type="button"
        class="min-h-11 rounded-full border px-4 py-2 text-sm font-semibold"
        [class.border-brand-bold]="value === true"
        [class.bg-brand-surface]="value === true"
        [class.border-gray-200]="value !== true"
        [disabled]="readonly"
        [attr.aria-pressed]="value === true"
        (click)="emitValue(true)"
      >
        {{ yesLabel }}</button
      ><button
        type="button"
        class="min-h-11 rounded-full border px-4 py-2 text-sm font-semibold"
        [class.border-brand-bold]="value === false"
        [class.bg-brand-surface]="value === false"
        [class.border-gray-200]="value !== false"
        [disabled]="readonly"
        [attr.aria-pressed]="value === false"
        (click)="emitValue(false)"
      >
        {{ noLabel }}
      </button>
    </div>
    @if (errorMessage) {
      <p [id]="errorId" class="text-sm font-medium text-red-700">{{ errorMessage }}</p>
    }
  </fieldset>`,
})
export class DcYesNoFieldComponent extends DcFieldBase<boolean> {
  get yesLabel(): string {
    return stringProp(this.component.props, 'yesLabel') ?? 'Yes';
  }
  get noLabel(): string {
    return stringProp(this.component.props, 'noLabel') ?? 'No';
  }
}
