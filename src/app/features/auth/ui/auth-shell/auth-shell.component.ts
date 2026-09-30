import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';

/**
 * Tarjeta flotante de las pantallas públicas sin sesión (aceptar invitación, confirmar email): fondo
 * indigo con dos orbes difuminados, panel de marca en gradiente a la izquierda y el contenido
 * proyectado a la derecha.
 */
@Component({
  selector: 'app-auth-shell',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './auth-shell.component.html',
  styleUrl: './auth-shell.component.css',
})
export class AuthShellComponent {
  @Input() panelEyebrow = 'Join TaxPro Office';
  @Input() panelHeading = 'Create your account and run your tax firm from one place';

  /** Logo de la oficina (lo resuelve el branding disparado por la página/contenido); si no hay, cae al `*`. */
  private readonly branding = inject(TenantBrandingService);
  readonly logoUrl = this.branding.logoUrl;
  readonly logoFailed = signal(false);
}
