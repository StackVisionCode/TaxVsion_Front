import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, finalize, forkJoin, map, of, tap, throwError, timer } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { CompanySettingsService } from './company-settings.service';
import {
  CompanyProfile,
  InvoiceSettings,
  OfficeCompliance,
  OfficeIdentity,
  OfficeProfile,
  UpdateOfficeComplianceRequest,
  UpdateOfficeIdentityRequest,
} from './company-settings.model';
import { toProfileRequest } from './office-profile.mapper';
import { FormField, MAILING_FIELD, ProfileField, fieldForCode } from '../utils/office-profile-rules';
import { profileErrors } from '../utils/profile-form';

/** Cuánto se ve el EFIN completo antes de volver a enmascararse. */
export const EFIN_REVEAL_MS = 30_000;

/** Partes que se cargan y guardan por separado (cada una con su endpoint y su permiso). */
export type SettingsPart = 'office' | 'profile' | 'invoice' | 'compliance';

/** Qué cargar: el perfil lo lee cualquiera; el resto solo si el usuario tiene el permiso (sin 403). */
export interface CompanySettingsLoadOptions {
  office: boolean;
  invoice: boolean;
  compliance: boolean;
}

/** Lo que cambió en la página: solo viajan las partes presentes. */
export interface SettingsChanges {
  office?: UpdateOfficeIdentityRequest;
  profile?: CompanyProfile;
  invoice?: InvoiceSettings;
  compliance?: UpdateOfficeComplianceRequest;
}

export interface SaveOutcome {
  saved: SettingsPart[];
  failed: SettingsPart[];
}

type PartSet = ReadonlySet<SettingsPart>;

/**
 * Store de Office Settings: oficina (`/tenants/current`), perfil (`/tenants/current/profile`), ajustes de
 * factura (Billing `/billing/invoice-settings`) y cumplimiento (`/tenants/current/compliance`). Carga cada
 * parte según el permiso y guarda en paralelo solo las que cambiaron; un 400 con código de campo queda
 * atado a ese campo y el resto al aviso de su sección. La marca vive en `CompanyBrandStore`.
 */
@Injectable({ providedIn: 'root' })
export class CompanySettingsStore {
  private readonly service = inject(CompanySettingsService);
  private readonly auth = inject(AuthService);

  // --- Estado por parte ---
  private readonly _officeProfile = signal<OfficeProfile | null>(null);
  private readonly _office = signal<OfficeIdentity | null>(null);
  private readonly _invoiceSettings = signal<InvoiceSettings | null>(null);
  private readonly _compliance = signal<OfficeCompliance | null>(null);

  /** Perfil tal como lo devolvió Tenant: base del PUT de estado completo. */
  readonly officeProfile = this._officeProfile.asReadonly();
  readonly office = this._office.asReadonly();
  readonly invoiceSettings = this._invoiceSettings.asReadonly();
  readonly compliance = this._compliance.asReadonly();

  private readonly _loading = signal<PartSet>(new Set());
  private readonly _saving = signal<PartSet>(new Set());
  private readonly _errors = signal<Partial<Record<SettingsPart, string>>>({});
  private readonly _fieldErrors = signal<Partial<Record<FormField, string>>>({});

  readonly profileLoading = computed(() => this._loading().has('profile'));
  readonly officeLoading = computed(() => this._loading().has('office'));
  readonly invoiceLoading = computed(() => this._loading().has('invoice'));
  readonly complianceLoading = computed(() => this._loading().has('compliance'));
  readonly saving = computed(() => this._saving().size > 0);

  readonly profileError = computed(() => this._errors().profile ?? null);
  readonly officeError = computed(() => this._errors().office ?? null);
  readonly invoiceError = computed(() => this._errors().invoice ?? null);
  readonly complianceError = computed(() => this._errors().compliance ?? null);

