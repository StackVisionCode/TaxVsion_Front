/**
 * Reglas de formato del perfil de la oficina, espejo de la validación de Tenant
 * (`PUT /tenants/current/profile`: EIN, correo, web, teléfono, estado y ZIP de EE. UU., DBA, enlaces).
 * Todo es opcional: vacío es válido y solo se rechaza lo mal formado.
 */

/** Campos de la página que pueden llevar un error (local o del backend). */
export type ProfileField =
  | 'name'
  | 'displayName'
  | 'entityType'
  | 'taxId'
  | 'phone'
  | 'email'
  | 'website'
  | 'address'
  | 'state'
  | 'zip'
  | 'mailingAddress'
  | 'mailingState'
  | 'mailingZip'
  | 'language'
  | 'hours'
  | 'bookingUrl'
  | 'reviewUrl';

export type OfficeField = 'officeName';
export type InvoiceField = 'paymentTerms' | 'paymentInstructions' | 'invoiceFooter';
export type ComplianceField =
  | 'efin'
  | 'securityCoordinator'
  | 'wispAdoptedOn'
  | 'wispLastReviewedOn'
  | 'incidentEmail'
  | 'incidentPhone'
  | 'retentionYears';

/** Cualquier campo de la página: los errores 400 de los tres backends se atan a uno de estos. */
export type FormField = ProfileField | OfficeField | InvoiceField | ComplianceField;

export const PROFILE_MESSAGES = {
  taxId: 'The EIN must have 9 digits, like 12-3456789.',
  phone: 'Enter a phone number with 10 to 15 digits, like (555) 123-4567 or +44 20 7946 0958.',
  email: 'Enter a valid email address, like office@yourfirm.com.',
  website: 'Enter a valid website, like yourfirm.com or https://yourfirm.com.',
  bookingUrl: 'Enter a valid booking link, like https://calendly.com/yourfirm.',
  reviewUrl: 'Enter a valid review link, like https://g.page/r/yourfirm/review.',
  state: 'Use the 2-letter US state code, like TX or NY.',
  zip: 'Enter a 5-digit ZIP code, or ZIP+4 like 78701-1234.',
  dbaIrs: 'The business name (DBA) cannot include "IRS" or "Internal Revenue Service".',
} as const;

/** Largos máximos de Tenant. */
export const LEGAL_NAME_MAX = 200;
export const DBA_MAX = 200;
export const WEBSITE_MAX = 256;
export const LINK_MAX = 512;
export const ADDRESS_LINE_MAX = 200;
export const CITY_MAX = 100;
export const COUNTRY_MAX = 60;

/**
 * Código del 400 → campo. `Tenant.Profile.State/PostalCode/Address` valen para las dos direcciones: el store
 * decide cuál (ver `resolveAddressField`). Lo que no está aquí va al aviso general de su sección.
 */
const BACKEND_FIELD_BY_CODE: Record<string, FormField> = {
  'Tenant.Profile.LegalName': 'name',
  'Tenant.Profile.DisplayName': 'displayName',
  'Tenant.Profile.EntityType': 'entityType',
  'Tenant.Profile.Ein': 'taxId',
  'Tenant.Profile.Phone': 'phone',
  'Tenant.Profile.Email': 'email',
  'Tenant.Profile.Website': 'website',
  'Tenant.Profile.Address': 'address',
  'Tenant.Profile.State': 'state',
  'Tenant.Profile.PostalCode': 'zip',
  'Tenant.Profile.Language': 'language',
  'Tenant.Profile.BusinessHours': 'hours',
  'Tenant.Profile.BookingUrl': 'bookingUrl',
  'Tenant.Profile.ReviewUrl': 'reviewUrl',
  'Tenant.Compliance.Efin': 'efin',
  'Tenant.Compliance.SecurityCoordinator': 'securityCoordinator',
  'Tenant.Compliance.WispAdoptedOn': 'wispAdoptedOn',
  'Tenant.Compliance.WispLastReviewedOn': 'wispLastReviewedOn',
  'Tenant.Compliance.IncidentContactEmail': 'incidentEmail',
  'Tenant.Compliance.IncidentContactPhone': 'incidentPhone',
  'Tenant.Compliance.RetentionYears': 'retentionYears',
  'Billing.InvoiceSettings.PaymentTerms': 'paymentTerms',
  'Billing.InvoiceSettings.PaymentInstructions': 'paymentInstructions',
  'Billing.InvoiceSettings.InvoiceFooter': 'invoiceFooter',
};

/** Campo al que pertenece un código del backend; acepta sufijos (`Tenant.Profile.Ein.Invalid`). */
export function fieldForCode(code: string | null | undefined): FormField | null {
  if (!code) return null;
  for (const [prefix, field] of Object.entries(BACKEND_FIELD_BY_CODE)) {
    if (code === prefix || code.startsWith(`${prefix}.`)) return field;
  }
  return null;
}

/** Variante postal de un campo de dirección. */
export const MAILING_FIELD: Partial<Record<ProfileField, ProfileField>> = {
  address: 'mailingAddress',
  state: 'mailingState',
  zip: 'mailingZip',
};

/** Códigos USPS de 2 letras: estados, DC, territorios, estados asociados y correo militar. */
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI', 'UM', 'FM', 'MH', 'PW', 'AA', 'AE', 'AP',
]);

