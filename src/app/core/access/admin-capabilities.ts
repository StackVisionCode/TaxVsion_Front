import { Injectable, Signal, computed, inject } from '@angular/core';
import { AccessStore } from './access.store';

/**
 * B6 — las capacidades administrativas de la oficina que no pertenecen a una sola feature: la
 * identidad de la empresa, la marca y el cobro. Viven en `core` porque las consultan pantallas de
 * varias features (Company settings, Settings/billing, Billing).
 *
 * Los códigos salen de los controladores. Desde la F1 el perfil de la oficina (razón social, EIN,
 * dirección) es de Tenant y lo edita `settings.manage`; Billing solo lo proyecta en las facturas.
 * `invoicing.issuer.manage` queda para los ajustes de factura de Billing (condiciones de pago,
 * instrucciones y pie), que tampoco vienen con el `invoicing.manage` de emitir facturas.
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

  /** Perfil de la oficina (`PUT /tenants/current/profile`): razón social, EIN, contacto y dirección. */
  readonly canManageOfficeProfile: Signal<boolean> = computed(() => this.access.can(AdminPermissions.SettingsManage));

  /** Ajustes de factura de Billing (`/billing/invoice-settings`): condiciones, instrucciones y pie. */
  readonly canManageInvoiceSettings: Signal<boolean> = computed(() =>
    this.access.can(AdminPermissions.InvoicingIssuerManage),
  );

  /**
   * Cumplimiento de la oficina (`/tenants/current/compliance`: EFIN, WISP, retención). Doble candado como el
   * backend: actor `TenantAdmin` (ni un empleado con `settings.manage` ni PlatformAdmin) y `settings.manage`.
   */
  readonly canManageCompliance: Signal<boolean> = computed(
    () => this.access.actorType() === 'TenantAdmin' && this.access.can(AdminPermissions.SettingsManage),
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
