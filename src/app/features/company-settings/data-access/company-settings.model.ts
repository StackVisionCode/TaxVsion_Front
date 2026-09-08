/**
 * Modelos del módulo Company Settings, espejo de los DTOs reales del backend:
 * - Billing → IssuerProfileController (`/billing/issuer-profile`): datos legales de la empresa.
 * - Tenant → TenantBrandsController (`/tenants/{tenantId}/brands/Crm`): identidad visual (TenantBrands):
 *   colores (primary/accent) + assets (logo/favicon). Modelo NUEVO por superficie.
 * Todo JSON camelCase.
 */

/**
 * Espejo de IssuerProfileResponse / UpsertIssuerProfileRequest (GET/PUT /billing/issuer-profile).
 * Único almacén backend de los datos legales de la empresa; Billing los estampa en cada factura.
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

/** Vista de la paleta para la UI (solo los 2 colores tematizables). */
export interface BrandColors {
  primaryColor: string;
  accentColor: string;
  /** true = el tenant personalizó al menos uno (primary o accent). */
  isCustomized: boolean;
}

/** Body de PUT /tenants/{tenantId}/brands/Crm/colors. null = volver al default para ese token. */
export interface UpdateBrandColorsRequest {
  primary: string | null;
  accent: string | null;
}

/** Vista de un asset (logo/favicon) para la UI: URL pública construida desde el fileId (solo si Confirmed). */
export interface BrandAssetView {
  fileId: string;
  status: string;
  /** URL pública servible (null si el asset sigue en escaneo). */
  url: string | null;
}

/** Espejo de UploadTenantBrandAssetResponse (202 del PUT asset). `status` = "processing". */
export interface UploadAssetResponse {
  fileId: string;
  status: string;
}

/** Límites duros del backend para los assets (TenantBrand.MaxAssetSizeBytes + whitelist del controller). */
export const ASSET_MAX_SIZE_BYTES = 500 * 1024;
export const ASSET_ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
