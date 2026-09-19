import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, map, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SubscriptionService } from './subscription.service';
import {
  SavedPaymentMethod,
  SeatCheckoutStatusResponse,
  SeatPurchaseOutcome,
  SeatQuoteResponse,
  StartSeatCheckoutRequest,
  StartSeatCheckoutResponse,
} from './subscription.model';

/**
 * Data-access de compra de asientos, compartible entre la consola `/subscription` y el flujo de invitar en
 * `company/users` (por eso `providedIn: 'root'`). Mantiene la cotización vigente + estado de carga/cobro con
 * signals, el patrón del repo. El precio SIEMPRE viene del backend (`getSeatQuote`); el cliente nunca lo
 * calcula. Los errores se guardan como texto vía `toApiError`.
 */
@Injectable({ providedIn: 'root' })
export class SeatPurchaseStore {
  private readonly service = inject(SubscriptionService);

  private readonly _quote = signal<SeatQuoteResponse | null>(null);
  private readonly _quoteLoading = signal(false);
  private readonly _purchasing = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _hasCardOnFile = signal<boolean | null>(null);
  private readonly _defaultCard = signal<SavedPaymentMethod | null>(null);

  readonly quote = this._quote.asReadonly();
  readonly quoteLoading = this._quoteLoading.asReadonly();
  readonly purchasing = this._purchasing.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busy = computed(() => this._quoteLoading() || this._purchasing());
  /** null = aún sin resolver; true/false = si el tenant tiene tarjeta en archivo para el provider. */
  readonly hasCardOnFile = this._hasCardOnFile.asReadonly();
  readonly defaultCard = this._defaultCard.asReadonly();

  /** Pide al backend el prorrateo de comprar `quantity` asientos de `seatType` (precio server-authoritative). */
  loadQuote(seatType: string, quantity: number): void {
    this._quoteLoading.set(true);
    this._error.set(null);
    this.service.getSeatQuote(seatType, quantity).subscribe({
      next: quote => {
        this._quote.set(quote);
        this._quoteLoading.set(false);
      },
      error: err => {
        this._quoteLoading.set(false);
        this._error.set(toApiError(err).message);
      },
    });
  }

  /** Descarta la cotización vigente (p. ej. al cerrar el modal o cambiar la cantidad). */
  clearQuote(): void {
    this._quote.set(null);
    this._error.set(null);
  }

  /**
   * Inicia la compra. Hoy cobra off-session el método en archivo y devuelve `{ status: 'charged' }`. El
   * caller se suscribe (para navegar/toastear); el store solo lleva el estado `purchasing`/`error`. El modal
   * agregará el fallback `{ status: 'redirect' }` a hosted-checkout cuando no haya método en archivo.
   */
  startPurchase(seatType: string, quantity: number, autoRenew: boolean): Observable<SeatPurchaseOutcome> {
    this._purchasing.set(true);
    this._error.set(null);
    return this.service.purchaseSeats({ seatType, quantity, autoRenew }).pipe(
      map(seatIds => ({ status: 'charged', seatIds }) as SeatPurchaseOutcome),
      tap({ error: err => this._error.set(toApiError(err).message) }),
      finalize(() => this._purchasing.set(false)),
    );
  }

  /** Consulta si el tenant tiene tarjeta en archivo para el provider (decide off-session vs redirect). Un
   *  404 (sin cliente en el provider) se interpreta como "sin tarjeta". */
  checkCardOnFile(provider: string): void {
    this._hasCardOnFile.set(null);
    this._defaultCard.set(null);
    this.service.getProviderCustomer(provider).subscribe({
      next: customer => {
        const methods = customer.savedMethods ?? [];
        const card = methods.find(method => method.isDefault) ?? methods[0] ?? null;
        this._defaultCard.set(card);
        this._hasCardOnFile.set(card !== null);
      },
      error: () => {
        this._defaultCard.set(null);
        this._hasCardOnFile.set(false);
      },
    });
  }

  /** Inicia la compra por HOSTED-CHECKOUT: devuelve la URL de redirect (el caller navega). */
  startCheckout(req: StartSeatCheckoutRequest): Observable<StartSeatCheckoutResponse> {
    this._purchasing.set(true);
    this._error.set(null);
    return this.service.startSeatCheckout(req).pipe(
      tap({ error: err => this._error.set(toApiError(err).message) }),
      finalize(() => this._purchasing.set(false)),
    );
  }

  /** Estado de la intención de checkout (para pollear al volver del redirect). */
  getCheckoutStatus(intentId: string): Observable<SeatCheckoutStatusResponse> {
    return this.service.getSeatCheckoutStatus(intentId);
  }
}
