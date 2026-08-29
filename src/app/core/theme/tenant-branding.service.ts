import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of, tap } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ThemeService } from './theme.service';

/**
 * Cache-buster de una sola vez para las URLs de assets. Una versión anterior del endpoint marcaba el
 * 302 como `immutable` 1 año, dejando entradas envenenadas en el navegador que no revalidan; el `?v=1`
 * fuerza una clave de caché nueva y las salta. Se puede quitar cuando todos los navegadores ciclen.
 */
function bust(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=1`;
}

/** Respuesta del endpoint público de branding: colores + URLs de assets ya construidas. */
interface PublicBrandingResponse {
  primary: string;
  accent: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

/** Respuesta del endpoint autenticado por tenant: colores + assets con fileId (BrandResponse). */
interface BrandResponse {
  surface: string;
  colors: { token: string; value: string; isCustomized: boolean }[];
  assets: { key: string; fileId: string; status: string }[];
}

/**
 * Aplica la identidad visual del tenant (TenantBrands) al arrancar: tema (primary/accent),
 * favicon y logo. Usa el endpoint ANÓNIMO `/tenants/branding/public/{slug}` — funciona pre-login y
 * post-login, y solo expone assets ya escaneados.
 *
 * REGLA DE ORO: todo aditivo con fallback total. Si la API no responde o el slug no está resuelto,
 * NO se toca nada y queda el look compilado por defecto (idéntico a hoy). Nunca deja la app sin
 * marca ni rompe el arranque.
 */
@Injectable({ providedIn: 'root' })
export class TenantBrandingService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly theme = inject(ThemeService);

  private readonly _logoUrl = signal<string | null>(null);
  /** URL absoluta del logo del tenant, o null si no tiene (los consumidores caen a su placeholder). */
  readonly logoUrl = this._logoUrl.asReadonly();

  private readonly _faviconUrl = signal<string | null>(null);
  /**
   * URL absoluta del favicon del tenant. Además de aplicarse al `<head>`, se
   * expone porque es el asset pensado para tamaños chicos: en espacios
   * reducidos (sidebar colapsado) se ve mejor que un logo horizontal
   * encogido a un cuadrado de 40px.
   */
  readonly faviconUrl = this._faviconUrl.asReadonly();

  /**
   * Carga y aplica la marca de una superficie (CRM) según el slug actual. Sin slug (login central
   * en app.*) no hace nada: el look por defecto ES la marca del sistema. Idempotente y seguro de
   * llamar varias veces (pre-login y tras autenticar).
   */
  applyForSurface(surface: 'Crm' | 'Portal' = 'Crm'): void {
    const slug = this.api.slug();
    if (!slug) {
      // Sin subdominio de oficina (app.* / localhost): cae a la marca del SISTEMA, así las páginas de
      // auth (login, reset, MFA, etc.) muestran el logo del sistema en vez de quedar sin marca.
      this.applyForSystem(surface);
      return;
    }

    const url = this.api.tenantUrl(
      `/tenants/branding/public/${encodeURIComponent(slug)}?surface=${surface}`,
    );
    this.http
      .get<PublicBrandingResponse>(url)
      .pipe(
        tap((branding) => this.apply(branding, this.api.tenantBase())),
        // Fallback total: cualquier fallo deja el look actual intacto.
        catchError(() => of(null)),
      )
      .subscribe();
  }

  /**
   * Login CENTRAL (app.* o localhost, sin oficina): aplica la marca del SISTEMA (plataforma). No usa
   * slug ni sesión. Fallback total: si falla, queda el look por defecto. Endpoint aditivo, no toca
   * la rama por slug del login de oficina.
   */
  applyForSystem(surface: 'Crm' | 'Portal' = 'Crm'): void {
    // Marca del SISTEMA: host de sistema (app.*), SIN slug. Debe ir por systemUrl/systemBase —
    // tenantUrl/tenantBase exigen slug y revientan en app.taxproffice.com (bug de arranque directo).
    const url = this.api.systemUrl(`/tenants/branding/system?surface=${surface}`);
    this.http
      .get<PublicBrandingResponse>(url)
      .pipe(
        tap((branding) => this.apply(branding, this.api.systemBase())),
        catchError(() => of(null)),
      )
      .subscribe();
  }

  /**
   * Post-login: aplica la marca del tenant autenticado por su tenantId (endpoint autenticado, sin
   * depender del slug). Funciona en dev (localhost, sin subdominio) y en prod. Fallback total.
   */
  applyForTenant(tenantId: string, surface: 'Crm' | 'Portal' = 'Crm'): void {
    if (!tenantId) {
      return;
    }
    const url = this.api.tenantUrl(`/tenants/${tenantId}/brands/${surface}`);
    this.http
      .get<BrandResponse>(url)
      .pipe(
        tap((brand) => this.applyBrand(brand)),
        catchError(() => of(null)),
      )
      .subscribe();
  }

  private applyBrand(brand: BrandResponse): void {
    const primary = brand.colors.find((c) => c.token === 'Primary')?.value;
    const accent = brand.colors.find((c) => c.token === 'Accent')?.value;
    this.theme.applyBranding({ primary, accent });

    const base = this.api.tenantBase();
    const logo = brand.assets.find((a) => a.key === 'Logo' && a.status === 'Confirmed');
    const favicon = brand.assets.find((a) => a.key === 'Favicon' && a.status === 'Confirmed');
    this._logoUrl.set(logo ? bust(`${base}/tenants/branding/assets/${logo.fileId}`) : null);
    if (favicon) {
      const faviconUrl = bust(`${base}/tenants/branding/assets/${favicon.fileId}`);
      this._faviconUrl.set(faviconUrl);
      this.setFavicon(faviconUrl);
    }
  }

  private apply(branding: PublicBrandingResponse, base: string): void {
    this.theme.applyBranding({ primary: branding.primary, accent: branding.accent });

    // Las URLs de assets vienen RELATIVAS; se absolutizan contra la base del mismo origen que sirvió
    // el branding: tenantBase() para la marca de oficina, systemBase() para la del sistema (app.*).
    this._logoUrl.set(branding.logoUrl ? bust(`${base}${branding.logoUrl}`) : null);
    if (branding.faviconUrl) {
      const faviconUrl = bust(`${base}${branding.faviconUrl}`);
      this._faviconUrl.set(faviconUrl);
      this.setFavicon(faviconUrl);
    }
  }

  /**
   * Reemplaza el favicon en runtime. El index.html declara VARIOS <link rel="icon"> (svg/png/ico);
   * si solo se actualiza uno, el navegador puede seguir usando otro. Por eso se quitan todos y se
   * pone uno solo con el del tenant. No hace falta cache-bust: la URL ya va versionada por fileId.
   */
  private setFavicon(href: string): void {
    try {
      document.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove());
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = href;
      document.head.appendChild(link);
    } catch {
      // Sin DOM (SSR) o navegador restringido: el favicon estático del index.html se mantiene.
    }
  }
}
