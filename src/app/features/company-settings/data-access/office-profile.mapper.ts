import { AddressForm, CompanyProfile, OfficeAddress, OfficeProfile, UpdateOfficeProfileRequest } from './company-settings.model';
import { toBusinessHours, toHoursForm } from '../utils/business-hours';
import {
  normalizeCountry,
  normalizeEin,
  normalizePhone,
  normalizeWebsite,
  normalizeZip,
} from '../utils/office-profile-rules';

/** Perfil vacío (lo que devuelve Tenant sin perfil guardado): estado inicial del formulario. */
export const EMPTY_OFFICE_PROFILE: OfficeProfile = {
  legalName: null,
  displayName: null,
  entityType: null,
  ein: null,
  phone: null,
  email: null,
  website: null,
  physicalAddress: { line1: null, line2: null, city: null, state: null, postalCode: null, country: 'US' },
  mailingSameAsPhysical: true,
  mailingAddress: null,
  defaultLanguage: 'en',
  businessHours: [],
  bookingUrl: null,
  reviewUrl: null,
  version: 0,
  updatedAtUtc: null,
};

const EMPTY_ADDRESS: AddressForm = { line1: '', line2: '', city: '', state: '', zip: '', country: 'US' };

function toAddressForm(address: OfficeAddress | null | undefined): AddressForm {
  if (!address) return { ...EMPTY_ADDRESS };
  return {
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    zip: address.postalCode ?? '',
    country: address.country || 'US',
  };
}

/** Perfil de Tenant → lo que edita la página. */
export function toCompanyProfile(profile: OfficeProfile): CompanyProfile {
  return {
    name: profile.legalName ?? '',
    displayName: profile.displayName ?? '',
    entityType: profile.entityType ?? '',
    taxId: profile.ein ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    website: profile.website ?? '',
    physical: toAddressForm(profile.physicalAddress),
    mailingSameAsPhysical: profile.mailingSameAsPhysical ?? true,
    mailing: toAddressForm(profile.mailingAddress),
    defaultLanguage: profile.defaultLanguage || 'en',
    hours: toHoursForm(profile.businessHours),
    bookingUrl: profile.bookingUrl ?? '',
    reviewUrl: profile.reviewUrl ?? '',
  };
}

const orNull = (value: string): string | null => value.trim() || null;

/** Dirección del formulario → la que guarda Tenant (país US por defecto, estado en mayúsculas en EE. UU.). */
function toOfficeAddress(base: OfficeAddress | null | undefined, form: AddressForm): OfficeAddress {
  const country = normalizeCountry(form.country);
  const state = form.state.trim();
  return {
    ...(base ?? {}),
    line1: orNull(form.line1),
    line2: orNull(form.line2),
    city: orNull(form.city),
    state: (country === 'US' ? state.toUpperCase() : state) || null,
    postalCode: normalizeZip(form.zip, country) || null,
    country,
  };
}

/**
 * Cuerpo del PUT (estado completo), ya normalizado como lo guarda Tenant: lo editado encima del perfil tal
 * como se cargó, así cualquier campo que el backend agregue después viaja sin tocar.
 */
export function toProfileRequest(loaded: OfficeProfile, edited: CompanyProfile): UpdateOfficeProfileRequest {
  const base: Record<string, unknown> = { ...loaded };
  delete base['version'];
  delete base['updatedAtUtc'];
  return {
    ...(base as UpdateOfficeProfileRequest),
    legalName: orNull(edited.name),
    displayName: orNull(edited.displayName),
    entityType: edited.entityType || null,
    ein: normalizeEin(edited.taxId) || null,
    phone: normalizePhone(edited.phone) || null,
    email: orNull(edited.email),
    website: normalizeWebsite(edited.website) || null,
    physicalAddress: toOfficeAddress(loaded.physicalAddress, edited.physical),
    mailingSameAsPhysical: edited.mailingSameAsPhysical,
    mailingAddress: edited.mailingSameAsPhysical ? null : toOfficeAddress(loaded.mailingAddress, edited.mailing),
    defaultLanguage: edited.defaultLanguage || 'en',
    businessHours: toBusinessHours(edited.hours),
    bookingUrl: normalizeWebsite(edited.bookingUrl) || null,
    reviewUrl: normalizeWebsite(edited.reviewUrl) || null,
  };
}

/** Hay cambios si lo que se guardaría difiere de lo cargado (un formato viejo no cuenta como cambio). */
export function profileChanged(loaded: OfficeProfile, edited: CompanyProfile): boolean {
  return (
    JSON.stringify(toProfileRequest(loaded, edited)) !==
    JSON.stringify(toProfileRequest(loaded, toCompanyProfile(loaded)))
  );
}
