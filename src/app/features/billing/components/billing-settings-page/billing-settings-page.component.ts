import { Component, OnInit, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { AuthService } from '@core/auth/auth.service';
import { BillingStore } from '../../data-access/billing.store';
import {
  PaymentMethodFormComponent,
  ProviderCredentials,
  ProviderKeysUpdate,
  ProviderUrlEdit,
} from '../../ui/payment-method-form/payment-method-form.component';

/**
 * Settings → "Online payments": SOLO los proveedores de pago del catálogo. Los datos de la empresa
 * (identidad legal, logo y marca) viven en Office settings (/company/settings), de donde Billing toma
 * lo que estampa en la factura. Reusa el BillingStore.
 */
@Component({
  selector: 'app-billing-settings-page',
  imports: [RouterLink, PaymentMethodFormComponent],
  template: `
    <div class="min-h-full pt-3 pb-6 flex flex-col gap-6">
      <header class="pf-reveal rounded-[1.5rem] border border-gray-100 bg-white p-6 shadow-sm" style="--i: 0">
        <a routerLink="/settings" class="text-xs font-medium text-gray-500 hover:text-gray-700">← Settings</a>
        <h1 class="mt-1 text-xl font-bold text-gray-900">Online payments</h1>
        <p class="mt-1 text-sm text-gray-500">
          Connect the providers your clients use to pay invoices online. Your office details and logo live in
          <a routerLink="/company/settings" class="font-semibold text-brand-bold hover:underline">Office settings</a>.
        </p>
      </header>

      <app-payment-method-form
        [configs]="store.paymentConfigs()"
        [providers]="store.providerCatalog()"
        [providersLoading]="store.providerCatalogLoading()"
        [providersFailed]="store.providerCatalogFailed()"
        [loading]="store.configsLoading()"
        [saving]="store.savingProvider()"
        [canManage]="can.canManagePaymentProviders()"
        [officeName]="auth.currentUser()?.tenant?.name"
        [apiBase]="apiBase"
        [togglingCode]="store.togglingProvider()"
        (providerSaveRequested)="onProviderSave($event)"
        (providerKeysSaveRequested)="onProviderKeysSave($event)"
        (providerToggleRequested)="store.toggleProvider($event)"
        (providerDeleteRequested)="store.deleteProvider($event)"
        (providersRetryRequested)="store.loadProviderCatalog()"
        (urlSaveRequested)="onProviderUrlSave($event)"
      ></app-payment-method-form>
    </div>
  `,
})
export class BillingSettingsPageComponent implements OnInit {
  /** B6 — los proveedores de cobro se configuran con `payment_client.config.manage`. */
  protected readonly can = inject(AdminCapabilities);
  protected readonly auth = inject(AuthService);

  readonly store = inject(BillingStore);
  /** Base pública de la API (la misma de las llamadas): sobre ella va el webhook del catálogo. */
  readonly apiBase = this.store.publicApiBase();

  private readonly form = viewChild(PaymentMethodFormComponent);

  ngOnInit(): void {
    this.store.loadProviderCatalog();
    this.store.loadPaymentConfigs();
  }

  onProviderSave(credentials: ProviderCredentials): void {
    // Alta correcta: el formulario suelta claves y secretos.
    this.store.saveProvider(credentials, () => this.form()?.resetAfterSave());
  }

  onProviderKeysSave(update: ProviderKeysUpdate): void {
    this.store.updateProviderKeys(update, () => this.form()?.resetAfterSave());
  }

  onProviderUrlSave(edit: ProviderUrlEdit): void {
    this.store.saveProviderUrl(edit.providerCode, edit.apiBaseUrl);
  }
}
