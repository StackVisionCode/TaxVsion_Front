import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { WalletService } from './wallet.service';
import {
  EstimateView,
  LedgerEntryView,
  PerChannelUnits,
  RateView,
  RatesView,
  TopUpCheckoutView,
  TopUpRequest,
  TopUpView,
  WalletView,
} from './wallet.model';

const TX_PAGE_SIZE = 10;

/**
 * Store del monedero (`TaxVision.Wallet`). Singleton (`providedIn: 'root'`) para que el apartado Wallet y
 * el pill de saldo del layout compartan una sola fuente de verdad: una recarga o un envío refrescan ambos.
 * Saldo/historial/tarifas como signals; las acciones refrescan el recurso afectado vía `act()`.
 */
@Injectable({ providedIn: 'root' })
export class WalletStore {
  private readonly service = inject(WalletService);
  private readonly realtime = inject(CommunicationRealtimeService);
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _wallet = signal<WalletView | null>(null);
  private readonly _transactions = signal<LedgerEntryView[]>([]);
  private readonly _rates = signal<RateView[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _txError = signal<string | null>(null);
  private readonly _ratesError = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private initialized = false;
  private txRequestId = 0;
  private readonly _txLoading = signal(false);
  private readonly _txPage = signal(1);
  private readonly _txTotal = signal(0);
  private readonly _txPageSize = signal(TX_PAGE_SIZE);
  readonly txLoading = this._txLoading.asReadonly();
  readonly txPage = this._txPage.asReadonly();
  readonly txTotal = this._txTotal.asReadonly();
  readonly txPageSize = this._txPageSize.asReadonly();

  readonly wallet = this._wallet.asReadonly();
  readonly transactions = this._transactions.asReadonly();
  readonly rates = this._rates.asReadonly();
  /** Tarifas visibles al usuario: solo canales cobrables/ofrecidos (Email, SMS). Push es del sistema
   *  (gratis) y WhatsApp está oculto por ahora. */
  readonly displayRates = computed(() => this._rates().filter(r => r.channel === 'Email' || r.channel === 'Sms'));
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly txError = this._txError.asReadonly();
  readonly ratesError = this._ratesError.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  readonly availableMicros = computed(() => this._wallet()?.availableMicros ?? 0);
  readonly heldMicros = computed(() => this._wallet()?.heldMicros ?? 0);
  readonly postedMicros = computed(() => this._wallet()?.postedMicros ?? 0);
  readonly currency = computed(() => this._wallet()?.currency ?? 'USD');
  /** Alerta de saldo bajo: menos de $5 disponibles. */
  readonly lowBalance = computed(() => this.availableMicros() < 5_000_000);

  /** Carga perezosa (una vez). El pill lo llama al montar; la página, al entrar. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadWallet();
    this.loadTransactions();
    this.loadRates();
    // Tiempo real: Communication relaya `wallet.updated` cuando cambia el saldo (recarga/reserva/cobro).
    // El socket es singleton (lo abre el shell); acá solo refrescamos saldo+historial con debounce.
    this.realtime.on<unknown>('wallet.updated').subscribe(() => this.scheduleRefresh());
  }

  /** Coalesce de ráfagas (reserva+consumo+liberación de un run llegan juntas) en un refresco ~800ms. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 800);
  }

  loadWallet(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.getWallet().subscribe({
      next: w => {
        this._wallet.set(w);
        this._loading.set(false);
      },
      error: e => {
        this._error.set(toApiError(e).message);
        this._loading.set(false);
      },
    });
  }

  loadTransactions(page = this._txPage()): void {
    if (!Number.isInteger(page) || page < 1) return;
    const requestId = ++this.txRequestId;
    this._txLoading.set(true);
    this._txError.set(null);
    this.service.listTransactions(page, TX_PAGE_SIZE).subscribe({
      next: p => {
        if (requestId !== this.txRequestId) return;
        const lastPage = Math.max(1, p.totalPages);
        if (page > lastPage) {
          this.loadTransactions(lastPage);
          return;
        }
        this._transactions.set(p.items);
        this._txPage.set(p.page);
        this._txTotal.set(p.totalCount);
        this._txPageSize.set(p.size);
        this._txLoading.set(false);
      },
      error: e => {
        if (requestId !== this.txRequestId) return;
        this._txError.set(toApiError(e).message);
        this._txLoading.set(false);
      },
    });
  }

  loadRates(): void {
    this._ratesError.set(null);
    this.service.getRates().subscribe({
      next: (r: RatesView) => this._rates.set(r.rates),
      error: e => this._ratesError.set(toApiError(e).message),
    });
  }

  /** Refresca saldo + historial (tras acreditarse una recarga o cerrarse un envío). */
  refresh(): void {
    this.loadWallet();
    this.loadTransactions();
  }

  /** Inicia una recarga por checkout hosteado. Devuelve el Observable con la URL del proveedor para redirigir. */
  topUp(req: TopUpRequest): Observable<TopUpCheckoutView> {
    this._actionError.set(null);
    return this.service.createTopUp(req).pipe(
      tap({ error: e => this._actionError.set(toApiError(e).message) }),
    );
  }

  getTopUp(id: string): Observable<TopUpView> {
    return this.service.getTopUp(id);
  }

  /** Cotización sin efectos — la usa el preview de costo antes de enviar una campaña. */
  estimate(units: PerChannelUnits): Observable<EstimateView> {
    return this.service.estimate(units);
  }
}
