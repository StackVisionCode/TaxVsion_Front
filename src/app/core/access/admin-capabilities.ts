import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from './access.store';

/**
 * B6 — las capacidades administrativas de la oficina que no pertenecen a una sola feature: la
 * identidad de la empresa, la marca y el cobro. Viven en `core` porque las consultan pantallas de
 * varias features (Company settings, Settings/billing, Billing).
 *
 * Los códigos salen de los controladores, y uno no coincide con lo que decía la auditoría: el
 * perfil legal del emisor es **`invoicing.issuer.manage`**, un permiso propio, no el
 * `invoicing.manage` de las facturas. Tiene sentido: cambiar el EIN y la razón social que se
 * estampan en cada factura no es lo mismo que emitir una.
 */
export const AdminPermissions = {
  BrandingManage: 'branding.manage',
  InvoicingView: 'invoicing.view',
  InvoicingManage: 'invoicing.manage',
  InvoicingIssuerManage: 'invoicing.issuer.manage',
  SettingsManage: 'settings.manage',
  PaymentConfigRead: 'payment_client.config.read',
  PaymentConfigManage: 'payment_client.config.manage',
  PaymentLinkManage: 'payment_client.payment_link.manage',
  ConnectAccountOnboard: 'payment_client.connect_account.onboard',
} as const;

@Injectable({ providedIn: 'root' })
export class AdminCapabilities {
  private readonly access = inject(AccessStore);

  /** Logo, favicon y colores del tenant. */
  readonly canManageBranding: Signal<boolean> = computed(() => this.access.can(AdminPermissions.BrandingManage));

  /** Razón social, EIN y dirección que se estampan en las facturas. */
  readonly canManageIssuerProfile: Signal<boolean> = computed(() =>
    this.access.can(AdminPermissions.InvoicingIssuerManage),
  );

  /** Ajustes generales del tenant. */
  readonly canManageSettings: Signal<boolean> = computed(() => this.access.can(AdminPermissions.SettingsManage));

  readonly canViewInvoices: Signal<boolean> = computed(() => this.access.can(AdminPermissions.InvoicingView));
  readonly canManageInvoices: Signal<boolean> = computed(() => this.access.can(AdminPermissions.InvoicingManage));

  /** Configurar Stripe/PayPal para cobrar facturas. */
  readonly canManagePaymentProviders: Signal<boolean> = computed(() =>
    this.access.can(AdminPermissions.PaymentConfigManage),
  );
  readonly canReadPaymentProviders: Signal<boolean> = computed(() =>
    this.access.canAny([AdminPermissions.PaymentConfigRead, AdminPermissions.PaymentConfigManage]),
  );
  readonly canManagePaymentLinks: Signal<boolean> = computed(() =>
    this.access.can(AdminPermissions.PaymentLinkManage),
  );
  readonly canOnboardConnectAccount: Signal<boolean> = computed(() =>
    this.access.can(AdminPermissions.ConnectAccountOnboard),
  );
}
