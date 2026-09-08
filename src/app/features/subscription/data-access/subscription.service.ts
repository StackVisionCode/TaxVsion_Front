import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AddOnDefinitionResponse,
  AddOnResponse,
  AssignSeatRequest,
  AuditLogEntryResponse,
  AuditSearchFilters,
  CancelAddOnRequest,
  EntitlementSummaryResponse,
  PagedResult,
  PurchaseAddOnRequest,
  PurchaseSeatsRequest,
  ReassignSeatRequest,
  ReleaseSeatRequest,
  SeatResponse,
} from './subscription.model';

/**
 * Cliente HTTP del servicio Subscription. Cuatro prefijos del Gateway que hasta
 * ahora el CRM no consumía: `/entitlements`, `/seats`, `/addons` y `/audit`.
 *
 * Todo va con el JWT que pone el interceptor; el tenant sale del claim
 * `tenant_id`, así que ninguna llamada lo manda en la query. Las mutaciones de
 * seats y add-ons exigen permiso (`SeatsManage` / `AddOnsManage`) y actor
 * TenantAdmin: para un usuario sin permiso el backend responde 403, no 401.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantBase();
  }

  // ---------- Entitlements (solo lectura) ----------

  getEntitlementSummary(): Observable<EntitlementSummaryResponse> {
    return this.http.get<EntitlementSummaryResponse>(`${this.base}/entitlements/summary`);
  }

  // ---------- Seats ----------

  getSeats(page: number, pageSize: number, status?: string | null, type?: string | null): Observable<PagedResult<SeatResponse>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (status) {
      params = params.set('status', status);
    }
    if (type) {
      params = params.set('type', type);
    }
    return this.http.get<PagedResult<SeatResponse>>(`${this.base}/seats`, { params });
  }

  /** 201 con la lista de ids creados (uno por asiento comprado). */
  purchaseSeats(req: PurchaseSeatsRequest): Observable<string[]> {
    return this.http.post<string[]>(`${this.base}/seats/purchase`, req);
  }

  assignSeat(id: string, req: AssignSeatRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/assign`, req);
  }

  releaseSeat(id: string, req: ReleaseSeatRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/release`, req);
  }

  reassignSeat(id: string, req: ReassignSeatRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/reassign`, req);
  }

  renewSeat(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/seats/${id}/renew`, {});
  }

  // ---------- Add-ons ----------

  /**
   * Catálogo de definiciones disponibles (qué se puede comprar).
   * `GET /addons` a secas — es público (`[AllowAnonymous]`, cacheado 300s en el
   * servidor); el POST al mismo path es la compra, que sí exige permiso.
   */
  getAddOnCatalog(): Observable<AddOnDefinitionResponse[]> {
    return this.http.get<AddOnDefinitionResponse[]>(`${this.base}/addons`);
  }

  /** Los que el tenant ya tiene contratados. */
  getTenantAddOns(): Observable<AddOnResponse[]> {
    return this.http.get<AddOnResponse[]>(`${this.base}/addons/tenant`);
  }

  purchaseAddOn(req: PurchaseAddOnRequest): Observable<string> {
    return this.http.post<string>(`${this.base}/addons`, req);
  }

  cancelAddOn(id: string, req: CancelAddOnRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/addons/${id}/cancel`, req);
  }

  renewAddOn(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/addons/${id}/renew`, {});
  }

  // ---------- Audit ----------

  searchAudit(page: number, pageSize: number, filters: AuditSearchFilters): Observable<PagedResult<AuditLogEntryResponse>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (filters.aggregateType) {
      params = params.set('aggregateType', filters.aggregateType);
    }
    if (filters.from) {
      params = params.set('from', filters.from);
    }
    if (filters.to) {
      params = params.set('to', filters.to);
    }
    return this.http.get<PagedResult<AuditLogEntryResponse>>(`${this.base}/audit`, { params });
  }
}
