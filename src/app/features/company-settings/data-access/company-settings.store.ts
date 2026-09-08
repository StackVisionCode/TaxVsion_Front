import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, filter, finalize, map, of, switchMap, take, tap, timer } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { ThemeService } from '@core/theme/theme.service';
import { environment } from '@env/environment';
import { CompanySettingsService } from './company-settings.service';
import {
  BrandAssetView,
  BrandColors,
  BrandResponse,
  BrandSurface,
  CompanyProfile,
  UpdateBrandColorsRequest,
} from './company-settings.model';

/** Reintentos del poll post-upload de un asset (el PUT es 202: escaneo antivirus asíncrono). */
const ASSET_POLL_DELAY_MS = 2000;
const ASSET_POLL_INTERVAL_MS = 2500;
const ASSET_POLL_MAX_TRIES = 10;

type AssetKey = 'logo' | 'favicon';

/**
 * Store del módulo Company Settings: perfil legal (Billing) + marca del tenant (TenantBrands,
 * superficie CRM: colores primary/accent + logo + favicon). La marca se lee de un solo GET
 * (`/tenants/{id}/brands/Crm`) y se deriva a colores/logo/favicon. Al cargar o guardar colores se
 * aplica el tema en vivo (ThemeService) para que el admin VEA el cambio al instante.
 */
@Injectable({ providedIn: 'root' })
export class CompanySettingsStore {
  private readonly service = inject(CompanySettingsService);
  private readonly auth = inject(AuthService);
  private readonly tokens = inject(TokenService);
  private readonly theme = inject(ThemeService);

  // --- Perfil legal ---
  private readonly _profile = signal<CompanyProfile | null>(null);
  private readonly _profileLoading = signal(false);
  private readonly _profileSaving = signal(false);
  private readonly _profileError = signal<string | null>(null);

  readonly profile = this._profile.asReadonly();
  readonly profileLoading = this._profileLoading.asReadonly();
  readonly profileSaving = this._profileSaving.asReadonly();
  readonly profileError = this._profileError.asReadonly();

  /**
   * Superficie de marca que se está editando (CRM o Portal del cliente). Cada una tiene su propio
   * logo/favicon/colores. Por defecto CRM (la superficie de esta app). El tema en vivo solo se aplica
   * al editar CRM: recolorear el CRM mientras se edita la marca del Portal sería confuso.
   */
  private readonly _surface = signal<BrandSurface>('Crm');
  readonly surface = this._surface.asReadonly();

  // --- Marca: colores ---
  private readonly _colors = signal<BrandColors | null>(null);
  private readonly _colorsLoading = signal(false);
  private readonly _colorsSaving = signal(false);
  private readonly _colorsError = signal<string | null>(null);

  readonly colors = this._colors.asReadonly();
  readonly colorsLoading = this._colorsLoading.asReadonly();
  readonly colorsSaving = this._colorsSaving.asReadonly();
  readonly colorsError = this._colorsError.asReadonly();

  // --- Marca: assets (logo + favicon) ---
  private readonly _logo = signal<BrandAssetView | null>(null);
  private readonly _favicon = signal<BrandAssetView | null>(null);
  private readonly _assetBusy = signal<AssetKey | null>(null);
  private readonly _assetProcessing = signal<AssetKey | null>(null);
  private readonly _assetError = signal<string | null>(null);
  private assetPoll?: Subscription;

  readonly logo = this._logo.asReadonly();
  readonly favicon = this._favicon.asReadonly();
  readonly assetBusy = this._assetBusy.asReadonly();
  readonly assetProcessing = this._assetProcessing.asReadonly();
  readonly assetError = this._assetError.asReadonly();

  /**
   * tenantId del usuario. Prioridad: sesión hidratada → tenant del JWT → environment (solo mock).
   * NUNCA usar environment.tenantId (que en dev es el de plataforma) cuando hay un JWT real de otro
   * tenant: pedir la marca de otra oficina con ese JWT da 403 cross-tenant.
   */
  private tenantId(): string | null {
    return this.auth.currentUser()?.tenant.id ?? this.tenantIdFromToken() ?? (environment.tenantId || null);
  }