  /** 400 del backend atados a un campo: la página los muestra junto a ese campo. */
  readonly fieldErrors = this._fieldErrors.asReadonly();

  // --- EFIN revelado (temporal) ---
  private readonly _revealedEfin = signal<string | null>(null);
  private readonly _revealingEfin = signal(false);
  readonly revealedEfin = this._revealedEfin.asReadonly();
  readonly revealingEfin = this._revealingEfin.asReadonly();
  private revealTimer?: Subscription;

  loadAll(options: CompanySettingsLoadOptions): void {
    this.loadProfile();
    if (options.office) this.loadOffice();
    if (options.invoice) this.loadInvoiceSettings();
    if (options.compliance) this.loadCompliance();
  }

  loadProfile(): void {
    this.load('profile', this.service.getProfile(), p => this._officeProfile.set(p));
  }

  loadOffice(): void {
    this.load('office', this.service.getOffice(), o => this._office.set(o));
  }

  loadInvoiceSettings(): void {
    this.load('invoice', this.service.getInvoiceSettings(), s => this._invoiceSettings.set(s));
  }

  loadCompliance(): void {
    this.load('compliance', this.service.getCompliance(), c => this._compliance.set(c));
  }

  /** Guarda en paralelo las partes presentes; cada una informa éxito o fallo sin cortar a las demás. */
  saveChanges(changes: SettingsChanges): Observable<SaveOutcome> {
    const jobs: Observable<[SettingsPart, boolean]>[] = [];
    const add = (part: SettingsPart, request: Observable<void>) =>
      jobs.push(
        request.pipe(
          map((): [SettingsPart, boolean] => [part, true]),
          catchError(() => of<[SettingsPart, boolean]>([part, false])),
        ),
      );
    if (changes.office) add('office', this.saveOffice(changes.office));
    if (changes.profile) add('profile', this.saveProfile(changes.profile));
    if (changes.invoice) add('invoice', this.saveInvoiceSettings(changes.invoice));
    if (changes.compliance) add('compliance', this.saveCompliance(changes.compliance));
    if (jobs.length === 0) return of({ saved: [], failed: [] });
    return forkJoin(jobs).pipe(
      map(results => ({
        saved: results.filter(([, ok]) => ok).map(([part]) => part),
        failed: results.filter(([, ok]) => !ok).map(([part]) => part),
      })),
    );
  }

  /**
   * PUT de estado completo: lo editado se mezcla sobre el perfil cargado, así no se borra lo que la página
   * no muestra. Sin perfil cargado no se guarda (el PUT vaciaría esos campos).
   */
  saveProfile(profile: CompanyProfile): Observable<void> {
    const loaded = this._officeProfile();
    if (!loaded) {
      const message = 'Your office details have not loaded yet. Reload the page and try again.';
      this.setError('profile', message);
      return throwError(() => new Error(message));
    }
    const request = toProfileRequest(loaded, profile);
    return this.save('profile', this.service.saveProfile(request), {
      // El 200 trae el perfil normalizado (y la versión nueva); si no llegara cuerpo, vale lo enviado.
      onSaved: saved =>
        this._officeProfile.set(saved ?? { ...request, version: loaded.version, updatedAtUtc: loaded.updatedAtUtc }),
      fieldOf: field => this.resolveAddressField(field, profile),
    });
  }

  /** PUT /tenants/current y refresca el nombre de la oficina que muestra el shell. */
  saveOffice(request: UpdateOfficeIdentityRequest): Observable<void> {
    return this.save('office', this.service.saveOffice(request), {
      onSaved: () => {
        const current = this._office();
        this._office.set(current ? { ...current, ...request } : null);
        this.auth.applyTenantName(request.name);
      },
    });
  }

  saveInvoiceSettings(request: InvoiceSettings): Observable<void> {
    return this.save('invoice', this.service.saveInvoiceSettings(request), {
      onSaved: saved => this._invoiceSettings.set(saved ?? request),
    });
  }