const US_ALIASES = new Set(['US', 'USA', 'U.S.', 'U.S.A.', 'UNITED STATES', 'UNITED STATES OF AMERICA']);

const EIN_PATTERN = /^\d{2}-?\d{7}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const ZIP_PATTERN = /^\d{5}(-?\d{4})?$/;
const PHONE_ALLOWED = /^\+?[\d\s\-.()]+$/;
const EMAIL_MAX = 254;

const clean = (value: string | null | undefined): string => String(value ?? '').trim();

// ---------- Nombre legal y DBA ----------

/** Opcional (encabeza la factura si está); como máximo 200 caracteres. */
export function legalNameError(raw: string | null | undefined): string | null {
  return clean(raw).length > LEGAL_NAME_MAX ? `The legal name cannot exceed ${LEGAL_NAME_MAX} characters.` : null;
}

/** La Pub 3112 del IRS prohíbe "IRS" como palabra en el nombre del proveedor (mismo patrón que Tenant). */
const IRS_PATTERN = /\bIRS\b|\bInternal\s+Revenue\s+Service\b/i;

export function displayNameError(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (value.length > DBA_MAX) return `The business name (DBA) cannot exceed ${DBA_MAX} characters.`;
  return IRS_PATTERN.test(value) ? PROFILE_MESSAGES.dbaIrs : null;
}

// ---------- País ----------

/** "usa", "United States" o vacío → "US"; el resto en mayúsculas. */
export function normalizeCountry(country: string | null | undefined): string {
  const value = clean(country).toUpperCase();
  return value === '' || US_ALIASES.has(value) ? 'US' : value;
}

export function isUsCountry(country: string | null | undefined): boolean {
  return normalizeCountry(country) === 'US';
}

// ---------- EIN ----------

/** Formato mientras se escribe: solo dígitos (máx. 9) y el guion tras los dos primeros. */
export function formatEinInput(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 9);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

export function einError(raw: string | null | undefined): string | null {
  const value = clean(raw);
  return value === '' || EIN_PATTERN.test(value) ? null : PROFILE_MESSAGES.taxId;
}

export function normalizeEin(raw: string | null | undefined): string {
  const value = clean(raw);
  if (!EIN_PATTERN.test(value)) return value;
  const digits = value.replace('-', '');
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

// ---------- Correo ----------

export function emailError(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (value === '') return null;
  return value.length <= EMAIL_MAX && EMAIL_PATTERN.test(value) ? null : PROFILE_MESSAGES.email;
}

// ---------- Web ----------

/** Sin esquema se asume https:// (igual que el backend). */
export function normalizeWebsite(raw: string | null | undefined): string {
  const value = clean(raw);
  if (value === '') return '';
  return value.includes('://') ? value : `https://${value}`;
}

/** Enlace público http(s) con dominio (sitio, citas, reseñas): mismas reglas que `WebUrl` de Tenant. */
export function linkError(raw: string | null | undefined, max: number, message: string): string | null {
  const candidate = normalizeWebsite(raw);
  if (candidate === '') return null;
  if (candidate.length > max || /\s/.test(candidate)) return message;
  try {
    const url = new URL(candidate);
    const host = url.hostname;
    const okScheme = url.protocol === 'http:' || url.protocol === 'https:';
    const okHost = host.includes('.') && !host.startsWith('.') && !host.endsWith('.');
    return okScheme && okHost ? null : message;
  } catch {
    return message;
  }
}

export function websiteError(raw: string | null | undefined): string | null {
  return linkError(raw, WEBSITE_MAX, PROFILE_MESSAGES.website);
}

// ---------- Teléfono ----------

function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function phoneError(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (value === '') return null;
  if (!PHONE_ALLOWED.test(value)) return PROFILE_MESSAGES.phone;
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 15 ? null : PROFILE_MESSAGES.phone;
}

/**
 * Mismo formato que guarda el backend: EE. UU. (10 dígitos, u 11 empezando por 1) → "(555) 123-4567";
 * cualquier otro → "+<dígitos>". Un valor inválido se devuelve tal cual.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const value = clean(raw);
  if (value === '' || phoneError(value)) return value;
  const digits = phoneDigits(value);
  const hasPlus = value.startsWith('+');
  const national =
    digits.length === 10 && !hasPlus ? digits : digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : null;
  return national
    ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
    : `+${digits}`;
}

// ---------- Estado y ZIP (solo EE. UU.) ----------

export function stateError(state: string | null | undefined, country: string | null | undefined): string | null {
  const value = clean(state).toUpperCase();
  if (value === '' || !isUsCountry(country)) return null;
  return US_STATE_CODES.has(value) ? null : PROFILE_MESSAGES.state;
}

export function zipError(zip: string | null | undefined, country: string | null | undefined): string | null {
  const value = clean(zip);
  if (value === '' || !isUsCountry(country)) return null;
  return ZIP_PATTERN.test(value) ? null : PROFILE_MESSAGES.zip;
}

/** ZIP+4 escrito sin guion → con guion (solo EE. UU.). */
export function normalizeZip(zip: string | null | undefined, country: string | null | undefined): string {
  const value = clean(zip);
  if (!isUsCountry(country) || !/^\d{9}$/.test(value)) return value;
  return `${value.slice(0, 5)}-${value.slice(5)}`;
}
