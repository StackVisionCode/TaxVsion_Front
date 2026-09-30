import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { WorkspaceLink } from '../../data-access/client-workspace-links';

/**
 * Pestaña "Signatures" del perfil de cliente.
 *
 * ⚠️ El listado por cliente está BLOQUEADO por el backend (verificado en origin/Develop):
 * `GET /signature/requests` solo acepta `status|category|page|size|editableOnly` — ningún filtro
 * por cliente — y su fila (`SignatureRequestSummary`) trae `signerCount`, no los firmantes ni su
 * `customerId`. Filtrar en el front obligaría a pedir el detalle de CADA solicitud del tenant.
 * Falta `customerId` como filtro (o `GET /signature/customers/{id}/requests`).
 *
 * Lo que SÍ es real y se ofrece: crear una solicitud con el cliente precargado (deep link al wizard
 * de Signature) y el acceso a los documentos firmados — cuando hay exactamente un firmante mapeado
 * a este cliente, el PDF sellado y su certificado se guardan en SU carpeta de Documents
 * (`SealedDocumentOwner`, "Signed Documents").
 */
@Component({
  selector: 'app-client-profile-signatures',
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-signatures.component.html',
})
export class ClientProfileSignaturesComponent {
  @Input() clientName = '';
  /** null = sin permiso para crear solicitudes. */
  @Input() newRequestLink: WorkspaceLink | null = null;
  /** Puede entrar a la página de Signature (permiso de lectura). */
  @Input() canOpenSignatures = false;
  /** Puede ver la pestaña Documents del cliente. */
  @Input() canViewDocuments = false;

  /** Ir a la pestaña Documents (donde quedan los documentos firmados). */
  @Output() viewDocuments = new EventEmitter<void>();
}
