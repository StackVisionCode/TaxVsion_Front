import { Component, Input, computed, signal } from '@angular/core';
import { DocumentsStore } from '../../data-access/documents.store';
import { DocumentsPageComponent, EmbeddedDocumentsClient } from '../documents-page/documents-page.component';

/**
 * Gestor documental de UN cliente para la pestaña Documents del perfil (`features/clients`).
 *
 * Reusa `DocumentsPageComponent` en modo embebido (mismo diseño y acciones que /documents, fijo al
 * workspace del cliente). Provee su PROPIA instancia de `DocumentsStore`: así navegar carpetas
 * aquí no pisa el estado de la página /documents (el store raíz) ni al revés.
 *
 * Excepción documentada a "una feature no importa de otra": el perfil del cliente monta este
 * componente con `@defer`, que lo separa en su propio chunk.
 */
@Component({
  selector: 'app-client-documents-workspace',
  imports: [DocumentsPageComponent],
  providers: [DocumentsStore],
  host: { class: 'flex min-h-[34rem] flex-col' },
  template: `<app-documents-page [embeddedClient]="client()" />`,
})
export class ClientDocumentsWorkspaceComponent {
  private readonly _id = signal('');
  private readonly _name = signal('');

  @Input({ required: true }) set clientId(value: string) {
    this._id.set(value);
  }
  @Input() set clientName(value: string) {
    this._name.set(value);
  }

  readonly client = computed<EmbeddedDocumentsClient | null>(() =>
    this._id() ? { id: this._id(), name: this._name() || 'Client' } : null,
  );
}
