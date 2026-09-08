import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TenantResolutionService } from '@core/auth/tenant-resolution.service';

type RequestStep = 'email' | 'sent';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Encuentra tu oficina" (mismo lenguaje visual que forgot-password/login: tarjeta
 * flotante con panel de gradiente). Para cuando el usuario no sabe el subdominio de
 * su oficina (llegó a app.taxproffice.com sin el ?office=<slug> ni sesión previa).
 *
 * Llama a POST /auth/tenant-resolution/by-email, que el backend responde SIEMPRE con
 * 202 (anti-enumeración: nunca revela si el email tiene oficina) — por eso no hay
 * manejo de "email no encontrado", solo errores de red/servidor. El backend manda por
 * correo los links de las oficinas del usuario; cada link trae ?office=<slug>, que el
 * login lee para pegarle al subdominio correcto.
 */
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

@Component({
  selector: 'app-find-office-page',
  imports: [BrandLogoComponent, CommonModule, RouterModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './find-office-page.component.html',
  styleUrl: './find-office-page.component.css',
})
export class FindOfficePageComponent {
  private readonly tenantResolution = inject(TenantResolutionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly step = signal<RequestStep>('email');
  readonly email = signal('');
  readonly formError = signal<string | null>(null);
  readonly isBusy = signal(false);

  findOffice(): void {
    const value = this.email().trim();
    if (!EMAIL_PATTERN.test(value)) {
      this.formError.set('Please enter a valid email address.');
      return;
    }
    this.formError.set(null);
    this.isBusy.set(true);
    this.tenantResolution
      .findOfficeByEmail(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isBusy.set(false);
          this.step.set('sent');
        },
        error: () => {
          this.isBusy.set(false);
          // Solo llega acá por fallo de red/servidor — el backend nunca responde
          // "email sin oficina" (anti-enumeración), así que no hay mensaje específico.
          this.formError.set('Something went wrong. Please try again in a moment.');
        },
      });
  }
}
