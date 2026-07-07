import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

export interface SettingsModule {
  id: string;
  title: string;
  description: string;
  icon: string;
  circleClass: string;
  /** Si está presente, la tarjeta navega a esta ruta en vez de seleccionar un panel local. */
  routerLink?: string;
}

export const SETTINGS_MODULES: SettingsModule[] = [
  { id: 'overview', title: 'Overview', description: 'Firm name, logo and general preferences', icon: 'grid-outline', circleClass: 'bg-[#DCDCDC] text-gray-700' },
  { id: 'accounts', title: 'Accounts', description: 'Client intake defaults and record fields', icon: 'people-outline', circleClass: 'bg-[#CBD9F2] text-indigo-600' },
  { id: 'documents', title: 'Documents', description: 'Upload limits and retention policy', icon: 'document-text-outline', circleClass: 'bg-[#F2E3C9] text-orange-500' },
  { id: 'invoices', title: 'Invoices', description: 'Currency, taxes and payment reminders', icon: 'receipt-outline', circleClass: 'bg-[#EEEBFA] text-[#7C6AE0]' },
  { id: 'mail', title: 'Mail', description: 'Notification emails and signatures', icon: 'mail-outline', circleClass: 'bg-[#CBD9F2] text-indigo-600' },
  { id: 'signature', title: 'Signature', description: 'E-signature defaults and reminders', icon: 'pencil-outline', circleClass: 'bg-[#F2E3C9] text-orange-500' },
  { id: 'meetings', title: 'Meetings', description: 'Video call and scheduling preferences', icon: 'videocam-outline', circleClass: 'bg-[#DCDCDC] text-gray-700' },
  { id: 'ai', title: 'AI', description: 'Assistant behavior and suggestion tone', icon: 'sparkles-outline', circleClass: 'bg-[#EEEBFA] text-[#7C6AE0]' },
  { id: 'storage', title: 'Storage', description: 'Usage breakdown, categories and shared files', icon: 'cloud-outline', circleClass: 'bg-[#CBD9F2] text-indigo-600', routerLink: '/storage' },
  { id: 'templates', title: 'Templates', description: 'Reusable email, letter and reminder content', icon: 'copy-outline', circleClass: 'bg-[#F2E3C9] text-orange-500', routerLink: '/templates' },
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
  @Input() selectedId = 'overview';
  @Output() moduleSelected = new EventEmitter<string>();

  readonly modules = SETTINGS_MODULES;
}
