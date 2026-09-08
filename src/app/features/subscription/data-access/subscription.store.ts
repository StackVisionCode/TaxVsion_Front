import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SubscriptionService } from './subscription.service';
import {
  AddOnDefinitionResponse,
  AddOnResponse,
  AuditLogEntryResponse,
  AuditSearchFilters,
  EntitlementSummaryResponse,
  SeatResponse,
  toEntitlementRows,
} from './subscription.model';

const PAGE_SIZE = 10;

/**
 * Estado de la sección Subscription. Cada pestaña carga por separado y guarda su
 * propio `loading`/`error` para que un 403 en seats (permiso `SeatsManage`) no
 * deje en blanco las pestañas que el usuario sí puede ver.
 */
@Injectable()
export class SubscriptionStore {
  private readonly service = inject(SubscriptionService);

  readonly pageSize = PAGE_SIZE;

  // --- Plan & limits ---
  readonly summary = signal<EntitlementSummaryResponse | null>(null);
  readonly summaryLoading = signal(false);
  readonly summaryError = signal<string | null>(null);
  readonly entitlementRows = computed(() => toEntitlementRows(this.summary()));

  // --- Seats ---
  readonly seats = signal<SeatResponse[]>([]);
  readonly seatsPage = signal(1);
  readonly seatsTotal = signal(0);
  readonly seatsLoading = signal(false);
  readonly seatsError = signal<string | null>(null);
  readonly seatsBusy = signal(false);
  readonly seatsActionError = signal<string | null>(null);

  // --- Add-ons ---
  readonly tenantAddOns = signal<AddOnResponse[]>([]);
  readonly addOnCatalog = signal<AddOnDefinitionResponse[]>([]);
  readonly addOnsLoading = signal(false);
  readonly addOnsError = signal<string | null>(null);
  readonly addOnsBusy = signal(false);
  readonly addOnsActionError = signal<string | null>(null);

  /** El catálogo trae nombre y descripción legibles; lo del tenant solo el código. */
  readonly addOnNameByCode = computed(() => {
    const map = new Map<string, AddOnDefinitionResponse>();
    for (const definition of this.addOnCatalog()) {
      map.set(definition.code, definition);
    }
    return map;
  });

  // --- Audit ---
  readonly auditEntries = signal<AuditLogEntryResponse[]>([]);
  readonly auditPage = signal(1);
  readonly auditTotal = signal(0);
  readonly auditLoading = signal(false);
  readonly auditError = signal<string | null>(null);

  // ---------- Plan & limits ----------

  loadSummary(): void {
    this.summaryLoading.set(true);
    this.summaryError.set(null);
    this.service.getEntitlementSummary().subscribe({
      next: summary => {
        this.summary.set(summary);
        this.summaryLoading.set(false);
      },
      error: err => {
        this.summaryError.set(toApiError(err).message);
        this.summaryLoading.set(false);
      },
    });
  }

  // ---------- Seats ----------

  loadSeats(page = this.seatsPage()): void {
    this.seatsLoading.set(true);
    this.seatsError.set(null);
    this.service.getSeats(page, PAGE_SIZE).subscribe({
      next: result => {
        this.seats.set(result.items ?? []);
        this.seatsTotal.set(result.totalCount ?? 0);
        this.seatsPage.set(result.page || page);
        this.seatsLoading.set(false);
      },
      error: err => {
        this.seatsError.set(toApiError(err).message);
        this.seatsLoading.set(false);
      },
    });
  }

  /** Envuelve una mutación de asiento: marca busy, traduce el error y recarga al terminar. */
  private runSeatAction(action: Observable<unknown>, onDone: () => void): void {
    this.seatsBusy.set(true);
    this.seatsActionError.set(null);
    action.subscribe({
      next: () => {
        this.seatsBusy.set(false);
        onDone();
      },
      error: err => {
        this.seatsBusy.set(false);
        this.seatsActionError.set(toApiError(err).message);
      },
    });
  }

  purchaseSeats(seatType: string, quantity: number, autoRenew: boolean, onDone: () => void): void {
    this.runSeatAction(this.service.purchaseSeats({ seatType, quantity, autoRenew }), () => {
      this.loadSeats(1);
      onDone();
    });
  }

  assignSeat(id: string, userId: string, onDone: () => void): void {
    this.runSeatAction(this.service.assignSeat(id, { userId }), () => {
      this.loadSeats();
      onDone();
    });
  }

  releaseSeat(id: string, reason: string | null, onDone: () => void): void {
    this.runSeatAction(this.service.releaseSeat(id, { reason }), () => {
      this.loadSeats();
      onDone();
    });
  }

  reassignSeat(id: string, toUserId: string, reason: string | null, onDone: () => void): void {
    this.runSeatAction(this.service.reassignSeat(id, { toUserId, reason }), () => {
      this.loadSeats();
      onDone();
    });
  }

  renewSeat(id: string): void {
    this.runSeatAction(this.service.renewSeat(id), () => this.loadSeats());
  }

  // ---------- Add-ons ----------

  loadAddOns(): void {
    this.addOnsLoading.set(true);
    this.addOnsError.set(null);
    // El catálogo es público y cacheado; si falla no debe tumbar la lista del
    // tenant, así que se pide aparte y su error solo deja los nombres en crudo.
    this.service.getAddOnCatalog().subscribe({
      next: catalog => this.addOnCatalog.set(catalog ?? []),
      error: () => this.addOnCatalog.set([]),
    });
    this.service.getTenantAddOns().subscribe({
      next: addOns => {
        this.tenantAddOns.set(addOns ?? []);
        this.addOnsLoading.set(false);
      },
      error: err => {
        this.addOnsError.set(toApiError(err).message);
        this.addOnsLoading.set(false);
      },
    });
  }

  private runAddOnAction(action: Observable<unknown>, onDone: () => void): void {
    this.addOnsBusy.set(true);
    this.addOnsActionError.set(null);
    action.subscribe({
      next: () => {
        this.addOnsBusy.set(false);
        onDone();
      },
      error: err => {
        this.addOnsBusy.set(false);
        this.addOnsActionError.set(toApiError(err).message);
      },
    });
  }

  purchaseAddOn(addOnCode: string, quantity: number, autoRenew: boolean, onDone: () => void): void {
    this.runAddOnAction(this.service.purchaseAddOn({ addOnCode, quantity, autoRenew }), () => {
      this.loadAddOns();
      onDone();
    });
  }

  cancelAddOn(id: string, reason: string, onDone: () => void): void {
    this.runAddOnAction(this.service.cancelAddOn(id, { reason }), () => {
      this.loadAddOns();
      onDone();
    });
  }

  renewAddOn(id: string): void {
    this.runAddOnAction(this.service.renewAddOn(id), () => this.loadAddOns());
  }

  // ---------- Audit ----------

  loadAudit(page = this.auditPage(), filters: AuditSearchFilters = { aggregateType: null, from: null, to: null }): void {
    this.auditLoading.set(true);
    this.auditError.set(null);
    this.service
      .searchAudit(page, PAGE_SIZE, filters)
      .pipe(tap(() => this.auditPage.set(page)))
      .subscribe({
        next: result => {
          this.auditEntries.set(result.items ?? []);
          this.auditTotal.set(result.totalCount ?? 0);
          this.auditLoading.set(false);
        },
        error: err => {
          this.auditError.set(toApiError(err).message);
          this.auditLoading.set(false);
        },
      });
  }
}
