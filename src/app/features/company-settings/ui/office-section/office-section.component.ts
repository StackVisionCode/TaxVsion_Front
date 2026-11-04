import { CUSTOM_ELEMENTS_SCHEMA, Component, input, output } from '@angular/core';
import { TimeZoneGroups } from '@shared/utils/time-zone.util';
import { OFFICE_LANGUAGES, UpdateOfficeIdentityRequest } from '../../data-access/company-settings.model';
import { SectionHeaderComponent } from '../section-header/section-header.component';

/** Largo máximo del nombre visible de la oficina (`PUT /tenants/current`). */
export const OFFICE_NAME_MAX = 256;

/**
 * Oficina: nombre visible y zona horaria (`/tenants/current`, solo con `settings.manage`) más el idioma por
 * defecto, que vive en el perfil. Sin `office` (no se pudo leer) solo se muestra el idioma.
 */
@Component({
  selector: 'app-office-section',
  imports: [SectionHeaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-cs-section-header icon="globe-outline" heading="Office" titleId="office-title" [loading]="loading()"
      description="How your office appears to clients, the clock it runs on and the language it starts with." />

    @if (error(); as err) {
      <p class="mt-4 flex items-center gap-2 text-sm text-red-600" role="alert">
        <ion-icon name="alert-circle-outline" class="text-base"></ion-icon>{{ err }}
      </p>
    }

    <div class="mt-6 grid gap-4 sm:grid-cols-2">
      @if (office(); as o) {
        <label class="pf-field">
          <span class="pf-field__label">Office name <span class="text-red-500" aria-hidden="true">*</span></span>
          <input type="text" autocomplete="organization" [value]="o.name" (input)="officeChange.emit({ name: $any($event.target).value, defaultTimeZoneId: o.defaultTimeZoneId })"
            [disabled]="!canEditOffice()" class="pf-input" [class.border-red-400]="!!nameError()" [attr.aria-invalid]="!!nameError()"
            required [attr.maxlength]="nameMax" placeholder="Gutierrez Tax Office" aria-describedby="office-name-hint" />
          @if (nameError(); as err) {
            <span class="text-xs text-red-600" role="alert">{{ err }}</span>
          } @else {
            <span id="office-name-hint" class="text-xs text-gray-500">Your workspace name. Clients see it in emails and the portal unless you set a DBA.</span>
          }
        </label>
        <label class="pf-field">
          <span class="pf-field__label">Time zone</span>
          <select class="pf-input" [value]="o.defaultTimeZoneId" (change)="officeChange.emit({ name: o.name, defaultTimeZoneId: $any($event.target).value })"
            [disabled]="!canEditOffice()" aria-describedby="time-zone-hint">
            <optgroup label="United States">
              @for (zone of timeZoneGroups().us; track zone.id) {
                <option [value]="zone.id" [selected]="zone.id === o.defaultTimeZoneId">{{ zone.label }}</option>
              }
            </optgroup>
            <optgroup label="All time zones">
              @for (zone of timeZoneGroups().others; track zone.id) {
                <option [value]="zone.id" [selected]="zone.id === o.defaultTimeZoneId">{{ zone.label }}</option>
              }
            </optgroup>
          </select>
          <span id="time-zone-hint" class="text-xs text-gray-500">Used for due dates, reminders and business hours.</span>
        </label>
      }
      <label class="pf-field">
        <span class="pf-field__label">Default language</span>
        <select class="pf-input" (change)="languageChange.emit($any($event.target).value)" [disabled]="!canEditProfile()"
          [class.border-red-400]="!!languageError()" aria-describedby="language-hint">
          @for (lang of languages; track lang.value) {
            <option [value]="lang.value" [selected]="lang.value === language()">{{ lang.label }}</option>
          }
        </select>
        @if (languageError(); as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        } @else {
          <span id="language-hint" class="text-xs text-gray-500">Preselected for new clients. They can change it.</span>
        }
      </label>
    </div>
  `,
})
export class OfficeSectionComponent {
  /** Nombre y zona en edición; null = el usuario no puede leer la oficina. */
  readonly office = input<UpdateOfficeIdentityRequest | null>(null);
  readonly timeZoneGroups = input.required<TimeZoneGroups>();
  readonly canEditOffice = input(false);
  readonly nameError = input<string | null | undefined>(null);
  readonly language = input('en');
  readonly canEditProfile = input(false);
  readonly languageError = input<string | null | undefined>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly officeChange = output<UpdateOfficeIdentityRequest>();
  readonly languageChange = output<string>();

  readonly nameMax = OFFICE_NAME_MAX;
  readonly languages = OFFICE_LANGUAGES;
}
