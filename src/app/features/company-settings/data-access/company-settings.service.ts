import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  BrandingColors,
  CompanyProfile,
  TenantLogo,
  UpdateBrandingColorsRequest,
  UploadLogoResponse,
} from './company-settings.model';

/**
 * Cliente HTTP fino del módulo Company Settings. Dos backends distintos detrás del Gateway:
 * - Billing → IssuerProfileController (`/billing/issuer-profile`): datos legales de la empresa.
 * - Tenant → TenantBrandingController (`/tenants/{tenantId}/logo` + `/tenants/{tenantId}/branding/colors`).
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

  // --- Logo del tenant (Tenant) ---

  /** 404 = sin logo, o el archivo recién subido sigue en escaneo antivirus. */
  getLogo(tenantId: string): Observable<TenantLogo> {
    return this.http.get<TenantLogo>(`${this.base}/tenants/${tenantId}/logo`);
  }

  /**
   * PUT multipart/form-data con el archivo en el campo `file` (IFormFile del controller).
   * Responde 202 + { fileId, status: "processing" }: la confirmación es asíncrona
   * (escaneo antivirus), así que el GET siguiente puede dar 404 durante unos segundos.
   */
  uploadLogo(tenantId: string, file: File): Observable<UploadLogoResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.put<UploadLogoResponse>(`${this.base}/tenants/${tenantId}/logo`, form);
  }

  deleteLogo(tenantId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/tenants/${tenantId}/logo`);
  }

  // --- Colores de marca del tenant (Tenant) ---

  /** Siempre 200 con la paleta completa (custom o default) + isCustomized. */
  getColors(tenantId: string): Observable<BrandingColors> {
    return this.http.get<BrandingColors>(`${this.base}/tenants/${tenantId}/branding/colors`);
  }

  /** PUT → 204. Campos #RRGGBB; un campo en null = volver al default en ese campo. */
  saveColors(tenantId: string, req: UpdateBrandingColorsRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/tenants/${tenantId}/branding/colors`, req);
  }

  /** DELETE → 204. Vuelve TODA la paleta al default de la empresa. */
  resetColors(tenantId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/tenants/${tenantId}/branding/colors`);
  }
}
