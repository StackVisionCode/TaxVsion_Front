import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '@env/environment';
import {
  ConfirmTotpResponse,
  MfaStatusResponse,
  RegenerateRecoveryCodesResponse,
  SetupTotpResponse,
} from './mfa.model';

/**
 * Endpoints MFA bajo /auth/mfa (todos Bearer). El flujo de login usa `setupTotp` +
 * `confirmTotp` (enrolamiento forzado). El resto son métodos finos que consumirá una
 * futura pantalla de seguridad; aún sin UI.
 *
 * En modo mock, `setupTotp`/`confirmTotp` devuelven datos sintéticos por si se llega
 * a la pantalla de enrolamiento con el backend caído.
 */
@Injectable({ providedIn: 'root' })
export class MfaService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  setupTotp(): Observable<SetupTotpResponse> {
    if (environment.authMock) {
      return of({
        secret: 'MOCKSECRET234567',
        otpAuthUri:
          'otpauth://totp/TaxVision:demo@taxvision.local?secret=MOCKSECRET234567&issuer=TaxVision&algorithm=SHA1&digits=6&period=30',
      });
    }
    return this.http.post<SetupTotpResponse>(`${this.base}/auth/mfa/totp/setup`, {});
  }

  confirmTotp(code: string): Observable<ConfirmTotpResponse> {
    if (environment.authMock) {
      return of({ recoveryCodes: Array.from({ length: 10 }, (_, i) => `MOCK-${1000 + i}`) });
    }
    return this.http.post<ConfirmTotpResponse>(`${this.base}/auth/mfa/totp/confirm`, { code });
  }

  getStatus(): Observable<MfaStatusResponse> {
    return this.http.get<MfaStatusResponse>(`${this.base}/auth/mfa/status`);
  }

  disable(password: string): Observable<void> {
    return this.http.post<void>(`${this.base}/auth/mfa/disable`, { password });
  }

  regenerateRecoveryCodes(password: string): Observable<RegenerateRecoveryCodesResponse> {
    return this.http.post<RegenerateRecoveryCodesResponse>(
      `${this.base}/auth/mfa/recovery-codes/regenerate`,
      { password },
    );
  }

  revokeTrustedDevice(deviceId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/auth/mfa/trusted-devices/${deviceId}`);
  }
}
