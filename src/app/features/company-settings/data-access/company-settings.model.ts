/**
 * Modelos del módulo Company Settings, espejo de los DTOs reales del backend:
 * - Tenant → `/tenants/current/profile`: perfil de la oficina (datos legales, contacto, dirección). Tenant es
 *   el dueño; Billing lo proyecta para estampar las facturas.
 * - Tenant → `/tenants/current`: nombre visible de la oficina y su zona horaria.
 * - Tenant → `/tenants/current/compliance`: cumplimiento (EFIN, WISP, retención), solo TenantAdmin.
 * - Billing → `/billing/invoice-settings`: plazo de pago, instrucciones y pie de la factura.
 * - Tenant → TenantBrandsController (`/tenants/{tenantId}/brands/Crm`): identidad visual (TenantBrands):
 *   colores (primary/accent) + assets (logo/favicon). Modelo NUEVO por superficie.
 * Todo JSON camelCase.
 */

/** Dirección del perfil (física o postal). `country` por defecto "US". */
export interface OfficeAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

/** Horario de un día (`HH:mm`). */
export interface OfficeBusinessHours {
  day: string;
  opens: string;
  closes: string;
}

/**
 * Espejo de `GET /tenants/current/profile`. Nunca 404: sin perfil guardado llega todo vacío y `version: 0`.
 * Todo es opcional en el backend.
 */
export interface OfficeProfile {
  legalName: string | null;
  /** DBA (nombre comercial). */
  displayName: string | null;
  entityType: string | null;
  ein: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  physicalAddress: OfficeAddress;
  mailingSameAsPhysical: boolean;
  mailingAddress: OfficeAddress | null;
  defaultLanguage: string | null;
  businessHours: OfficeBusinessHours[];
  bookingUrl: string | null;
  reviewUrl: string | null;
  version: number;
  updatedAtUtc: string | null;
}

/** Cuerpo de `PUT /tenants/current/profile`: estado completo, el mismo perfil sin `version`/`updatedAtUtc`. */
export type UpdateOfficeProfileRequest = Omit<OfficeProfile, 'version' | 'updatedAtUtc'>;

/** Tipos de entidad que acepta Tenant (`Tenant.Profile.EntityType`), con su etiqueta legible. */
export const ENTITY_TYPES: readonly { value: string; label: string }[] = [
  { value: 'SoleProprietor', label: 'Sole proprietor' },
  { value: 'Llc', label: 'LLC' },
  { value: 'Partnership', label: 'Partnership' },
  { value: 'SCorp', label: 'S corporation' },
  { value: 'CCorp', label: 'C corporation' },
  { value: 'Nonprofit', label: 'Nonprofit' },
  { value: 'Other', label: 'Other' },
];

/** Idiomas que acepta Tenant (`Tenant.Profile.Language`). */
export const OFFICE_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
];

/** Días que acepta el horario (nombres en inglés, lunes primero como los devuelve Tenant). */
export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Dirección editable (física o postal). */
export interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

/** Un día del editor semanal: cerrado = no viaja en `businessHours`. */
export interface DayHoursForm {
  day: string;
  open: boolean;
  opens: string;
  closes: string;
}

/**
 * Lo que edita la página del perfil. Se arma desde `OfficeProfile` y, al guardar, se vuelve a mezclar sobre
 * el perfil cargado para no pisar lo que el backend agregue después.
 */
export interface CompanyProfile {
  /** Nombre legal (`legalName`), opcional. */
  name: string;
  /** DBA (`displayName`). */
  displayName: string;
  entityType: string;
  /** EIN de la firma (`ein`). */
  taxId: string;
  phone: string;
  email: string;
  website: string;
  physical: AddressForm;
  mailingSameAsPhysical: boolean;
  mailing: AddressForm;
  defaultLanguage: string;
  hours: DayHoursForm[];
  bookingUrl: string;
  reviewUrl: string;
}

// --- Billing: ajustes de factura ---

/** Plazos que acepta Billing (`Billing.InvoiceSettings.PaymentTerms`). */
export const PAYMENT_TERMS: readonly { value: string; label: string }[] = [
  { value: 'DueOnReceipt', label: 'Due on receipt' },
  { value: 'Net7', label: 'Net 7' },
  { value: 'Net15', label: 'Net 15' },
  { value: 'Net30', label: 'Net 30' },
  { value: 'Net45', label: 'Net 45' },
];

/** Espejo de `GET/PUT /billing/invoice-settings` (estado completo). */
export interface InvoiceSettings {
  paymentTerms: string;
  paymentInstructions: string | null;
  invoiceFooter: string | null;
}

