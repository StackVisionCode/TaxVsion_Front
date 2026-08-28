import { Component, inject, input, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { TenantBrandingService } from './tenant-branding.service';

/**
 * Marca reutilizable para las páginas de auth (login, reset/new password, MFA, etc.): muestra el logo
 * del tenant, o el del SISTEMA por cascada, y solo si no viene NINGUNO cae al asterisco. Aplica la
 * marca al construirse (applyForSurface → sistema si no hay subdominio), así funciona en páginas
 * alcanzadas directo por enlace de correo sin que cada componente tenga que cablearla. `logoClass` y
 * `fallbackClass` permiten ajustar el tamaño/color según dónde se use (hero oscuro vs formulario claro).
 */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  imports: [NgIf],
  template: `
    <img
      *ngIf="branding.logoUrl() && !failed(); else fallback"
      [src]="branding.logoUrl()"
      alt="Logo"
      [class]="logoClass()"
      (error)="failed.set(true)"
    />
    <ng-template #fallback>
      <span [class]="fallbackClass()">*</span>
    </ng-template>
  `,
})
export class BrandLogoComponent {
  readonly branding = inject(TenantBrandingService);
  readonly failed = signal(false);

  readonly logoClass = input('h-9 max-w-[160px] object-contain');
  readonly fallbackClass = input('text-indigo-600 text-3xl font-bold leading-none');

  constructor() {
    // La marca del tenant (por subdominio) o la del sistema (sin subdominio). Idempotente y con
    // fallback total: si falla, queda el look por defecto y se muestra el asterisco.
    this.branding.applyForSurface('Crm');
  }
}
