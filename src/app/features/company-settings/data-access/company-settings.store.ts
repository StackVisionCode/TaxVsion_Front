import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subscription, catchError, filter, finalize, of, switchMap, take, tap, timer } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { environment } from '@env/environment';
import { CompanySettingsService } from './company-settings.service';
import {
  BrandingColors,
  CompanyProfile,
  TenantLogo,
  UpdateBrandingColorsRequest,
} from './company-settings.model';

/** Reintentos del poll post-upload del logo (el PUT es 202: escaneo antivirus asíncrono). */
const LOGO_POLL_DELAY_MS = 2000;
const LOGO_POLL_INTERVAL_MS = 2500;
const LOGO_POLL_MAX_TRIES = 10;

/**
 * Store del módulo Company Settings: perfil legal (Billing), logo y colores de marca (Tenant).
 * Las tres secciones cargan y fallan de forma independiente — un 403 en branding no debe
 * tumbar el formulario del perfil. Los métodos de guardado devuelven Observable para que la
 * página reaccione (toast) y actualizan los signals en el tap.
 */
@Injectable({ providedIn: 'root' })
export class CompanySettingsStore {
  private readonly service = inject(CompanySettingsService);
  private readonly auth = inject(AuthService);

  // --- Perfil legal ---
  private readonly _profile = signal<CompanyProfile | null>(null);
  private readonly _profileLoading = signal(false);
  private readonly _profileSaving = signal(false);
  private readonly _profileError = signal<string | null>(null);

  readonly profile = this._profile.asReadonly();
  readonly profileLoading = this._profileLoading.asReadonly();
  readonly profileSaving = this._profileSaving.asReadonly();
  readonly profileError = this._profileError.asReadonly();

  // --- Logo ---
  private readonly _logo = signal<TenantLogo | null>(null);
  private readonly _logoLoading = signal(false);
  private readonly _logoBusy = signal(false);
  /** true entre el 202 del upload y la aparición del logo escaneado (o el fin del poll). */
  private readonly _logoProcessing = signal(false);
  private readonly _logoError = signal<string | null>(null);
  private logoPoll?: Subscription;

  readonly logo = this._logo.asReadonly();
  readonly logoLoading = this._logoLoading.asReadonly();
  readonly logoBusy = this._logoBusy.asReadonly();
  readonly logoProcessing = this._logoProcessing.asReadonly();
  readonly logoError = this._logoError.asReadonly();

  // --- Colores de marca ---
  private readonly _colors = signal<BrandingColors | null>(null);
  private readonly _colorsLoading = signal(false);
  private readonly _colorsSaving = signal(false);
  private readonly _colorsError = signal<string | null>(null);

  readonly colors = this._colors.asReadonly();
  readonly colorsLoading = this._colorsLoading.asReadonly();
  readonly colorsSaving = this._colorsSaving.asReadonly();
  readonly colorsError = this._colorsError.asReadonly();

  /**
   * tenantId del usuario autenticado: el app initializer hidrata /auth/me antes de pintar
   * rutas, así que currentUser ya está al entrar a la página. Fallback a environment.tenantId
   * solo aplica en dev/mocks (en prod ese valor es "").
   */
  private tenantId(): string | null {
    return this.auth.currentUser()?.tenant.id ?? (environment.tenantId || null);
  }

  /** Dispara las tres cargas en paralelo (cada una con su loading/error propio). */
  loadAll(): void {
    this.loadProfile();
    this.loadLogo();
    this.loadColors();
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

  loadLogo(): void {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return;
    }
    this._logoLoading.set(true);
    this._logoError.set(null);
    this.service.getLogo(tenantId).subscribe({
      next: logo => {
        this._logo.set(logo);
        this._logoLoading.set(false);
      },
      error: err => {
        // 404 = simplemente no hay logo (o sigue en escaneo): estado vacío, no error.
        if (!(err instanceof HttpErrorResponse && err.status === 404)) {
          this._logoError.set(toApiError(err).message);
        }
        this._logo.set(null);
        this._logoLoading.set(false);
      },
    });
  }

  /**
   * PUT 202 → deja el logo en "processing" y sondea el GET hasta que el escaneo
   * antivirus confirme el archivo (o se agoten los reintentos: el usuario puede recargar).
   */
  uploadLogo(file: File): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._logoError);
    }
    this.cancelLogoPoll();
    this._logoBusy.set(true);
    this._logoError.set(null);
    return this.service.uploadLogo(tenantId, file).pipe(
      tap(() => {
        this._logoProcessing.set(true);
        this.startLogoPoll(tenantId);
      }),
      switchMap(() => of(void 0)),
      catchError(err => {
        this._logoError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._logoBusy.set(false)),
    );
  }

  removeLogo(): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._logoError);
    }
    this.cancelLogoPoll();
    this._logoBusy.set(true);
    this._logoError.set(null);
    return this.service.deleteLogo(tenantId).pipe(
      tap(() => {
        this._logo.set(null);
        this._logoProcessing.set(false);
      }),
      catchError(err => {
        this._logoError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._logoBusy.set(false)),
    );
  }

  loadColors(): void {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return;
    }
    this._colorsLoading.set(true);
    this._colorsError.set(null);
    this.service.getColors(tenantId).subscribe({
      next: colors => {
        this._colors.set(colors);
        this._colorsLoading.set(false);
      },
      error: err => {
        this._colorsError.set(toApiError(err).message);
        this._colorsLoading.set(false);
      },
    });
  }

  saveColors(req: UpdateBrandingColorsRequest): Observable<void> {
    const tenantId = this.tenantId();
    if (!tenantId) {
      return this.failNoTenant(this._colorsError);
    }
    this._colorsSaving.set(true);
    this._colorsError.set(null);
    return this.service.saveColors(tenantId, req).pipe(
      // El PUT es 204: se refresca desde el GET para obtener la paleta efectiva + isCustomized.
      tap(() => this.loadColors()),
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
    return this.service.resetColors(tenantId).pipe(
      tap(() => this.loadColors()),
      catchError(err => {
        this._colorsError.set(toApiError(err).message);
        throw err;
      }),
      finalize(() => this._colorsSaving.set(false)),
    );
  }

  private startLogoPoll(tenantId: string): void {
    this.logoPoll = timer(LOGO_POLL_DELAY_MS, LOGO_POLL_INTERVAL_MS)
      .pipe(
        take(LOGO_POLL_MAX_TRIES),
        switchMap(() => this.service.getLogo(tenantId).pipe(catchError(() => of(null)))),
        filter((logo): logo is TenantLogo => logo !== null),
        take(1),
        // Si el escaneo tarda más que el poll completo, el flag se apaga igual: la página
        // muestra el estado vacío y el logo aparecerá en la próxima visita/recarga.
        finalize(() => this._logoProcessing.set(false)),
      )
      .subscribe(logo => this._logo.set(logo));
  }

  private cancelLogoPoll(): void {
    this.logoPoll?.unsubscribe();
    this.logoPoll = undefined;
    this._logoProcessing.set(false);
  }

  private failNoTenant(errorSignal: { set(value: string | null): void }): Observable<never> {
    const message = 'No tenant session found. Please sign in again.';
    errorSignal.set(message);
    return new Observable<never>(subscriber => subscriber.error(new Error(message)));
  }
}
