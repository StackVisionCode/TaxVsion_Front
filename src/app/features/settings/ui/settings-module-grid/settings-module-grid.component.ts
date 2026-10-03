import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';

export interface SettingsModule {
  id: string;
  title: string;
  description: string;
  icon: string;
  circleClass: string;
  /** Si está presente, la tarjeta navega a esta ruta en vez de seleccionar un panel local. */
  routerLink?: string;
  /**
   * Feature del registro `core/access/features` que la tarjeta configura. Sin esto la tarjeta se
   * ve siempre (Overview, que es la configuración general y no pertenece a ningún módulo).
   */
  featureId?: string;
}

export const SETTINGS_MODULES: SettingsModule[] = [
  { id: 'overview', title: 'Overview', description: 'App colors and general preferences', icon: 'grid-outline', circleClass: 'bg-gray-200 text-gray-700' },
  // El nombre de la firma, EIN, dirección, logo y paleta del tenant sí tienen backend
  // (Billing /billing/issuer-profile + /tenants/{id}/...), pero se editan en su propia
  // pantalla: se enlaza en vez de duplicar el formulario acá.
  { id: 'company', featureId: 'company-settings', title: 'Company', description: 'Legal name, EIN, address, logo and brand colors', icon: 'business-outline', circleClass: 'bg-indigo-100 text-brand-bold', routerLink: '/company/settings' },
  { id: 'accounts', featureId: 'clients', title: 'Accounts', description: 'Client intake defaults and record fields', icon: 'people-outline', circleClass: 'bg-indigo-100 text-indigo-600' },
  { id: 'documents', featureId: 'documents', title: 'Documents', description: 'Upload limits and retention policy', icon: 'document-text-outline', circleClass: 'bg-indigo-50 text-orange-500' },
  // Cobro de facturas: proveedores de pago (Stripe/PayPal). La identidad/branding de la empresa NO
  // se duplica acá — vive en Company (arriba). Reusa el BillingStore de la feature billing.
  { id: 'invoices', featureId: 'billing', title: 'Invoices', description: 'Payment providers to collect invoices online (Stripe, PayPal…)', icon: 'card-outline', circleClass: 'bg-indigo-100 text-brand-bold', routerLink: '/settings/billing' },
  { id: 'mail', featureId: 'email', title: 'Mail', description: 'Notification emails and signatures', icon: 'mail-outline', circleClass: 'bg-indigo-100 text-indigo-600' },
  { id: 'signature', featureId: 'signature', title: 'Signature', description: 'E-signature defaults and reminders', icon: 'pencil-outline', circleClass: 'bg-indigo-50 text-orange-500' },
  { id: 'meetings', featureId: 'meetings', title: 'Meetings', description: 'Video call and scheduling preferences', icon: 'videocam-outline', circleClass: 'bg-gray-200 text-gray-700' },
  { id: 'ai', featureId: 'ai-assistant', title: 'AI', description: 'Assistant behavior and suggestion tone', icon: 'sparkles-outline', circleClass: 'bg-indigo-100 text-brand-bold' },
  { id: 'storage', featureId: 'storage', title: 'Storage', description: 'Usage breakdown, categories and shared files', icon: 'cloud-outline', circleClass: 'bg-indigo-100 text-indigo-600', routerLink: '/storage' },
  { id: 'templates', featureId: 'templates', title: 'Templates', description: 'Reusable email, letter and reminder content', icon: 'copy-outline', circleClass: 'bg-indigo-50 text-orange-500', routerLink: '/templates' },
];

/**
 * Grilla de módulos de configuración (estilo "Aether"): tarjetas internas con
 * círculo de icono pastel; el módulo seleccionado queda resaltado con un
 * borde negro. Selección 100% local vía @Output, salvo los módulos con
 * `routerLink` (ej. Storage), que navegan a su propia página en vez de abrir
 * un panel de configuración local.
 */
@Component({
  selector: 'app-settings-module-grid',
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './settings-module-grid.component.html',
})
export class SettingsModuleGridComponent {
  private readonly access = inject(AccessStore);

  @Input() selectedId = 'overview';
  @Output() moduleSelected = new EventEmitter<string>();

  /**
   * Solo las tarjetas de módulos que el usuario tiene. Configurar la firma sin poder verla, o
   * abrir Storage para recibir un 403, no es configuración: es una puerta pintada en la pared.
   */
  readonly modules = computed(() => SETTINGS_MODULES.filter(module => this.access.canUseId(module.featureId)));
}
