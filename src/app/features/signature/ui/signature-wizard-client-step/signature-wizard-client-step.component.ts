import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';
import { avatarColor, clientTypeBadge, initialsOf } from '../signature-request-panel/signature-wizard.presenter';

/**
 * Paso 1 del wizard: muestra el cliente elegido (tarjeta de resumen) o un estado
 * vacío con acceso rápido a los recientes. La búsqueda vive en un modal aparte
 * (`app-signature-client-picker`), montado en la raíz del panel; este paso sólo
 * pinta y pide "abrir buscador" / "elegir reciente" hacia arriba.
 */
@Component({
  selector: 'app-signature-wizard-client-step',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-client-step.component.html',
  styleUrl: './signature-wizard-client-step.component.css',
})
export class SignatureWizardClientStepComponent {
  @Input() selected: WizardClient | null = null;
  @Input() recent: WizardClient[] = [];
  @Output() changeRequested = new EventEmitter<void>();
  @Output() recentPicked = new EventEmitter<WizardClient>();

  initials(name: string): string {
    return initialsOf(name);
  }

  /** Color de avatar estable por id (no depende del orden de la lista). */
  avatarFor(client: WizardClient): string {
    let hash = 0;
    for (const ch of client.id) {
      hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    }
    return avatarColor(Math.abs(hash));
  }

  typeBadge(client: WizardClient): string {
    return clientTypeBadge(client.type);
  }

  clientSince(client: WizardClient): string {
    return new Date(`${client.createdAt}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }

  trackClient(_index: number, client: WizardClient): string {
    return client.id;
  }

  openPicker(): void {
    this.changeRequested.emit();
  }

  pickRecent(client: WizardClient): void {
    this.recentPicked.emit(client);
  }
}
