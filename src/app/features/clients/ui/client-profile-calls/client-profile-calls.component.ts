import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';

/**
 * Pestaña "Calls" del perfil de cliente — VACÍA A PROPÓSITO, no es un olvido.
 *
 * ⚠️ **El registro de llamadas del backend no se puede filtrar por cliente.** Matiz
 * importante: sí existe un servicio de llamadas — el Communication service (Node) expone
 * `GET /communication/calls` — pero son llamadas WebRTC IN-APP y no sirven acá por dos
 * motivos independientes:
 *
 *  1. La llamada (`Call`) no tiene `CustomerId`: sus participantes son `CallerUserId` /
 *     `CalleeUserId`, que son UserIds de Auth (usuarios de la oficina). El único puente
 *     posible sería la proyección `CustomerPortalAccount` (CustomerId → UserId del
 *     portal), que NINGÚN endpoint expone.
 *  2. El historial es siempre "MIS llamadas": el query solo acepta `page`/`size` y el
 *     handler fuerza `userId` = el del JWT, así que ni siquiera se pueden ver las
 *     llamadas de otro usuario de la oficina, mucho menos filtrar por cliente.
 *
 * Tampoco hay telefonía PSTN/CDR: Twilio está integrado solo como proveedor de SMS.
 *
 * Antes esta pestaña pintaba un mock estático con NOMBRES de participantes inventados
 * (Maria Chen, David Ruiz), duraciones, estados y stats agregadas, todo bajo el nombre de
 * un cliente REAL traído de GET /customers/{id}. Se retiró por completo.
 *
 * Para completarla el backend necesita: `CustomerId` en `Call` (o exponer el puente
 * CustomerPortalAccount) y un historial filtrable, del estilo
 * `GET /communication/calls?customerId=...` o `/communication/customers/{id}/calls`.
 */
@Component({
  selector: 'app-client-profile-calls',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-calls.component.html',
})
export class ClientProfileCallsComponent {
  /** Se conserva el binding del padre para el día en que las llamadas lleven `customerId`. */
  @Input() clientId = '';
}
