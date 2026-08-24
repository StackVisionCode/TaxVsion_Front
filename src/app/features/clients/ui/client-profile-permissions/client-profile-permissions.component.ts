import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';

/**
 * Pestaña "Permissions" del perfil de cliente — VACÍA A PROPÓSITO, no es un olvido.
 *
 * ⚠️ **No existe ACL de archivos por cliente en el backend.** Se apoyaba en dos cosas
 * que no hay:
 *  1. Un árbol de carpetas/archivos DE ESTE CLIENTE — CloudStorage no ofrece un listado
 *     filtrable por cliente (mismo bloqueo que la pestaña Documents: el archivo guarda
 *     `OwnerType`/`OwnerId`, pero `GET /storage/files` es una lista plana de todo el
 *     tenant con solo `skip`/`take`).
 *  2. Un juego de flags por recurso (visible / locked / upload / download / delete /
 *     create / rename) con herencia padre→hijo. Eso no existe en ningún servicio: el
 *     modelo de autorización del backend son permisos de USUARIO del tenant en el JWT
 *     (`notes.view_all`, `users.view`…), no ACLs por archivo y por cliente. Lo más
 *     parecido son los share links de CloudStorage, que son un permiso puntual sobre un
 *     archivo concreto, no una política heredable.
 *
 * Antes esta pestaña pintaba un árbol mock (Documents / Tax Returns / 2024_Return.pdf,
 * W2_2025.pdf…) con un panel de toggles que "guardaba" en memoria: el usuario creía estar
 * concediendo o revocando acceso a archivos de un cliente REAL, y no salía nada del
 * navegador. Un control de acceso falso es peor que ninguno. Se retiró por completo.
 *
 * Para completarla el backend necesita: un listado de archivos por cliente en CloudStorage
 * y un recurso de ACL por (customerId, fileId/folderId) con herencia, del estilo
 * `GET/PUT /storage/customers/{customerId}/permissions`.
 */
@Component({
  selector: 'app-client-profile-permissions',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-permissions.component.html',
})
export class ClientProfilePermissionsComponent {
  /** Se conserva el binding del padre para el día en que exista el recurso de ACL. */
  @Input() clientId = '';
}
