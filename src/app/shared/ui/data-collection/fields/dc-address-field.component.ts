import { Component } from '@angular/core';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { DcFieldBase } from './dc-field-base';

type AddressValue = Record<string, string>;

@Component({
  selector: 'app-dc-address-field',
  imports: [DcMarkdownComponent],
  template: `<fieldset
    class="space-y-3"
    [attr.aria-describedby]="describedBy"
    [attr.aria-invalid]="!!errorMessage"
  >
    <legend class="text-sm font-semibold text-gray-900">
      {{ component.label || 'Address' }}
      @if (component.required) {
        <span class="text-red-600" aria-hidden="true">*</span><span class="sr-only"> (required)</span>
      }
    </legend>
    @if (component.help) {
      <div [id]="helpId" class="text-sm text-gray-600">
        <app-dc-markdown [document]="component.help" />
      </div>
    }
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="sm:col-span-2"
        ><span class="dc-sub-label">Street address</span
        ><input
          [id]="inputId"
          class="dc-input"
          autocomplete="address-line1"
          [value]="part('line1')"
          [readOnly]="readonly"
          (input)="update('line1', $any($event.target).value)" /></label
      ><label class="sm:col-span-2"
        ><span class="dc-sub-label">Apartment, suite, etc.</span
        ><input
          class="dc-input"
          autocomplete="address-line2"
          [value]="part('line2')"
          [readOnly]="readonly"
          (input)="update('line2', $any($event.target).value)" /></label
      ><label
        ><span class="dc-sub-label">City</span
        ><input
          class="dc-input"
          autocomplete="address-level2"
          [value]="part('city')"
          [readOnly]="readonly"
          (input)="update('city', $any($event.target).value)" /></label
      ><label
        ><span class="dc-sub-label">State</span
        ><input
          class="dc-input uppercase"
          autocomplete="address-level1"
          maxlength="2"
          [value]="part('state')"
          [readOnly]="readonly"
          (input)="update('state', $any($event.target).value.toUpperCase())" /></label
      ><label
        ><span class="dc-sub-label">ZIP code</span
        ><input
          class="dc-input"
          inputmode="numeric"
          autocomplete="postal-code"
          [value]="part('postalCode')"
          [readOnly]="readonly"
          (input)="update('postalCode', $any($event.target).value)" /></label
      ><label
        ><span class="dc-sub-label">Country</span
        ><input class="dc-input" value="United States" readonly
      /></label>
    </div>
    @if (errorMessage) {
      <p [id]="errorId" class="text-sm font-medium text-red-700">{{ errorMessage }}</p>
    }
  </fieldset>`,
})
export class DcAddressFieldComponent extends DcFieldBase<AddressValue> {
  part(name: string): string {
    return this.value?.[name] ?? '';
  }
  update(name: string, value: string): void {
    this.emitValue({ ...(this.value ?? {}), country: 'US', [name]: value });
  }
}
