import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BillingStore } from '../../data-access/billing.store';
import {
  PaymentMethodFormComponent,
  ProviderCredentials,
  ProviderUrlEdit,
} from '../../ui/payment-method-form/payment-method-form.component';

/**
 * Configuración de cobro de facturación (accedida desde Settings → "Invoices"): SOLO los proveedores
 * de pago (Stripe/PayPal/…). Los datos de la empresa (identidad legal, logo y marca) NO se duplican
 * acá — viven en Company settings (/company/settings), que es la fuente que además usa la factura
 * (issuer-profile). Reusa el BillingStore.
 */
@Component({
  selector: 'app-billing-settings-page',
  imports: [CommonModule, RouterLink, PaymentMethodFormComponent],
  template: `
    <div class="min-h-full pt-3 pb-1 flex flex-col gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Payment providers</h1>
        <p class="mt-1 text-sm text-gray-500">
          Connect the gateways that collect your invoices online. Your company details and logo live in
          <a routerLink="/company/settings" class="font-semibold text-brand-bold hover:underline">Company settings</a>.
        </p>
      </div>

      <app-payment-method-form
        [configs]="store.paymentConfigs()"
        [loading]="store.configsLoading()"
        [saving]="store.savingProvider()"
        (providerSaveRequested)="onProviderSave($event)"
        (providerToggleRequested)="store.toggleProvider($event)"
        (providerDeleteRequested)="store.deleteProvider($event)"
        (urlSaveRequested)="onProviderUrlSave($event)"
      ></app-payment-method-form>
    </div>
  `,
})
export class BillingSettingsPageComponent implements OnInit {
  readonly store = inject(BillingStore);

  ngOnInit(): void {
    this.store.loadPaymentConfigs();
  }

  onProviderSave(credentials: ProviderCredentials): void {
    this.store.saveProvider(credentials, () => undefined);
  }

  onProviderUrlSave(edit: ProviderUrlEdit): void {
    this.store.saveProviderUrl(edit.providerCode, edit.apiBaseUrl);
  }
}
