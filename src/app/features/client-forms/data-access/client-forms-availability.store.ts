import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ClientFormsAvailability, ClientFormsCapabilities } from './client-forms.model';
import { FormTemplatesService } from './form-templates.service';

/**
 * Disponibilidad del módulo y sub-flags de la oficina (X-3, decisión 2026-10-26).
 * Se pide una vez por visita a la feature; ocultar un botón no es la seguridad, la decide el backend.
 */
@Injectable()
export class ClientFormsAvailabilityStore {
  private readonly service = inject(FormTemplatesService);

  private readonly _availability = signal<ClientFormsAvailability | null>(null);
  private readonly _loading = signal(false);
  private readonly _failed = signal(false);

  readonly availability = this._availability.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly failed = this._failed.asReadonly();
  readonly enabled = computed(() => this._availability()?.enabled ?? false);
  readonly capabilities = computed<ClientFormsCapabilities | null>(
    () => this._availability()?.capabilities ?? null,
  );
  readonly externalParticipantsEnabled = computed(
    () => this.capabilities()?.externalParticipantsEnabled ?? false,
  );
  readonly intakeLinksEnabled = computed(() => this.capabilities()?.intakeLinksEnabled ?? false);

  async load(): Promise<ClientFormsAvailability | null> {
    this._loading.set(true);
    this._failed.set(false);
    try {
      const availability = await firstValueFrom(this.service.availability());
      this._availability.set(availability);
      return availability;
    } catch {
      this._failed.set(true);
      this._availability.set(null);
      return null;
    } finally {
      this._loading.set(false);
    }
  }
}
