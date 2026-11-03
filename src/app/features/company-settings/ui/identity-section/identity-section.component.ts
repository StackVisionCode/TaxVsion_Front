import { CUSTOM_ELEMENTS_SCHEMA, Component, input, output } from '@angular/core';
import { CompanyProfile, ENTITY_TYPES } from '../../data-access/company-settings.model';
import { DBA_MAX, FormField, LEGAL_NAME_MAX, formatEinInput } from '../../utils/office-profile-rules';
import { SectionHeaderComponent } from '../section-header/section-header.component';

type Errors = Partial<Record<FormField, string>>;

/** Identidad del negocio: nombre legal (opcional), DBA, tipo de entidad, EIN y contacto. */
@Component({
  selector: 'app-identity-section',
  imports: [SectionHeaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-cs-section-header icon="business-outline" heading="Business identity" titleId="identity-title" [loading]="loading()"
      description="Your legal details and how clients reach you. Printed on invoices and client documents." />

    <div class="mt-6 grid gap-4 sm:grid-cols-2">
      <label class="pf-field">
        <span class="pf-field__label">Legal name</span>
        <input type="text" autocomplete="organization" [value]="profile().name" (input)="text('name', $event)" (blur)="touched.emit('name')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().name" [attr.aria-invalid]="!!errors().name"
          [attr.maxlength]="legalNameMax" placeholder="Castillo Tax Services LLC" aria-describedby="legal-name-hint" />
        @if (errors().name; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        } @else {
          <span id="legal-name-hint" class="text-xs text-gray-500">As registered with the state and the IRS. Heads your invoices.</span>
        }
      </label>
      <label class="pf-field">
        <span class="pf-field__label">Doing business as (DBA)</span>
        <input type="text" [value]="profile().displayName" (input)="text('displayName', $event)" (blur)="touched.emit('displayName')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().displayName" [attr.aria-invalid]="!!errors().displayName"
          [attr.maxlength]="dbaMax" placeholder="Castillo Tax" aria-describedby="dba-hint" />
        @if (errors().displayName; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        } @else {
          <span id="dba-hint" class="text-xs text-gray-500">Shown to clients instead of the office name — emails, portal, e-signatures, payment pages. Leave empty to use the office name.</span>
        }
      </label>
      <label class="pf-field">
        <span class="pf-field__label">Entity type</span>
        <select class="pf-input" (change)="text('entityType', $event)" [disabled]="disabled()" [class.border-red-400]="!!errors().entityType">
          <option value="" [selected]="!profile().entityType">Not set</option>
          @for (type of entityTypes; track type.value) {
            <option [value]="type.value" [selected]="type.value === profile().entityType">{{ type.label }}</option>
          }
        </select>
        @if (errors().entityType; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
      <label class="pf-field">
        <span class="pf-field__label">EIN</span>
        <input type="text" inputmode="numeric" [value]="profile().taxId" (input)="ein($event)" (blur)="touched.emit('taxId')"
          [disabled]="disabled()" class="pf-input tabular-nums" [class.border-red-400]="!!errors().taxId" [attr.aria-invalid]="!!errors().taxId"
          maxlength="10" placeholder="12-3456789" />
        @if (errors().taxId; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
      <label class="pf-field">
        <span class="pf-field__label">Phone</span>
        <input type="tel" autocomplete="tel" [value]="profile().phone" (input)="text('phone', $event)" (blur)="touched.emit('phone')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().phone" [attr.aria-invalid]="!!errors().phone"
          placeholder="(202) 555-0112" />
        @if (errors().phone; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
      <label class="pf-field">
        <span class="pf-field__label">Email</span>
        <input type="email" autocomplete="email" [value]="profile().email" (input)="text('email', $event)" (blur)="touched.emit('email')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().email" [attr.aria-invalid]="!!errors().email"
          placeholder="office@yourfirm.com" />
        @if (errors().email; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
      <label class="pf-field sm:col-span-2">
        <span class="pf-field__label">Website</span>
        <input type="url" autocomplete="url" [value]="profile().website" (input)="text('website', $event)" (blur)="touched.emit('website')"
          [disabled]="disabled()" class="pf-input" [class.border-red-400]="!!errors().website" [attr.aria-invalid]="!!errors().website"
          placeholder="yourfirm.com" />
        @if (errors().website; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
    </div>
  `,
})
export class IdentitySectionComponent {
  readonly profile = input.required<CompanyProfile>();
  readonly disabled = input(false);
  readonly errors = input<Errors>({});
  readonly loading = input(false);

  readonly patch = output<Partial<CompanyProfile>>();
  readonly touched = output<FormField>();

  readonly legalNameMax = LEGAL_NAME_MAX;
  readonly dbaMax = DBA_MAX;
  readonly entityTypes = ENTITY_TYPES;

  text(key: 'name' | 'displayName' | 'entityType' | 'phone' | 'email' | 'website', event: Event): void {
    this.patch.emit({ [key]: (event.target as HTMLInputElement).value });
  }

  /** El EIN se formatea mientras se escribe ("123" → "12-3"). */
  ein(event: Event): void {
    const el = event.target as HTMLInputElement;
    const formatted = formatEinInput(el.value);
    el.value = formatted;
    this.patch.emit({ taxId: formatted });
  }
}
