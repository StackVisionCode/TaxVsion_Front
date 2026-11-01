import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/** `GET /auth/mfa/policy`: a quién exige la oficina el segundo factor. */
export interface MfaPolicy {
  /** Administradores: lo fija la plataforma, no se cambia desde aquí. */
  requireForAdmins: boolean;
  requireForEmployees: boolean;
  requireForCustomerPortal: boolean;
  /** Días que un dispositivo marcado como de confianza no vuelve a pedir el código (1–90). */
  trustedDeviceDays: number;
}

/** Cuerpo de `PUT /auth/mfa/policy` (lo editable). */
export type MfaPolicyUpdate = Omit<MfaPolicy, 'requireForAdmins'>;

/** Política de segundo factor de la oficina (Auth.Api, perm `settings.manage`). */
@Injectable({ providedIn: 'root' })
export class MfaPolicyService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  get(): Observable<MfaPolicy> {
    return this.http.get<MfaPolicy>(this.api.tenantUrl('/auth/mfa/policy'));
  }

  update(policy: MfaPolicyUpdate): Observable<void> {
    return this.http.put<void>(this.api.tenantUrl('/auth/mfa/policy'), policy);
  }
}
