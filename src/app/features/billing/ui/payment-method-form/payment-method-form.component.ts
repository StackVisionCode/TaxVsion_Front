import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaymentConfig } from '../../data-access/billing.model';

/** Claves de Stripe que pide el alta. */
export interface StripeCredentials {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  statementDescriptor: string;
}

/**
 * Configuración del proveedor de cobro del tenant (`/payments-client/config`).
 *
 * Solo Stripe: PaymentClient no implementa otros proveedores, a diferencia del CRM legado, que
 * tenía pestañas de IntelliPay y PayPal apuntando a otro sistema. El alta son tres llamadas
 * encadenadas (crear config → guardar secretos → activar) porque así lo exige el servicio; la
 * secret key y el webhook secret se mandan una vez y el backend no los devuelve nunca más:
 * el listado solo dice si están puestos (`hasSecretKey` / `hasWebhookSecret`).
 */
@Component({
  selector: 'app-payment-method-form',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './payment-method-form.component.html',
})
export class PaymentMethodFormComponent {
  @Input() configs: PaymentConfig[] = [];
  @Input() loading = false;
  @Input() saving = false;

  @Output() stripeSaveRequested = new EventEmitter<StripeCredentials>();
  @Output() providerToggleRequested = new EventEmitter<PaymentConfig>();

  readonly publishableKey = signal('');
  readonly secretKey = signal('');
  readonly webhookSecret = signal('');
  readonly statementDescriptor = signal('TAXVISION');

  get canSave(): boolean {
    return !this.saving && this.publishableKey().trim().length > 0 && this.secretKey().trim().length > 0;
  }

  save(): void {
    if (!this.canSave) {
      return;
    }
    this.stripeSaveRequested.emit({
      publishableKey: this.publishableKey(),
      secretKey: this.secretKey(),
      webhookSecret: this.webhookSecret(),
      statementDescriptor: this.statementDescriptor(),
    });
  }

  /** Tras guardar, los secretos se limpian del formulario: no deben quedar en memoria de la vista. */
  clearSecrets(): void {
    this.secretKey.set('');
    this.webhookSecret.set('');
  }

  trackByConfigId(_index: number, config: PaymentConfig): string {
    return config.id;
  }
}
