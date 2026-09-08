import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { MfaService } from '@core/auth/mfa.service';
import {
  MfaMethodInfo,
  MfaStatusResponse,
  SetupTotpResponse,
  TrustedDeviceInfo,
} from '@core/auth/mfa.model';
import { toApiError } from '@core/models/api-error.model';
import { toUtcIso } from './profile.model';

/**
 * Store de la sección "Two-step verification" del perfil. Envuelve el
 * `MfaService` de core (que ya existía, usado hasta ahora solo por el
 * enrolamiento forzado del login) y expone el estado de MFA del usuario en
 * signals, con el mismo patrón que `ProfileStore`: el estado de lectura vive
 * aquí y las acciones devuelven Observables para que el componente maneje
 * busy/errores por operación.
 *
 * Endpoints reales (Auth/Api/Controllers/MfaController.cs):
 * - GET  /auth/mfa/status
 * - POST /auth/mfa/totp/setup + /auth/mfa/totp/confirm
 * - POST /auth/mfa/disable                      (requiere contraseña)
 * - POST /auth/mfa/recovery-codes/regenerate    (requiere contraseña)
 * - DELETE /auth/mfa/trusted-devices/{deviceId}
 */
@Injectable({ providedIn: 'root' })
export class ProfileMfaStore {
  private readonly mfa = inject(MfaService);

  private readonly _status = signal<MfaStatusResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly status = this._status.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** true solo cuando el backend confirma que MFA está activo. */
  readonly enabled = computed(() => this._status()?.mfaEnabled ?? false);

  /** Métodos ya confirmados (los no confirmados son enrolamientos a medias). */
  readonly methods = computed<MfaMethodInfo[]>(
    () => this._status()?.methods.filter(m => m.isConfirmed) ?? [],
  );

  readonly trustedDevices = computed<TrustedDeviceInfo[]>(
    () => this._status()?.trustedDevices ?? [],
  );

  readonly recoveryCodesRemaining = computed(() => this._status()?.recoveryCodesRemaining ?? 0);

  /** Primera carga hecha (para no mostrar el vacío antes de tener respuesta). */
  readonly loaded = computed(() => this._status() !== null);

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    this.mfa.getStatus().subscribe({
      next: status => {
        this._status.set(normalizeStatus(status));
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  /** POST /auth/mfa/totp/setup — devuelve secret + otpAuthUri para pintar el QR. */
  setupTotp(): Observable<SetupTotpResponse> {
    return this.mfa.setupTotp();
  }

  /** POST /auth/mfa/totp/confirm — activa MFA y entrega los códigos de recuperación (una sola vez). */
  confirmTotp(code: string): Observable<string[]> {
    return this.mfa.confirmTotp(code).pipe(
      map(res => res.recoveryCodes),
      tap(() => this.load()),
    );
  }

  /** POST /auth/mfa/disable — el backend exige la contraseña actual. */
  disable(password: string): Observable<void> {
    return this.mfa.disable(password).pipe(tap(() => this.load()));
  }

  /** POST /auth/mfa/recovery-codes/regenerate — invalida los anteriores y devuelve los nuevos. */
  regenerateRecoveryCodes(password: string): Observable<string[]> {
    return this.mfa.regenerateRecoveryCodes(password).pipe(
      map(res => res.recoveryCodes),
      tap(() => this.load()),
    );
  }

  /** DELETE /auth/mfa/trusted-devices/{id} — retira el dispositivo de la lista local al confirmar. */
  revokeTrustedDevice(deviceId: string): Observable<void> {
    return this.mfa.revokeTrustedDevice(deviceId).pipe(
      tap(() => {
        const current = this._status();
        if (!current) {
          return;
        }
        this._status.set({
          ...current,
          trustedDevices: current.trustedDevices.filter(d => d.id !== deviceId),
        });
      }),
    );
  }
}

/** El backend serializa algunos DateTime UTC sin sufijo de zona; se fuerza la 'Z'. */
function normalizeStatus(status: MfaStatusResponse): MfaStatusResponse {
  return {
    ...status,
    methods: status.methods.map(m => ({
      ...m,
      lastUsedAtUtc: m.lastUsedAtUtc ? toUtcIso(m.lastUsedAtUtc) : null,
    })),
    trustedDevices: status.trustedDevices.map(d => ({
      ...d,
      createdAtUtc: toUtcIso(d.createdAtUtc),
      expiresAtUtc: toUtcIso(d.expiresAtUtc),
    })),
  };
}
