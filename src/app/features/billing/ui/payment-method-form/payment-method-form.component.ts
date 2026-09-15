import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PAYMENT_PROVIDERS, PaymentConfig } from '../../data-access/billing.model';

/** Credenciales genéricas que pide el alta de un proveedor de cobro. */
export interface ProviderCredentials {
  providerCode: string;
  mode: string;
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  statementDescriptor: string;
  apiBaseUrl: string;
}

/** Edición de la URL de un proveedor ya configurado. */
export interface ProviderUrlEdit {
  providerCode: string;
  apiBaseUrl: string;
}

/**
 * Configuración del proveedor de cobro del tenant (`/payments-client/config`), multi-proveedor.
 *
 * El tenant elige el proveedor y (opcionalmente) su URL/endpoint. El alta son tres llamadas
 * encadenadas (crear config → guardar secretos → activar) porque así lo exige el servicio; la
 * secret key y el webhook secret se mandan una vez y el backend no los devuelve nunca más (el
 * listado solo dice si están puestos). OJO: solo Stripe tiene adapter que cobra hoy; el resto se
 * puede configurar pero aún no procesa pagos.
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

  @Output() providerSaveRequested = new EventEmitter<ProviderCredentials>();
  @Output() providerToggleRequested = new EventEmitter<PaymentConfig>();
  @Output() providerDeleteRequested = new EventEmitter<PaymentConfig>();
  @Output() urlSaveRequested = new EventEmitter<ProviderUrlEdit>();

  readonly providers = PAYMENT_PROVIDERS;

  readonly providerCode = signal('Stripe');
  readonly publishableKey = signal('');
  readonly secretKey = signal('');
  readonly webhookSecret = signal('');
  readonly statementDescriptor = signal('TAXVISION');
  readonly apiBaseUrl = signal('');

  /** Estado de la edición inline de URL por fila: providerCode en edición + valor tipeado. */
  readonly editingUrlFor = signal<string | null>(null);
  readonly editingUrlValue = signal('');

  get canSave(): boolean {
    return (
      !this.saving &&
      this.providerCode().trim().length > 0 &&
      this.publishableKey().trim().length > 0 &&
      this.secretKey().trim().length > 0
    );
  }

  save(): void {
    if (!this.canSave) {
      return;
    }
    this.providerSaveRequested.emit({
      providerCode: this.providerCode(),
      mode: 'DirectApiKeys',
      publishableKey: this.publishableKey(),
      secretKey: this.secretKey(),
      webhookSecret: this.webhookSecret(),
      statementDescriptor: this.statementDescriptor(),
      apiBaseUrl: this.apiBaseUrl(),
    });
  }

  /** Tras guardar, los secretos se limpian del formulario: no deben quedar en memoria de la vista. */
  clearSecrets(): void {
    this.secretKey.set('');
    this.webhookSecret.set('');
  }

  startEditUrl(config: PaymentConfig): void {
    this.editingUrlFor.set(config.providerCode);
    this.editingUrlValue.set(config.apiBaseUrl ?? '');
  }

  cancelEditUrl(): void {
    this.editingUrlFor.set(null);
    this.editingUrlValue.set('');
  }

  saveEditUrl(config: PaymentConfig): void {
    this.urlSaveRequested.emit({ providerCode: config.providerCode, apiBaseUrl: this.editingUrlValue() });
    this.cancelEditUrl();
  }

  confirmDelete(config: PaymentConfig): void {
    if (confirm(`Remove the ${config.providerCode} provider? You can add it again afterwards.`)) {
      this.providerDeleteRequested.emit(config);
    }
  }

  trackByConfigId(_index: number, config: PaymentConfig): string {
    return config.id;
  }
}
