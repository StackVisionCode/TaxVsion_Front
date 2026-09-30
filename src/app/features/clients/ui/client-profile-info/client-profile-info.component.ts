import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';
import { ClientEditSection } from '../../data-access/client-section-edit.model';

/**
 * Tab "Info" del perfil de cliente: grilla de dos columnas con tarjetas de
 * contacto, detalle personal (individual) o de negocio (company) con el
 * identificador fiscal enmascarado + reveal auditado. Cada tarjeta es editable:
 * `edit` emite la SECCIÓN (contact/personal/business) para que el contenedor abra el modal
 * específico de esa tarjeta; `editFiscal` abre el perfil fiscal.
 * El cónyuge y los dependientes viven en `app-client-profile-family`, debajo.
 * Presentacional puro — el HTTP lo dispara el contenedor (`client-profile-page`).
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
  /** true = el usuario puede crear/editar el perfil fiscal (customers.manage + admin). */
  @Input() canEditFiscal = false;
  /** `customers.manage`: sin él, los lápices de editar no se muestran (el backend da 403). */
  @Input() canManage = false;
  /** `customers.fiscalprofile.reveal`: permiso PROPIO, no alcanza con poder editar al cliente. */
  @Input() canReveal = false;

  @Output() revealTaxId = new EventEmitter<string>();
  @Output() editFiscal = new EventEmitter<void>();
  /** Editar UNA sección del cliente: cada tarjeta abre su propio modal con solo sus campos. */
  @Output() edit = new EventEmitter<ClientEditSection>();
  /** Volver a enmascarar el identificador revelado. */
  @Output() hideTaxId = new EventEmitter<void>();

  /** Confirmación de un paso antes de revelar: el reveal queda registrado en el backend. */
  readonly confirmingReveal = signal(false);

  requestReveal(): void {
    this.confirmingReveal.set(true);
  }

  cancelReveal(): void {
    this.confirmingReveal.set(false);
  }

  doReveal(customerId: string): void {
    this.confirmingReveal.set(false);
    this.revealTaxId.emit(customerId);
  }

  formatDate(iso: string | undefined): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
}
