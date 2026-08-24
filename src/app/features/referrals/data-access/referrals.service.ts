import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  CreateReferralAttributionRequest,
  CreateReferralAttributionResponse,
  IssueReferralCodeRequest,
  IssueReferralCodeResponse,
} from './referrals.model';

/**
 * Cliente HTTP fino sobre ReferralsController (`/growth/referrals`, servicio Growth vía
 * Gateway). Ambos POST exigen el header `Idempotency-Key` (el interceptor agrega el token).
 */
@Injectable({ providedIn: 'root' })
export class ReferralsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/growth/referrals');
  }

  /**
   * POST /growth/referrals/codes — get-or-create idempotente del código del tenant.
   * Requiere permiso `referrals.own.read`. Con la MISMA Idempotency-Key el backend
   * replay-ea la respuesta original (mismo código en texto plano); con una clave nueva
   * y un código Active ya emitido falla con ReferralCode.ActiveOwnerExists.
   */
  issueCode(req: IssueReferralCodeRequest, idempotencyKey: string): Observable<IssueReferralCodeResponse> {
    return this.http.post<IssueReferralCodeResponse>(`${this.base}/codes`, req, {
      headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }),
    });
  }

  /**
   * POST /growth/referrals/attributions — lado del tenant REFERIDO (staff-only): registra
   * el código de quien lo refirió; la identidad del referee sale del JWT. No lo usa la
   * página de referidos (el referrer), pertenece al flujo post-alta del tenant nuevo.
   */
  createAttribution(
    req: CreateReferralAttributionRequest,
    idempotencyKey: string,
  ): Observable<CreateReferralAttributionResponse> {
    return this.http.post<CreateReferralAttributionResponse>(`${this.base}/attributions`, req, {
      headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }),
    });
  }
}
