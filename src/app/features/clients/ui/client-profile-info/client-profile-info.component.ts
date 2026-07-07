import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';

/**
 * Tab "Info" del perfil de cliente: grilla de dos columnas con tarjetas de
 * contacto, detalle personal (individual) o de negocio (company),
 * dependientes y cónyuge. Todo derivado del @Input client; sin
 * servicios/HTTP, solo formateo/masking local.
 */
@Component({
  selector: 'app-client-profile-info',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-info.component.html',
})
export class ClientProfileInfoComponent {
  @Input() client!: ClientProfile;

  maskTail(value: string | undefined, visibleDigits = 4): string {
    if (!value) {
      return '—';
    }
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length <= visibleDigits) {
      return value;
    }
    const tail = digitsOnly.slice(-visibleDigits);
    return `•••-••-${tail}`;
  }

  formatDate(iso: string | undefined): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
}
