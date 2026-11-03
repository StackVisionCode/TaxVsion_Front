import { CheckRingItem } from '@shared/ui/check-ring/check-ring.component';
import { AddressForm, CompanyProfile } from '../data-access/company-settings.model';
import { hoursErrors } from './business-hours';
import {
  ADDRESS_LINE_MAX,
  CITY_MAX,
  COUNTRY_MAX,
  LINK_MAX,
  PROFILE_MESSAGES,
  ProfileField,
  displayNameError,
  einError,
  emailError,
  legalNameError,
  linkError,
  phoneError,
  stateError,
  websiteError,
  zipError,
} from './office-profile-rules';

const ADDRESS_TOO_LONG = `Address lines can have up to ${ADDRESS_LINE_MAX} characters, the city ${CITY_MAX} and the country ${COUNTRY_MAX}.`;

function addressTooLong(a: AddressForm): boolean {
  return (
    a.line1.trim().length > ADDRESS_LINE_MAX ||
    a.line2.trim().length > ADDRESS_LINE_MAX ||
    a.city.trim().length > CITY_MAX ||
    a.country.trim().length > COUNTRY_MAX
  );
}

/** Errores locales del perfil por campo, con los mismos mensajes que Tenant (vacío = válido). */
export function profileErrors(form: CompanyProfile): Partial<Record<ProfileField, string>> {
  const errors: Partial<Record<ProfileField, string | null>> = {
    name: legalNameError(form.name),
    displayName: displayNameError(form.displayName),
    taxId: einError(form.taxId),
    phone: phoneError(form.phone),
    email: emailError(form.email),
    website: websiteError(form.website),
    address: addressTooLong(form.physical) ? ADDRESS_TOO_LONG : null,
    state: stateError(form.physical.state, form.physical.country),
    zip: zipError(form.physical.zip, form.physical.country),
    hours: Object.keys(hoursErrors(form.hours)).length ? 'Fix the highlighted days.' : null,
    bookingUrl: linkError(form.bookingUrl, LINK_MAX, PROFILE_MESSAGES.bookingUrl),
    reviewUrl: linkError(form.reviewUrl, LINK_MAX, PROFILE_MESSAGES.reviewUrl),
  };
  if (!form.mailingSameAsPhysical) {
    errors.mailingAddress = addressTooLong(form.mailing) ? ADDRESS_TOO_LONG : null;
    errors.mailingState = stateError(form.mailing.state, form.mailing.country);
    errors.mailingZip = zipError(form.mailing.zip, form.mailing.country);
  }
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => !!v)) as Partial<Record<ProfileField, string>>;
}

/** Campos con error que toca cada clave del formulario (para borrar el 400 del backend al editar). */
export const PROFILE_KEY_FIELDS: Record<keyof CompanyProfile, ProfileField[]> = {
  name: ['name'],
  displayName: ['displayName'],
  entityType: ['entityType'],
  taxId: ['taxId'],
  phone: ['phone'],
  email: ['email'],
  website: ['website'],
  physical: ['address', 'state', 'zip'],
  mailingSameAsPhysical: ['mailingAddress', 'mailingState', 'mailingZip'],
  mailing: ['mailingAddress', 'mailingState', 'mailingZip'],
  defaultLanguage: ['language'],
  hours: ['hours'],
  bookingUrl: ['bookingUrl'],
  reviewUrl: ['reviewUrl'],
};

/**
 * Chequeo "Invoice details" sobre lo GUARDADO: lo que se estampa en cada factura. El nombre legal no
 * bloquea nada (Billing cae al DBA o al nombre de la oficina) pero se sigue recomendando.
 */
export function invoiceReadiness(p: CompanyProfile | null): CheckRingItem[] {
  const has = (v: string | null | undefined) => !!v?.trim();
  const a = p?.physical;
  return [
    { id: 'name', label: 'Legal name', done: has(p?.name), target: 'identity' },
    { id: 'ein', label: 'EIN', done: has(p?.taxId) && !einError(p?.taxId), target: 'identity' },
    {
      id: 'address',
      label: 'Full address',
      done:
        has(a?.line1) &&
        has(a?.city) &&
        has(a?.state) &&
        has(a?.zip) &&
        !stateError(a?.state, a?.country) &&
        !zipError(a?.zip, a?.country),
      target: 'address',
    },
    {
      id: 'contact',
      label: 'Phone & email',
      done: has(p?.phone) && has(p?.email) && !phoneError(p?.phone) && !emailError(p?.email),
      target: 'identity',
    },
  ];
}
