import { DestroyRef, Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SETTINGS_CHANGED_EVENT, SettingsChangedEvent } from '@core/realtime/realtime.model';
import { CommunicationSettingsService } from './communication-settings.service';
import {
  CommunicationNumericKey,
  CommunicationOfficeSettings,
  CommunicationSettingsKey,
  CommunicationSettingsOverview,
  changedSettings,
  settingsErrorMessage,
} from './communication-settings.model';

/**
 * F9 — Store compartido por las cuatro páginas (Chat, Meetings, Calls, Recording & transcript). Se provee en la
 * ruta padre `settings/communication`, así el borrador sobrevive al cambiar de página dentro de la sección.
 * Un solo borrador sobre la vista del servidor; "Save" manda solo lo cambiado y el servidor devuelve la vista
 * nueva (que rehace el borrador). Si otra sesión cambia la configuración (`settings.changed`) se recarga, salvo
 * que haya cambios sin guardar: entonces se avisa y, al cargar lo de la otra sesión, lo propio sin guardar se
 * conserva encima.
 */
@Injectable()
export class CommunicationSettingsStore {
  private readonly service = inject(CommunicationSettingsService);
  private readonly realtime = inject(CommunicationRealtimeService);

  private readonly _overview = signal<CommunicationSettingsOverview | null>(null);
  private readonly _loading = signal(false);
  private readonly _loadError = signal<string | null>(null);
  private readonly _saving = signal(false);
  private readonly _saveError = signal<string | null>(null);
  private readonly _changedElsewhere = signal(false);

  readonly overview = this._overview.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly saveError = this._saveError.asReadonly();
  /** Otra sesión guardó mientras aquí había cambios sin guardar. */
  readonly changedElsewhere = this._changedElsewhere.asReadonly();
  readonly effective = computed(() => this._overview()?.effective ?? null);

  /** Copia editable que se rehace cada vez que llega la vista del servidor. */
  readonly draft = linkedSignal<CommunicationOfficeSettings | null>(() => {
    const settings = this._overview()?.settings;
    return settings ? { ...settings } : null;
  });

  readonly pendingChanges = computed(() => {
    const server = this._overview()?.settings;
    const draft = this.draft();
    return server && draft ? changedSettings(server, draft) : {};
  });
  readonly dirty = computed(() => Object.keys(this.pendingChanges()).length > 0);

  constructor() {
    this.realtime
      .on<SettingsChangedEvent>(SETTINGS_CHANGED_EVENT)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(event => {
        if (event.scope === 'user' || !this._overview() || this._saving()) return;
        if (this.dirty()) this._changedElsewhere.set(true);
        else this.reload();
      });
  }

  /** Carga una vez por visita a la sección (las páginas la piden al entrar). */
  ensureLoaded(): void {
    if (!this._overview() && !this._loading()) this.reload();
  }

  reload(): void {
    this._loading.set(true);
    this._loadError.set(null);
    this.service.get().subscribe({
      next: overview => {
        const pending = this.pendingChanges();
        this._overview.set(overview);
        if (Object.keys(pending).length > 0) this.draft.set({ ...overview.settings, ...pending });
        this._changedElsewhere.set(false);
        this._loading.set(false);
      },
      error: err => {
        this._loadError.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  set<K extends CommunicationSettingsKey>(key: K, value: CommunicationOfficeSettings[K]): void {
    const draft = this.draft();
    if (!draft) return;
    this._saveError.set(null);
    this.draft.set({ ...draft, [key]: value });
  }

  /** Mínimo técnico y máximo efectivo (techo del plan/oficina cuando lo hay) de un número editable. */
  range(key: CommunicationNumericKey, ceiling?: number | null): { min: number; max: number } {
    const technical = this._overview()?.ranges[key];
    // Sin vista cargada las páginas no se pintan; el 0..0 nunca llega a la pantalla.
    if (!technical) return { min: 0, max: 0 };
    const max = ceiling == null ? technical.max : Math.min(technical.max, ceiling);
    return { min: technical.min, max };
  }

  discard(): void {
    const settings = this._overview()?.settings;
    if (settings) this.draft.set({ ...settings });
    this._saveError.set(null);
  }

  /** Guarda lo cambiado. Devuelve false (con el error en `saveError`) si el servidor lo rechazó. */
  async save(): Promise<boolean> {
    const patch = this.pendingChanges();
    if (this._saving() || Object.keys(patch).length === 0) return true;
    this._saving.set(true);
    this._saveError.set(null);
    try {
      const overview = await firstValueFrom(this.service.update(patch));
      this._overview.set(overview);
      this._changedElsewhere.set(false);
      return true;
    } catch (err) {
      this._saveError.set(settingsErrorMessage(toApiError(err).code));
      return false;
    } finally {
      this._saving.set(false);
    }
  }
}
