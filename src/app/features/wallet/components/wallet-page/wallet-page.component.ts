import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { StatCardsComponent, StatCardItem } from '@shared/ui/stat-cards/stat-cards.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ToastService } from '@shared/ui/toast/toast.service';
import { formatMoney } from '@shared/utils/format.util';
import { WalletStore } from '../../data-access/wallet.store';
import {
  LedgerEntryView,
  RateView,
  TopUpProvider,
  dollarsToCents,
  formatMicros,
  movementPresentation,
} from '../../data-access/wallet.model';

const TOPUP_PRESETS = [10, 25, 50, 100];
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_TRIES = 12;
/** sessionStorage: la orden de recarga en vuelo, para pollear su estado al volver del proveedor. */
const TOPUP_INTENT_KEY = 'walletTopUpIntentId';

/**
 * Apartado Wallet (00_Plan §10): saldo (disponible/reservado/confirmado), recarga por <b>checkout hosteado</b>
 * (el tenant paga en Stripe/PayPal por redirect — nunca se guarda tarjeta), historial del ledger y tarifas. El
 * cobro de campañas ocurre por el PEP interno al enviar. Comparte `WalletStore` (singleton) con el pill del layout.
 */
@Component({
  selector: 'app-wallet-page',
  imports: [
    DatePipe,
    FormsModule,
    StatCardsComponent,
    StatusPillComponent,
    StateBlockComponent,
    ModalComponent,
    HasPermissionDirective,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './wallet-page.component.html',
})
export class WalletPageComponent implements OnInit {
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly presets = TOPUP_PRESETS;
  protected readonly showTopUp = signal(false);
  protected readonly busy = signal(false);
  protected readonly topUpDollars = signal<number>(25);
  protected readonly provider = signal<TopUpProvider>('Stripe');

  protected readonly fmt = formatMicros;
  protected readonly movementPresentation = movementPresentation;
  /** "$25.00" para el botón de pago (monto en dólares, no micros). */
  protected readonly fmtDollars = (dollars: number): string => formatMoney(dollars, 'USD');

  protected readonly stats = computed<StatCardItem[]>(() => {
    const currency = this.store.currency();
    return [
      {
        label: 'Available',
        value: formatMicros(this.store.availableMicros(), currency),
        tone: 'indigo-100',
        hint: this.store.lowBalance() ? 'Low balance — top up to keep sending' : 'Ready to spend',
        icon: 'wallet-outline',
      },
      {
        label: 'Reserved',
        value: formatMicros(this.store.heldMicros(), currency),
        tone: 'indigo-50',
        hint: 'Held for in-flight sends',
        icon: 'lock-closed-outline',
      },
      {
        label: 'Confirmed',
        value: formatMicros(this.store.postedMicros(), currency),
        tone: 'gray-200',
        hint: 'Total credited balance',
        icon: 'cash-outline',
      },
    ];
  });

  ngOnInit(): void {
    this.store.init();
    this.resumePendingTopUp();
  }

  protected openTopUp(): void {
    this.topUpDollars.set(25);
    this.provider.set('Stripe');
    this.showTopUp.set(true);
  }

  protected setPreset(dollars: number): void {
    this.topUpDollars.set(dollars);
  }

  protected selectProvider(provider: TopUpProvider): void {
    this.provider.set(provider);
  }

  /**
   * Monto del movimiento con signo por tipo (no el delta de disponible, que para Consume sería 0 — ese
   * dinero ya estaba reservado). Entradas de dinero/liberaciones en verde (+), reservas/cargos en oscuro (−).
   */
  protected amountLabel(e: LedgerEntryView): string {
    const sign = this.movementSign(e);
    const micros = Math.max(Math.abs(e.deltaPostedMicros), Math.abs(e.deltaHeldMicros));
    const prefix = sign > 0 ? '+' : sign < 0 ? '−' : '';
    return `${prefix}${formatMicros(micros, this.store.currency())}`;
  }

  protected amountClass(e: LedgerEntryView): string {
    const sign = this.movementSign(e);
    return sign > 0 ? 'text-emerald-600' : sign < 0 ? 'text-gray-900' : 'text-gray-400';
  }

  private movementSign(e: LedgerEntryView): number {
    switch (e.movement) {
      case 'TopUp':
      case 'Release':
      case 'UsageRefund':
        return 1;
      case 'Reserve':
      case 'Consume':
        return -1;
      case 'Adjustment':
        return Math.sign(e.deltaPostedMicros);
      default:
        return 0;
    }
  }

  protected rateLabel(r: RateView): string {
    return formatMicros(r.unitPriceMicros, this.store.currency(), 4);
  }

  /**
   * Inicia el checkout hosteado y redirige al proveedor. Guarda la orden en sessionStorage para pollear su
   * estado al volver. Nunca se cobra acá ni se captura una tarjeta: el pago ocurre en Stripe/PayPal.
   */
  protected continueToCheckout(): void {
    const dollars = Number(this.topUpDollars());
    if (!dollars || dollars <= 0) {
      this.toast.error('Enter an amount greater than zero.');
      return;
    }
    const returnUrl = window.location.href.split('?')[0];
    const prov = this.provider();
    this.busy.set(true);
    this.store
      .topUp({
        amountCents: dollarsToCents(dollars),
        payerEmail: this.auth.currentUser()?.email ?? '',
        successUrl: returnUrl,
        cancelUrl: returnUrl,
        provider: prov,
        method: prov === 'PayPal' ? 'Wallet' : 'Card',
      })
      .subscribe({
        next: checkout => {
          try {
            sessionStorage.setItem(TOPUP_INTENT_KEY, checkout.topUp.id);
          } catch {
            // sessionStorage no disponible (modo privado): el redirect igual funciona; el poll se saltea.
          }
          window.location.href = checkout.checkoutUrl;
        },
        error: () => {
          this.busy.set(false);
          this.toast.error(this.store.actionError() ?? 'Could not start the checkout.');
        },
      });
  }

  /** Al volver del proveedor: si había una recarga en vuelo, pollea su estado hasta acreditar. */
  private resumePendingTopUp(): void {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(TOPUP_INTENT_KEY);
    } catch {
      id = null;
    }
    if (id) {
      this.pollTopUp(id, 0);
    }
  }

  /** Recarga = cobro async (proveedor → webhook → evento → Wallet): se consulta el estado hasta acreditar. */
  private pollTopUp(id: string, tries: number): void {
    this.store.getTopUp(id).subscribe({
      next: t => {
        if (t.status === 'Credited') {
          this.clearPending();
          this.store.refresh();
          this.toast.success('Balance credited.');
          return;
        }
        if (t.status === 'Failed') {
          this.clearPending();
          this.toast.error('The payment did not go through. No charge was made.');
          return;
        }
        if (tries >= POLL_MAX_TRIES) {
          this.clearPending();
          this.store.refresh();
          this.toast.info('Payment is processing. Your balance will update shortly.');
          return;
        }
        setTimeout(() => this.pollTopUp(id, tries + 1), POLL_INTERVAL_MS);
      },
      error: () => this.clearPending(),
    });
  }

  private clearPending(): void {
    try {
      sessionStorage.removeItem(TOPUP_INTENT_KEY);
    } catch {
      // ignore
    }
  }
}
