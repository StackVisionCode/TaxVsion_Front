import { Component, input, output } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { AddressForm, CompanyProfile } from '../../data-access/company-settings.model';
import { FormField } from '../../utils/office-profile-rules';
import { AddressFieldsComponent } from '../address-fields/address-fields.component';
import { SectionHeaderComponent } from '../section-header/section-header.component';

type Errors = Partial<Record<FormField, string>>;

/** Direcciones: física y, si es otra, la postal (a donde escriben clientes y el IRS). */
@Component({
  selector: 'app-address-section',
  imports: [SectionHeaderComponent, AddressFieldsComponent, SwitchComponent],
  template: `
    <app-cs-section-header icon="location-outline" heading="Addresses" titleId="address-title"
      description="Where your office is. Used on invoices and official correspondence." />

    <h3 class="mt-6 text-sm font-semibold text-gray-900">Physical address</h3>
    <app-address-fields class="mt-3" [value]="profile().physical" [disabled]="disabled()"
      [addressError]="errors().address" [stateError]="errors().state" [zipError]="errors().zip"
      (valueChange)="patch.emit({ physical: $event })" (touched)="touched.emit($event)" />

    <div class="mt-6 flex items-start justify-between gap-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
      <div class="min-w-0">
        <p id="mailing-same-label" class="text-sm font-semibold text-gray-900">Mailing address is the same</p>
        <p class="mt-0.5 text-xs text-gray-500">Turn off if clients and the IRS write to a different address, like a PO box.</p>
      </div>
      <app-switch [checked]="profile().mailingSameAsPhysical" [disabled]="disabled()" ariaLabel="Mailing address is the same"
        (checkedChange)="patch.emit({ mailingSameAsPhysical: $event })" />
    </div>

    @if (!profile().mailingSameAsPhysical) {
      <div class="pf-flow mt-6">
        <h3 class="text-sm font-semibold text-gray-900">Mailing address</h3>
        <p class="mt-0.5 text-xs text-gray-500">Where clients and the IRS write to you; printed in email footers.</p>
        <app-address-fields class="mt-3" section="section-mailing" [value]="profile().mailing" [disabled]="disabled()"
          [addressError]="errors().mailingAddress" [stateError]="errors().mailingState" [zipError]="errors().mailingZip"
          (valueChange)="setMailing($event)" (touched)="touched.emit($event === 'state' ? 'mailingState' : 'mailingZip')" />
        @if (mailingEmpty()) {
          <p class="mt-3 text-xs text-gray-500">Leave it empty and we'll keep using the physical address.</p>
        }
      </div>
    }
  `,
})
export class AddressSectionComponent {
  readonly profile = input.required<CompanyProfile>();
  readonly disabled = input(false);
  readonly errors = input<Errors>({});

  readonly patch = output<Partial<CompanyProfile>>();
  readonly touched = output<FormField>();

  setMailing(mailing: AddressForm): void {
    this.patch.emit({ mailing });
  }

  mailingEmpty(): boolean {
    const m = this.profile().mailing;
    return ![m.line1, m.line2, m.city, m.state, m.zip].some(v => v.trim());
  }
}
