import { Component, computed, input, output } from '@angular/core';
import { AddressForm } from '../../data-access/company-settings.model';
import { ADDRESS_LINE_MAX, CITY_MAX, COUNTRY_MAX, isUsCountry } from '../../utils/office-profile-rules';

/** Campos de una dirección (física o postal). Estado y ZIP solo se validan en EE. UU. */
@Component({
  selector: 'app-address-fields',
  host: { class: 'grid gap-4 sm:grid-cols-6' },
  template: `
    <label class="pf-field sm:col-span-6">
      <span class="pf-field__label">Street address</span>
      <input type="text" [attr.autocomplete]="ac('address-line1')" [value]="value().line1" (input)="set('line1', $event)"
        [disabled]="disabled()" class="pf-input" [attr.maxlength]="lineMax" placeholder="1600 Main St" />
    </label>
    <label class="pf-field sm:col-span-6">
      <span class="pf-field__label">Suite / unit</span>
      <input type="text" [attr.autocomplete]="ac('address-line2')" [value]="value().line2" (input)="set('line2', $event)"
        [disabled]="disabled()" class="pf-input" [attr.maxlength]="lineMax" placeholder="Suite 200" />
    </label>
    <label class="pf-field sm:col-span-3">
      <span class="pf-field__label">City</span>
      <input type="text" [attr.autocomplete]="ac('address-level2')" [value]="value().city" (input)="set('city', $event)"
        [disabled]="disabled()" class="pf-input" [attr.maxlength]="cityMax" />
    </label>
    <label class="pf-field sm:col-span-1">
      <span class="pf-field__label">State</span>
      <input type="text" [attr.autocomplete]="ac('address-level1')" [value]="value().state" (input)="set('state', $event)"
        (blur)="touched.emit('state')" [disabled]="disabled()" class="pf-input uppercase" [class.border-red-400]="!!stateError()"
        [attr.aria-invalid]="!!stateError()" [attr.maxlength]="isUs() ? 2 : 40" placeholder="TX" />
    </label>
    <label class="pf-field sm:col-span-2">
      <span class="pf-field__label">ZIP</span>
      <input type="text" [attr.inputmode]="isUs() ? 'numeric' : 'text'" [attr.autocomplete]="ac('postal-code')"
        [value]="value().zip" (input)="set('zip', $event)" (blur)="touched.emit('zip')" [disabled]="disabled()"
        class="pf-input tabular-nums" [class.border-red-400]="!!zipError()" [attr.aria-invalid]="!!zipError()" placeholder="78701" />
    </label>
    <label class="pf-field sm:col-span-2">
      <span class="pf-field__label">Country</span>
      <input type="text" [attr.autocomplete]="ac('country')" [value]="value().country" (input)="set('country', $event)"
        [disabled]="disabled()" class="pf-input uppercase" [attr.maxlength]="countryMax" placeholder="US" />
    </label>
    @if (addressError() || stateError() || zipError()) {
      <p class="flex flex-col gap-1 text-xs text-red-600 sm:col-span-6" role="alert">
        @if (addressError(); as err) {<span>{{ err }}</span>}
        @if (stateError(); as err) {<span>{{ err }}</span>}
        @if (zipError(); as err) {<span>{{ err }}</span>}
      </p>
    }
  `,
})
export class AddressFieldsComponent {
  readonly value = input.required<AddressForm>();
  readonly disabled = input(false);
  /** Grupo de autocompletado del navegador (`billing`, `shipping`…). */
  readonly section = input('');
  readonly addressError = input<string | null | undefined>(null);
  readonly stateError = input<string | null | undefined>(null);
  readonly zipError = input<string | null | undefined>(null);

  readonly valueChange = output<AddressForm>();
  readonly touched = output<'state' | 'zip'>();

  readonly lineMax = ADDRESS_LINE_MAX;
  readonly cityMax = CITY_MAX;
  readonly countryMax = COUNTRY_MAX;
  readonly isUs = computed(() => isUsCountry(this.value().country));

  /** Token de autocompletado, con el grupo delante si lo hay ("shipping address-line1"). */
  ac(token: string): string {
    return this.section() ? `${this.section()} ${token}` : token;
  }

  set(key: keyof AddressForm, event: Event): void {
    this.valueChange.emit({ ...this.value(), [key]: (event.target as HTMLInputElement).value });
  }
}