  saveCompliance(request: UpdateOfficeComplianceRequest): Observable<void> {
    return this.save('compliance', this.service.saveCompliance(request), {
      onSaved: saved => {
        if (saved) this._compliance.set(saved);
        // El EFIN pudo cambiar o borrarse: lo revelado ya no vale.
        if (request.efin !== undefined) this.hideEfin();
      },
    });
  }

  /** Borra el error del backend de un campo en cuanto el usuario lo corrige. */
  clearFieldError(field: FormField): void {
    if (!this._fieldErrors()[field]) return;
    this._fieldErrors.update(errors => {
      const next = { ...errors };
      delete next[field];
      return next;
    });
  }

  /** Descartar: se olvidan los errores de campo del último guardado. */
  clearSaveErrors(): void {
    this._fieldErrors.set({});
  }

  /** Muestra el EFIN completo un rato (cada llamada queda auditada en Tenant). */
  revealEfin(): void {
    if (this._revealingEfin()) return;
    this._revealingEfin.set(true);
    this.setError('compliance', null);
    this.service
      .revealEfin()
      .pipe(finalize(() => this._revealingEfin.set(false)))
      .subscribe({
        next: ({ efin }) => {
          this._revealedEfin.set(efin);
          this.revealTimer?.unsubscribe();
          this.revealTimer = timer(EFIN_REVEAL_MS).subscribe(() => this._revealedEfin.set(null));
        },
        error: err => {
          const apiError = toApiError(err);
          this.setError(
            'compliance',
            apiError.code === 'Tenant.Compliance.EfinNotSet' ? 'There is no EFIN on file.' : apiError.message,
          );
        },
      });
  }

  hideEfin(): void {
    this.revealTimer?.unsubscribe();
    this.revealTimer = undefined;
    this._revealedEfin.set(null);
  }

  // ---------------------------------------------------------------------------

  private load<T>(part: SettingsPart, request: Observable<T>, apply: (value: T) => void): void {
    this.mark(this._loading, part, true);
    this.setError(part, null);
    request.pipe(finalize(() => this.mark(this._loading, part, false))).subscribe({
      next: apply,
      error: err => this.setError(part, toApiError(err).message),
    });
  }

  private save<T>(
    part: SettingsPart,
    request: Observable<T>,
    options: { onSaved: (value: T) => void; fieldOf?: (field: FormField) => FormField },
  ): Observable<void> {
    this.mark(this._saving, part, true);
    this.setError(part, null);
    return request.pipe(
      tap(options.onSaved),
      map(() => undefined),
      catchError(err => {
        const apiError = toApiError(err);
        const field = fieldForCode(apiError.code);
        // Un error de formato va junto a su campo; el resto, al aviso de la sección.
        if (field) {
          const target = options.fieldOf ? options.fieldOf(field) : field;
          this._fieldErrors.update(errors => ({ ...errors, [target]: apiError.message }));
        } else {
          this.setError(part, apiError.message);
        }
        throw err;
      }),
      finalize(() => this.mark(this._saving, part, false)),
    );
  }

  /**
   * Tenant usa el mismo código para las dos direcciones. Las reglas locales son las del backend: si la
   * física las pasa, el error es de la postal.
   */
  private resolveAddressField(field: FormField, profile: CompanyProfile): FormField {
    const mailing = MAILING_FIELD[field as ProfileField];
    if (!mailing || profile.mailingSameAsPhysical) return field;
    return profileErrors(profile)[field as ProfileField] ? field : mailing;
  }

  private setError(part: SettingsPart, message: string | null): void {
    this._errors.update(errors => ({ ...errors, [part]: message ?? undefined }));
  }

  private mark(target: WritableSignal<PartSet>, part: SettingsPart, on: boolean): void {
    target.update(set => {
      const next = new Set(set);
      if (on) next.add(part);
      else next.delete(part);
      return next;
    });
  }
}
