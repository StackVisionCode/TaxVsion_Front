import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { DocumentsStore } from '../../data-access/documents.store';
import { DocumentsPageComponent } from '../documents-page/documents-page.component';

/**
 * Gestor documental de UN cliente para la pestaña Documents del perfil (`features/clients`).
 * Reusa `DocumentsPageComponent` en modo embebido con su propia instancia de `DocumentsStore`
 * (patrón `@core/customers/embedded-customer`).
 */
@Component({
  selector: 'app-client-documents-workspace',
  imports: [DocumentsPageComponent],
  providers: [EmbeddedCustomerContext, DocumentsStore],
  host: { class: 'flex min-h-[34rem] flex-col' },
  template: `<app-documents-page />`,
})
export class ClientDocumentsWorkspaceComponent extends EmbeddedCustomerHost {}
