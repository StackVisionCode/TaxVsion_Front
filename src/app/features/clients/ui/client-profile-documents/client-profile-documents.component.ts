import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';

/**
 * Pestaña "Documents" del perfil de cliente — VACÍA A PROPÓSITO, no es un olvido.
 *
 * ⚠️ **CloudStorage no ofrece un listado de archivos filtrable por cliente.** Matiz
 * importante, porque el dato de propiedad SÍ existe: el archivo guarda
 * `OwnerType`/`OwnerId` y `OwnerType` incluye `Customer`. Lo que falta es poder
 * consultarlo:
 *
 *  - `GET /storage/files` solo acepta `skip`/`take` (1..100). Es una lista PLANA de TODO
 *    el tenant ordenada por `CreatedAtUtc DESC`, sin filtro por cliente ni por carpeta.
 *    Un empleado sí ve ahí los archivos con `OwnerType == Customer`, pero para juntar los
 *    de UN cliente habría que paginar el corpus entero del tenant hasta el archivo más
 *    viejo. Eso no escala y, peor, es ENGAÑOSO: cualquier total o paginación que se
 *    pintara sería el de una muestra parcial presentada como "sus documentos".
 *  - El listado por carpeta sí acepta `ownerType`/`ownerId`, pero exige un `folderId`
 *    concreto y no existe ninguna convención de "carpeta de este cliente" que el front
 *    pueda resolver, así que no cubre "todos los documentos del cliente".
 *  - `OwnerType`/`OwnerId` se toman del body de la subida y nadie valida que el `OwnerId`
 *    sea un Customer real, así que hoy tampoco serían una fuente fiable.
 *  - Los share links (`RecipientCustomerId`) significan "compartido CON este cliente", una
 *    semántica distinta de "documentos DE este cliente"; usarlos como si fueran lo mismo
 *    sería inventar una relación que no existe.
 *
 * Antes esta pestaña pintaba un mock estático (2025_Individual_Tax_Return.pdf,
 * W2_Employer_Copy.pdf, tamaños y fechas…) bajo el nombre de un cliente REAL traído de
 * GET /customers/{id}. Se retiró por completo.
 *
 * Para completarla el backend necesita: un filtro por propietario en el listado plano
 * (`GET /storage/files?ownerType=Customer&ownerId=...`, o
 * `GET /storage/customers/{customerId}/files`) y validar que ese `OwnerId` es un Customer.
 */
@Component({
  selector: 'app-client-profile-documents',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-documents.component.html',
})
export class ClientProfileDocumentsComponent {
  /** Se conserva el binding del padre para el día en que CloudStorage vincule archivo→cliente. */
  @Input() clientId = '';
}
