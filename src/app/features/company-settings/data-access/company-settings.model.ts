/**
 * Modelos del módulo Company Settings, espejo de los DTOs reales del backend:
 * - Billing → IssuerProfileController (`/billing/issuer-profile`): datos legales de la empresa.
 * - Tenant → TenantBrandingController (`/tenants/{tenantId}/logo` y `/tenants/{tenantId}/branding/colors`).
 * Todo JSON camelCase.
 */

/**
 * Espejo de IssuerProfileResponse / UpsertIssuerProfileRequest (GET/PUT /billing/issuer-profile).
 * Es el ÚNICO almacén backend de los datos legales de la empresa (nombre, EIN, dirección, contacto);
 * Billing los estampa en cada factura. `name` es requerido por el backend; el resto es opcional.
 * Si el tenant nunca guardó el perfil, el GET devuelve `name: ""` con country "US" (no 404).
 */
export interface CompanyProfile {
  name: string;
  /** EIN de la firma. */
  taxId: string | null;
  line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

/**
 * Espejo de TenantLogoResponse (GET /tenants/{tenantId}/logo).
 * El backend responde 404 tanto si no hay logo como si el archivo subido sigue en escaneo
 * antivirus (el PUT es asíncrono: 202 + confirmación posterior vía FileAvailable).
 */
export interface TenantLogo {
  fileId: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  updatedAtUtc: string;
  /** URL de descarga temporal firmada por CloudStorage. */
  downloadUrl: string;
  downloadUrlExpiresAtUtc: string;
}

/** Espejo de UploadTenantLogoResponse (202 del PUT logo). `status` llega como "processing". */
export interface UploadLogoResponse {
  fileId: string;
  status: string;
}

/**
 * Espejo de TenantBrandingColorsResponse (GET /tenants/{tenantId}/branding/colors).
 * Siempre trae la paleta completa (custom o default de la empresa) — nunca campos vacíos.
 */
export interface BrandingColors {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  /** false = el tenant está usando la paleta default de la plataforma. */
  isCustomized: boolean;
}

/**
 * Body de PUT /tenants/{tenantId}/branding/colors. Formato #RRGGBB (7 caracteres).
 * Un campo en null = volver al default de la empresa para ese campo.
 */
export interface UpdateBrandingColorsRequest {
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
}

/** Límites duros del backend para el logo (Tenant.MaxLogoSizeBytes + whitelist del controller). */
export const LOGO_MAX_SIZE_BYTES = 500 * 1024;
export const LOGO_ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
