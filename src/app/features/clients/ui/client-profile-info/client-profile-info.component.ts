import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';

/**
 * Tab "Info" del perfil de cliente: grilla de dos columnas con tarjetas de
 * contacto (direcciones reales), detalle personal (individual) o de negocio
 * (company) con el identificador fiscal enmascarado + reveal auditado,
 * dependientes y cónyuge (derivados de `relations[]`). Presentacional puro —
 * el HTTP del reveal lo dispara el contenedor (`client-profile-page`).
 */
@Component({
  selector: 'app-client-profile-info',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-info.component.html',
})
export class ClientProfileInfoComponent {
  @Input() client!: ClientProfile;
  @Input() revealedTaxId: string | null = null;
  @Input() revealingTaxId = false;

  @Output() revealTaxId = new EventEmitter<string>();

  formatDate(iso: string | undefined): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
}
