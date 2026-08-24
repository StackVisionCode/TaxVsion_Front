import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, defer, of, switchMap, tap, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { MeResponse } from '@core/auth/auth.model';
import { toApiError } from '@core/models/api-error.model';
import { Referral } from '../ui/referral-table/referral-table.component';
import { ReferralsService } from './referrals.service';
import {
  IssueReferralCodeResponse,
  REFERRAL_ACTIVE_OWNER_EXISTS,
  REFERRAL_CODE_EXPIRES_AT_UTC,
  REFERRAL_PROGRAM_ID,
  buildReferralLink,
  referralCodeIdempotencyKey,
} from './referrals.model';

/** Caché local del código emitido, por tenant+programa (el texto plano es compartible por diseño). */
const CODE_CACHE_PREFIX = 'tvf.referrals.code';

/**
 * Store de la página de referidos (Growth vía /growth/referrals).
 *
 * Código propio: get-or-create con Idempotency-Key determinista por usuario. Si otro
 * usuario del tenant ya emitió el código, el backend responde ActiveOwnerExists y no
 * hay endpoint para recuperar el texto plano — se cae al caché local (persistido tras
 * la emisión original en este navegador) y, sin caché, a un error explicativo.
 *
 * Listado de referidos/earnings: el backend NO expone ningún GET de atribuciones,
 * reward cases ni grants del tenant (solo consumers M2M en /internal/*), así que
 * {@link referrals} queda vacío a propósito — la UI muestra un estado informativo
 * honesto en lugar de filas inventadas.
 */
@Injectable({ providedIn: 'root' })
export class ReferralsStore {
  private readonly service = inject(ReferralsService);
  private readonly auth = inject(AuthService);

  private readonly _code = signal<IssueReferralCodeResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** true cuando el código salió del caché local (otro usuario del tenant lo emitió). */
  private readonly _fromCache = signal(false);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly fromCache = this._fromCache.asReadonly();

  /** Texto plano del código del tenant (null mientras carga o si falló). */
  readonly referralCode = computed(() => this._code()?.referralCode ?? null);

  /** Enlace compartible hacia el signup pago-primero (/register?referral=<code>). */
  readonly referralLink = computed(() => {
    const code = this.referralCode();
    return code ? buildReferralLink(code) : null;
  });

  /**
   * Referidos del tenant. Siempre vacío: no existe GET público que liste atribuciones,
   * reward cases ni montos (gap del backend, p.ej. GET /growth/referrals/attributions).
   * Se mantiene como signal para que la UI se encienda sola cuando exista el endpoint.
   */
  private readonly _referrals = signal<Referral[]>([]);
  readonly referrals = this._referrals.asReadonly();

  /** Carga (o replay-ea) el código del tenant. `force` reintenta tras un error. */
  loadCode(force = false): void {
    if (this._loading() || (this._code() !== null && !force)) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);

    this.currentUser()
      .pipe(switchMap(user => this.issueOrRecover(user)))
      .subscribe({
        next: code => {
          this._code.set(code);
          this._loading.set(false);
        },
        error: (err: unknown) => {
          this._error.set(err instanceof RecoveryError ? err.message : toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  /** Usuario actual: ya hidratado por el app-initializer; si no (p.ej. /auth/me falló al arrancar), se reintenta. */
  private currentUser(): Observable<MeResponse> {
    const user = this.auth.currentUser();
    return user ? of(user) : defer(() => this.auth.me());
  }

  private issueOrRecover(user: MeResponse): Observable<IssueReferralCodeResponse> {
    const tenantId = user.tenant.id;
    const key = referralCodeIdempotencyKey(tenantId, user.id, REFERRAL_PROGRAM_ID);

    return this.service
      .issueCode({ programId: REFERRAL_PROGRAM_ID, expiresAtUtc: REFERRAL_CODE_EXPIRES_AT_UTC }, key)
      .pipe(
        tap(code => {
          this._fromCache.set(false);
          this.writeCache(tenantId, code);
        }),
        catchError((err: unknown) => {
          const apiError = toApiError(err);
          if (apiError.code !== REFERRAL_ACTIVE_OWNER_EXISTS) {
            return throwError(() => err);
          }
          // El código existe pero lo emitió otro usuario (la Idempotency-Key original
          // no es la nuestra): el único lugar donde queda el texto plano es el caché.
          const cached = this.readCache(tenantId);
          if (cached) {
            this._fromCache.set(true);
            return of(cached);
          }
          return throwError(
            () =>
              new RecoveryError(
                'Your office already has a referral code, but it was created by a teammate and cannot be retrieved from this session. Ask them for the link, or contact support.',
              ),
          );
        }),
      );
  }

  // ── Caché local (mismo patrón defensivo que TokenService) ─────────────────

  private cacheKey(tenantId: string): string {
    return `${CODE_CACHE_PREFIX}.${tenantId}.${REFERRAL_PROGRAM_ID}`;
  }

  private writeCache(tenantId: string, code: IssueReferralCodeResponse): void {
    try {
      localStorage.setItem(this.cacheKey(tenantId), JSON.stringify(code));
    } catch {
      // Sin persistencia disponible: el código vive solo en memoria.
    }
  }

  private readCache(tenantId: string): IssueReferralCodeResponse | null {
    try {
      const raw = localStorage.getItem(this.cacheKey(tenantId));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as IssueReferralCodeResponse;
      if (!parsed.referralCode || parsed.status !== 'Active') {
        return null;
      }
      // Un código vencido ya no sirve para compartir.
      if (new Date(parsed.expiresAtUtc).getTime() <= Date.now()) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

/** Error con mensaje ya apto para UI (no pasa por toApiError). */
class RecoveryError extends Error {}
