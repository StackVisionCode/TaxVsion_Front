import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  BrandResponse,
  BrandSurface,
  InvoiceSettings,
  OfficeCompliance,
  OfficeIdentity,
  OfficeProfile,
  UpdateOfficeComplianceRequest,
  UpdateOfficeIdentityRequest,
  UpdateOfficeProfileRequest,
  UploadAssetResponse,
} from './company-settings.model';

/**
 * Cliente HTTP fino del módulo Company Settings, detrás del Gateway:
 * - `/tenants/current/profile`: perfil de la oficina (datos legales, contacto, dirección).
 * - `/tenants/current`: nombre visible de la oficina y zona horaria.
 * - `/tenants/current/compliance`: cumplimiento (solo TenantAdmin con `settings.manage`).
 * - Billing `/billing/invoice-settings`: leer con `invoicing.view`, guardar con `invoicing.issuer.manage`.
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

  // --- Perfil de la oficina (Tenant) ---

  /** Lo lee cualquier usuario del tenant. Nunca 404: sin perfil guardado llega vacío con `version: 0`. */
  getProfile(): Observable<OfficeProfile> {
    return this.http.get<OfficeProfile>(`${this.base}/tenants/current/profile`);
  }

  /**
   * PUT estado completo → 200 con el perfil normalizado. Requiere `settings.manage`. 400 con código
   * `Tenant.Profile.<Campo>` por campo inválido.
   */
  saveProfile(request: UpdateOfficeProfileRequest): Observable<OfficeProfile> {
    return this.http.put<OfficeProfile>(`${this.base}/tenants/current/profile`, request);
  }

  // --- Oficina (Tenant): nombre visible y zona horaria ---

  getOffice(): Observable<OfficeIdentity> {
    return this.http.get<OfficeIdentity>(`${this.base}/tenants/current`);
  }

  /** PUT → 204/200. Estado completo: nombre y zona horaria IANA. */
  saveOffice(request: UpdateOfficeIdentityRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/tenants/current`, request);
  }

  // --- Ajustes de factura (Billing) ---

  getInvoiceSettings(): Observable<InvoiceSettings> {
    return this.http.get<InvoiceSettings>(`${this.base}/billing/invoice-settings`);
  }

  /** PUT estado completo → 200 con lo guardado. 400 `Billing.InvoiceSettings.<Campo>`. */
  saveInvoiceSettings(request: InvoiceSettings): Observable<InvoiceSettings> {
    return this.http.put<InvoiceSettings>(`${this.base}/billing/invoice-settings`, request);
  }

  // --- Cumplimiento (Tenant, solo TenantAdmin) ---

  getCompliance(): Observable<OfficeCompliance> {
    return this.http.get<OfficeCompliance>(`${this.base}/tenants/current/compliance`);
  }

  /** PUT → 200 con lo guardado (EFIN enmascarado). 400 `Tenant.Compliance.<Campo>`. */
  saveCompliance(request: UpdateOfficeComplianceRequest): Observable<OfficeCompliance> {
    return this.http.put<OfficeCompliance>(`${this.base}/tenants/current/compliance`, request);
  }

  /** EFIN completo; cada llamada queda auditada. 404 `Tenant.Compliance.EfinNotSet` si no hay. */
  revealEfin(): Observable<{ efin: string }> {
    return this.http.post<{ efin: string }>(`${this.base}/tenants/current/compliance/efin/reveal`, {});
  }

  // --- Marca del tenant (TenantBrands, por superficie: CRM o Portal del cliente) ---

  private brandBase(tenantId: string, surface: BrandSurface): string {
    return `${this.base}/tenants/${tenantId}/brands/${surface}`;
  }

  /** Marca efectiva de la superficie: assets (logo/favicon) resueltos. Siempre 200. */
  getBrand(tenantId: string, surface: BrandSurface): Observable<BrandResponse> {
    return this.http.get<BrandResponse>(this.brandBase(tenantId, surface));
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
