import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  BrandResponse,
  BrandSurface,
  CompanyProfile,
  UpdateBrandColorsRequest,
  UploadAssetResponse,
} from './company-settings.model';

/**
 * Cliente HTTP fino del módulo Company Settings. Dos backends distintos detrás del Gateway:
 * - Billing → IssuerProfileController (`/billing/issuer-profile`): datos legales de la empresa.
 * - Tenant → TenantBrandsController (`/tenants/{tenantId}/brands/{surface}`): identidad visual por
 *   superficie (colores + logo + favicon, modelo TenantBrands).
 * El token lo adjunta el interceptor de auth; el tenantId de la ruta DEBE coincidir con el claim
 * tenant_id del JWT (el backend lo verifica y responde 403 si no).
 */
@Injectable({ providedIn: 'root' })
export class CompanySettingsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantBase();
  }

  // --- Perfil legal de la empresa (Billing) ---

  /** Nunca 404: si el tenant no guardó nada aún, llega `name: ""` con country "US". */
  getProfile(): Observable<CompanyProfile> {
    return this.http.get<CompanyProfile>(`${this.base}/billing/issuer-profile`);
  }

  /** PUT upsert → 204. Requiere permiso Billing.Manage; `name` es obligatorio. */
  saveProfile(profile: CompanyProfile): Observable<void> {
    return this.http.put<void>(`${this.base}/billing/issuer-profile`, {
      name: profile.name,
      taxId: profile.taxId || null,
      line1: profile.line1 || null,
      city: profile.city || null,
      state: profile.state || null,
      zip: profile.zip || null,
      country: profile.country || 'US',
      phone: profile.phone || null,
      email: profile.email || null,
      website: profile.website || null,
    });
  }

  // --- Marca del tenant (TenantBrands, por superficie: CRM o Portal del cliente) ---

  private brandBase(tenantId: string, surface: BrandSurface): string {
    return `${this.base}/tenants/${tenantId}/brands/${surface}`;
  }

  /** Marca efectiva de la superficie: colores + assets (logo/favicon) resueltos. Siempre 200. */
  getBrand(tenantId: string, surface: BrandSurface): Observable<BrandResponse> {
    return this.http.get<BrandResponse>(this.brandBase(tenantId, surface));
  }

  /** PUT → 204. `{ primary, accent }` en #RRGGBB; un token en null = volver al default. */
  saveColors(tenantId: string, surface: BrandSurface, req: UpdateBrandColorsRequest): Observable<void> {
    return this.http.put<void>(`${this.brandBase(tenantId, surface)}/colors`, req);
  }

  /** DELETE → 204. Vuelve los colores de la superficie al default del sistema. */
  resetColors(tenantId: string, surface: BrandSurface): Observable<void> {
    return this.http.delete<void>(`${this.brandBase(tenantId, surface)}/colors`);
  }

  /**
   * PUT multipart/form-data del asset (logo o favicon) en el campo `file`. Responde 202 +
   * { fileId, status: "processing" }: la confirmación es asíncrona (escaneo antivirus).
   */
  uploadAsset(
    tenantId: string,
    surface: BrandSurface,
    key: 'logo' | 'favicon',
    file: File,
  ): Observable<UploadAssetResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.put<UploadAssetResponse>(`${this.brandBase(tenantId, surface)}/assets/${key}`, form);
  }

  /** DELETE → 204. Quita el asset (idempotente). */
  deleteAsset(tenantId: string, surface: BrandSurface, key: 'logo' | 'favicon'): Observable<void> {
    return this.http.delete<void>(`${this.brandBase(tenantId, surface)}/assets/${key}`);
  }

  /** URL pública servible de un asset por su fileId (el front nunca ve el fileId como tal). El `?v=1`
   * es un cache-buster de una sola vez: una versión anterior del endpoint marcaba el 302 como
   * `immutable` 1 año, dejando entradas envenenadas en el navegador que no revalidan; el query fuerza
   * una clave de caché nueva y las salta. Se puede quitar cuando todos los navegadores hayan ciclado. */
  publicAssetUrl(fileId: string): string {
    return `${this.base}/tenants/branding/assets/${fileId}?v=1`;
  }
}