// --- Tenant: cumplimiento (solo TenantAdmin) ---

/** Espejo de `GET /tenants/current/compliance`. Fechas `yyyy-MM-dd`. */
export interface OfficeCompliance {
  hasEfin: boolean;
  efinMasked: string | null;
  securityCoordinatorUserId: string | null;
  wispAdoptedOn: string | null;
  wispLastReviewedOn: string | null;
  incidentContactEmail: string | null;
  incidentContactPhone: string | null;
  retentionYears: number | null;
  updatedAtUtc: string | null;
}

/** Cuerpo del PUT: `efin` omitido = no tocar, `""` = borrar, 6 dígitos = reemplazar. */
export interface UpdateOfficeComplianceRequest {
  efin?: string;
  securityCoordinatorUserId: string | null;
  wispAdoptedOn: string | null;
  wispLastReviewedOn: string | null;
  incidentContactEmail: string | null;
  incidentContactPhone: string | null;
  retentionYears: number | null;
}

/** Qué hace la página con el EFIN guardado. */
export type EfinAction = 'keep' | 'change' | 'clear';

/** Lo que edita la sección de cumplimiento. */
export interface ComplianceForm {
  efinAction: EfinAction;
  efin: string;
  securityCoordinatorUserId: string;
  wispAdoptedOn: string;
  wispLastReviewedOn: string;
  incidentContactEmail: string;
  incidentContactPhone: string;
  /** '' = sin definir. */
  retentionYears: string;
}

/** Años de retención que acepta Tenant (`Tenant.Compliance.RetentionYears`); Signature los usa (F4). */
export const RETENTION_YEARS_MIN = 3;
export const RETENTION_YEARS_MAX = 20;

/**
 * Espejo de `GET /tenants/current` → `{ id, name, subdomain, defaultTimeZoneId }`. `name` es el nombre
 * que ven clientes y correos (remitente, portal); el nombre legal vive en el perfil (`legalName`).
 */
export interface OfficeIdentity {
  id: string;
  name: string;
  subdomain: string;
  defaultTimeZoneId: string;
}

/** Cuerpo de `PUT /tenants/current`: estado completo, los dos obligatorios (400 si no son válidos). */
export interface UpdateOfficeIdentityRequest {
  name: string;
  defaultTimeZoneId: string;
}

// --- TenantBrands (modelo nuevo) ---

/**
 * Superficie de marca configurable desde company-settings. El backend define más (Mobile/Email) pero
 * el TenantAdmin solo edita CRM (lo que ve el staff) y Portal (lo que ven los clientes) — cada una con
 * su propio logo/favicon/colores.
 */
export type BrandSurface = 'Crm' | 'Portal';

/** Las dos superficies con etiqueta para el selector de la UI. */
export const BRAND_SURFACES: { value: BrandSurface; label: string }[] = [
  { value: 'Crm', label: 'Staff CRM' },
  { value: 'Portal', label: 'Client portal' },
];

/** Espejo de BrandColorDto (dentro de BrandResponse). */
export interface BrandColorDto {
  token: string; // "Primary" | "Accent"
  value: string; // #RRGGBB
  isCustomized: boolean;
}

/** Espejo de BrandAssetDto. `status`: "Pending" | "Confirmed". */
export interface BrandAssetDto {
  key: string; // "Logo" | "Favicon"
  fileId: string;
  status: string;
  contentType: string;
  width: number | null;
  height: number | null;
  isCustomized: boolean;
}

/** Espejo de BrandResponse (GET /tenants/{tenantId}/brands/Crm) — marca efectiva de la superficie. */
export interface BrandResponse {
  surface: string;
  colors: BrandColorDto[];
  assets: BrandAssetDto[];
}

/** Vista de un asset (logo/favicon) para la UI: URL pública construida desde el fileId (solo si Confirmed). */
export interface BrandAssetView {
  fileId: string;
  status: string;
  /** URL pública servible (null si el asset sigue en escaneo). */
  url: string | null;
  contentType: string;
}

/** Espejo de UploadTenantBrandAssetResponse (202 del PUT asset). `status` = "processing". */
export interface UploadAssetResponse {
  fileId: string;
  status: string;
  /** Aviso para el usuario (hoy: logo SVG, que el correo no renderiza). null = nada que advertir. */
  emailWarning: string | null;
}

/** Límites duros del backend para los assets (TenantBrand.MaxAssetSizeBytes + whitelist del controller). */
export const ASSET_MAX_SIZE_BYTES = 500 * 1024;
export const ASSET_ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