  /** Decodifica el tenant_id del access token (siempre correcto aunque currentUser aún no se hidrató). */
  private tenantIdFromToken(): string | null {
    const token = this.tokens.getAccessToken();
    const parts = token?.split('.');
    if (!parts || parts.length < 2) {
      return null;
    }
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.tenant_id === 'string' ? payload.tenant_id : null;
    } catch {
      return null;
    }
  }

  loadAll(): void {
    this.loadProfile();
    this.loadBrand();
  }

  /** Cambia la superficie a editar y recarga su marca (logo/favicon/colores propios de esa superficie). */
  setSurface(surface: BrandSurface): void {
    if (this._surface() === surface) {
      return;
    }
    this.cancelAssetPoll();
    this._surface.set(surface);
    this._colors.set(null);
    this._logo.set(null);
    this._favicon.set(null);
    this._colorsError.set(null);
    this._assetError.set(null);
    this.loadBrand();
  }

  loadProfile(): void {
    this._profileLoading.set(true);
    this._profileError.set(null);
    this.service.getProfile().subscribe({
      next: profile => {
        this._profile.set(profile);
        this._profileLoading.set(false);
      },
      error: err => {
        this._profileError.set(toApiError(err).message);
        this._profileLoading.set(false);
      },
    });
  }

  saveProfile(profile: CompanyProfile): Observable<void> {
    this._profileSaving.set(true);
    this._profileError.set(null);
    return this.service.saveProfile(profile).pipe(
      tap(() => this._profile.set(profile)),
      catchError(err => {
        this._profileError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._profileSaving.set(false)),
    );
  }

  /** Un solo GET de la marca → colores + logo + favicon, y aplica el tema efectivo. */
  loadBrand(): void {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return;
    }
    this._colorsLoading.set(true);
    this._colorsError.set(null);
    this.service.getBrand(tenantId, this._surface()).subscribe({
      next: brand => {
        this.applyBrand(brand);
        this._colorsLoading.set(false);
      },
      error: err => {
        this._colorsError.set(toApiError(err).message);
        this._colorsLoading.set(false);
      },
    });
  }

  saveColors(req: UpdateBrandColorsRequest): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._colorsError);
    }
    this._colorsSaving.set(true);
    this._colorsError.set(null);
    return this.service.saveColors(tenantId, this._surface(), req).pipe(
      // El PUT es 204: se refresca desde el GET para la paleta efectiva + isCustomized + tema.
      tap(() => this.loadBrand()),
      catchError(err => {
        this._colorsError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._colorsSaving.set(false)),
    );
  }

  resetColors(): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._colorsError);
    }
    this._colorsSaving.set(true);
    this._colorsError.set(null);
    return this.service.resetColors(tenantId, this._surface()).pipe(
      tap(() => this.loadBrand()),
      catchError(err => {
        this._colorsError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._colorsSaving.set(false)),
    );
  }

  /** Sube logo o favicon; 202 → deja el asset en "processing" y sondea hasta que se confirme. */
  uploadAsset(key: AssetKey, file: File): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._assetError);
    }
    this.cancelAssetPoll();
    this._assetBusy.set(key);
    this._assetError.set(null);
    return this.service.uploadAsset(tenantId, this._surface(), key, file).pipe(
      tap(() => {
        this._assetProcessing.set(key);
        this.startAssetPoll(tenantId, key);
      }),
      map(() => void 0),
      catchError(err => {
        this._assetError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._assetBusy.set(null)),
    );
  }

  removeAsset(key: AssetKey): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._assetError);
    }
    this.cancelAssetPoll();
    this._assetBusy.set(key);
    this._assetError.set(null);
    return this.service.deleteAsset(tenantId, this._surface(), key).pipe(
      tap(() => this.setAsset(key, null)),
      catchError(err => {
        this._assetError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._assetBusy.set(null)),
    );
  }

  private applyBrand(brand: BrandResponse): void {
    const primary = brand.colors.find(c => c.token === 'Primary');
    const accent = brand.colors.find(c => c.token === 'Accent');
    const colors: BrandColors = {
      primaryColor: primary?.value ?? '#1e466b',
      accentColor: accent?.value ?? '#67baf4',
      isCustomized: Boolean(primary?.isCustomized || accent?.isCustomized),
    };
    this._colors.set(colors);
    // Tema en vivo SOLO para la superficie CRM (esta app): aplicar la paleta del Portal recolorearía
    // el CRM mientras editas la marca de otra superficie. En Portal, los pickers muestran el color pero
    // no se toca el tema de esta app.
    if (this._surface() === 'Crm') {
      this.theme.applyBranding({ primary: colors.primaryColor, accent: colors.accentColor });
    }

    this._logo.set(this.toAssetView(brand, 'Logo'));
    this._favicon.set(this.toAssetView(brand, 'Favicon'));
  }

  private toAssetView(brand: BrandResponse, backendKey: 'Logo' | 'Favicon'): BrandAssetView | null {
    const asset = brand.assets.find(a => a.key === backendKey);
    if (!asset) {
      return null;
    }
    return {
      fileId: asset.fileId,
      status: asset.status,
      // Solo servible cuando pasó el escaneo; mientras tanto la UI muestra "processing".
      url: asset.status === 'Confirmed' ? this.service.publicAssetUrl(asset.fileId) : null,
    };
  }

  private setAsset(key: AssetKey, value: BrandAssetView | null): void {
    if (key === 'logo') {
      this._logo.set(value);
    } else {
      this._favicon.set(value);
    }
    if (this._assetProcessing() === key) {
      this._assetProcessing.set(null);
    }
  }

  private startAssetPoll(tenantId: string, key: AssetKey): void {
    const backendKey = key === 'logo' ? 'Logo' : 'Favicon';
    const surface = this._surface();
    this.assetPoll = timer(ASSET_POLL_DELAY_MS, ASSET_POLL_INTERVAL_MS)
      .pipe(
        take(ASSET_POLL_MAX_TRIES),
        switchMap(() =>
          this.service.getBrand(tenantId, surface).pipe(
            map(brand => this.toAssetView(brand, backendKey)),
            catchError(() => of(null)),
          ),
        ),
        filter((view): view is BrandAssetView => view !== null && view.status === 'Confirmed'),
        take(1),
        finalize(() => {
          if (this._assetProcessing() === key) {
            this._assetProcessing.set(null);
          }
        }),
      )
      .subscribe(view => this.setAsset(key, view));
  }

  private cancelAssetPoll(): void {
    this.assetPoll?.unsubscribe();
    this.assetPoll = undefined;
    this._assetProcessing.set(null);
  }

  private failNoTenant(errorSignal: { set(value: string | null): void }): Observable<never> {
    const message = 'No tenant session found. Please sign in again.';
    errorSignal.set(message);
    return new Observable<never>(subscriber => subscriber.error(new Error(message)));
  }
}
