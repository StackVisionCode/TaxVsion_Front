import { Injectable, inject } from '@angular/core';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Observable, defer } from 'rxjs';
import { ApiConfigService, tenantSlugFromHost } from '@core/config/api-config.service';
import { environment } from '@env/environment';
import {
  AuditChainVerificationResponse,
  IssueChallengeBody,
  PublicSignerView,
  RejectSignatureBody,
  SignerVerificationMethod,
  SubmitSignatureBody,
  VerifyChallengeBody,
  VerifyPinBody,
} from './public-signature.model';

/**
 * Cliente HTTP del recorrido público del firmante (`signature/public`, `[AllowAnonymous]`).
 *
 * Dos decisiones que lo separan del resto de servicios del proyecto:
 *
 * 1. **Sin interceptores.** Se construye sobre `HttpBackend` en vez de `HttpClient`
 *    para saltarse `authInterceptor` y `errorInterceptor`. El firmante externo NO
 *    tiene sesión: mandar un `Authorization` heredado (por ejemplo, si un empleado
 *    abre el enlace en el mismo navegador donde tiene sesión) es ruido en un endpoint
 *    anónimo, y un 401 aquí NO debe disparar el refresh/redirect a /login del
 *    `errorInterceptor`. Tampoco se manda ningún header de tenant: el tenant viaja
 *    DENTRO del token firmado y lo resuelve `PublicTokenResolver` en el backend.
 *
 * 2. **Base URL derivada del HOST, no de la sesión.** `ApiConfigService.tenantBase()`
 *    usa el `tenant_slug` de localStorage y lanza en producción si no hay ninguno; el
 *    firmante externo nunca inició sesión, así que no lo tiene. Pero el enlace le llega
 *    apuntando a `https://<slug>.<baseDomain>/sign/<token>`: en una ruta pública el
 *    HOST es la fuente de verdad del tenant, no el localStorage.
 *
 *    El orden importa. Si se consultara la sesión primero, un empleado del tenant A que
 *    abre el enlace de un documento del tenant B (probar un envío, reenviarse el link)
 *    llamaría a `https://A.<baseDomain>/...` con un token que sólo existe en B, y el
 *    backend respondería "token inválido" sobre un enlace perfectamente válido. Por eso
 *    manda el host y el slug de sesión queda sólo como último recurso.
 */
@Injectable({ providedIn: 'root' })
export class PublicSignatureService {
  /** HttpClient "crudo": va directo al backend, sin la cadena de interceptores. */
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    // En dev un único gateway atiende sistema y tenant: no hay subdominios que deducir.
    if (!environment.production) {
      return this.api.tenantUrl('/signature/public');
    }

    // Prod: el subdominio desde el que se abrió el enlace identifica al tenant.
    const slug = tenantSlugFromHost();
    if (slug) {
      return `https://${slug}.${environment.baseDomain}/signature/public`;
    }

    // Enlace servido fuera del subdominio del tenant (dominio propio, acortador…).
    // Se intenta la sesión por si el propio staff lo abrió, y si no, el host de
    // sistema: el token ya lleva el TenantId, así que el Gateway puede resolverlo.
    try {
      return this.api.tenantUrl('/signature/public');
    } catch {
      return this.api.systemUrl('/signature/public');
    }
  }

  private url(token: string, suffix = ''): string {
    return `${this.base}/${encodeURIComponent(token)}${suffix}`;
  }

  // ---------- Lectura ----------

  /**
   * GET /signature/public/{token} — contexto de la firma. Además de leer, el backend
   * sella la primera apertura del enlace en el audit trail (por eso es un Command
   * allá). Es idempotente: se puede re-llamar tras cada mutación (que responde 204)
   * para refrescar el estado.
   */
  getContext(token: string): Observable<PublicSignerView> {
    return this.http.get<PublicSignerView>(this.url(token));
  }

  /**
   * GET /signature/public/{token}/verify-audit — veredicto de integridad de la cadena
   * append-only + los eventos con su `chainHash`. Es la ÚNICA fuente real de acuse
   * para el firmante (hash y timestamp del sellado). La cadena se alimenta por
   * mensajería asíncrona: justo tras firmar puede faltar la fila `DocumentSigned`.
   *
   * `defer` porque componer la URL puede LANZAR (`tenantBase()` revienta en prod si no
   * hay oficina resuelta). Sin él la excepción escapa de forma SÍNCRONA al llamador en
   * vez de viajar por el canal de error del Observable, y una pantalla que solo maneja
   * el `error` de la suscripción se quedaría colgada en "cargando".
   */
  verifyAudit(token: string): Observable<AuditChainVerificationResponse> {
    return defer(() => this.http.get<AuditChainVerificationResponse>(this.url(token, '/verify-audit')));
  }

  // ---------- Mutaciones (todas responden 204 No Content) ----------

  /**
   * POST /signature/public/{token}/consent — sin body. El backend resuelve el texto
   * y la versión del consent vigente para la categoría y guarda el snapshot exacto
   * (`ConsentEvent`), así que el frontend no envía el texto que mostró.
   */
  acceptConsent(token: string): Observable<void> {
    return this.http.post<void>(this.url(token, '/consent'), {});
  }

  /**
   * POST /signature/public/{token}/sign — la firma real. `Typed` exige `typedName`
   * idéntico al nombre del firmante; `Drawn`/`Uploaded` exigen un `signatureImageFileId`
   * ya subido a CloudStorage.
   */
  sign(token: string, body: SubmitSignatureBody): Observable<void> {
    return this.http.post<void>(this.url(token, '/sign'), body);
  }

  /**
   * POST /signature/public/{token}/verify-pin — PIN del preparador (4–10 dígitos).
   * Un fallo NO devuelve detalle (anti-enumeración): tras 5 intentos el firmante
   * queda bloqueado 30 min y `pinLockedUntilUtc` aparece en el contexto.
   */
  verifyPin(token: string, pin: string): Observable<void> {
    const body: VerifyPinBody = { pin };
    return this.http.post<void>(this.url(token, '/verify-pin'), body);
  }

  /**
   * POST /signature/public/{token}/challenge — emite un OTP por el canal indicado.
   * Llamarlo de nuevo con el mismo método = reenvío (cooldown de 30 s); con otro
   * método = cambio de canal (sin cooldown). `PractitionerPin` NO es válido aquí.
   * SMS/WhatsApp fallan con `Signature.Signer.NoDeliveryAddress` si el firmante no
   * tiene teléfono — dato que el contexto público no expone.
   */
  issueChallenge(token: string, method: SignerVerificationMethod): Observable<void> {
    const body: IssueChallengeBody = { method };
    return this.http.post<void>(this.url(token, '/challenge'), body);
  }

  /** POST /signature/public/{token}/verify-challenge — valida la respuesta del OTP activo. */
  verifyChallenge(token: string, method: SignerVerificationMethod, answer: string): Observable<void> {
    const body: VerifyChallengeBody = { method, answer };
    return this.http.post<void>(this.url(token, '/verify-challenge'), body);
  }

  /**
   * POST /signature/public/{token}/reject — rechazo con motivo opcional. OJO: el
   * aggregate incrementa `RevocationEpoch`, así que el token queda REVOCADO en el
   * acto y cualquier llamada posterior (incluido `getContext`) responde
   * `Signature.Token.Revoked`.
   */
  reject(token: string, reason: string | null): Observable<void> {
    const body: RejectSignatureBody = { reason };
    return this.http.post<void>(this.url(token, '/reject'), body);
  }
}
