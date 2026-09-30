import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BillingStore } from '../../data-access/billing.store';
import {
  PaymentMethodFormComponent,
  ProviderCredentials,
  ProviderUrlEdit,
} from '../../ui/payment-method-form/payment-method-form.component';
import { AdminCapabilities } from '@core/access/admin-capabilities';

/**
 * Configuración de proveedores de cobro (Stripe / PayPal / …). Vive bajo /billing/providers pero se
 * accede desde Settings → "Payment providers". Reusa el mismo <app-payment-method-form> y el
 * BillingStore (singleton) que la sección de facturación.
 */
@Component({
  selector: 'app-provider-settings-page',
  imports: [CommonModule, PaymentMethodFormComponent],
  template: `
    <div class="min-h-full pt-3 pb-1">
      <app-payment-method-form
        [configs]="store.paymentConfigs()"
        [loading]="store.configsLoading()"
        [saving]="store.savingProvider()"
        [canManage]="can.canManagePaymentProviders()"
        (providerSaveRequested)="onSave($event)"
        (providerToggleRequested)="store.toggleProvider($event)"
        (providerDeleteRequested)="store.deleteProvider($event)"
        (urlSaveRequested)="onUrlSave($event)"
      ></app-payment-method-form>
    </div>
  `,
})
export class ProviderSettingsPageComponent implements OnInit {
  /** B6 — los proveedores de cobro se configuran con `payment_client.config.manage`. */
  protected readonly can = inject(AdminCapabilities);

  readonly store = inject(BillingStore);

  ngOnInit(): void {
    this.store.loadPaymentConfigs();
  }

  onSave(credentials: ProviderCredentials): void {
    this.store.saveProvider(credentials, () => undefined);
  }

  onUrlSave(edit: ProviderUrlEdit): void {
    this.store.saveProviderUrl(edit.providerCode, edit.apiBaseUrl);
  }
}
