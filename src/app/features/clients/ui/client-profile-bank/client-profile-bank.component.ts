import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';

/**
 * Pestaña "Bank" del perfil de cliente — VACÍA A PROPÓSITO, no es un olvido.
 *
 * ⚠️ **No existe ningún servicio de extractos bancarios en el backend.** No hay
 * endpoints de cuentas bancarias, extractos ni parseo de PDFs bancarios, ni por cliente
 * ni por tenant.
 *
 * Antes esta pestaña pintaba un mock estático con ENTIDADES BANCARIAS reales y números de
 * cuenta enmascarados inventados (Chase Business •••1234, Bank of America •••9087, Wells
 * Fargo •••5521) más periodos de extracto, todo bajo el nombre de un cliente REAL traído
 * de GET /customers/{id}. Encima el alta/borrado eran locales: el usuario podía "subir" y
 * "borrar" extractos que nunca salían del navegador. Se retiró por completo.
 *
 * Para completarla el backend necesita un servicio de banking: cuentas/extractos por
 * cliente, subida del PDF (probablemente apoyada en CloudStorage) y el listado
 * `GET /banking/customers/{customerId}/statements`.
 *
 * Nota: el único dato bancario que el backend SÍ guarda hoy es el de reembolso del
 * `FiscalProfile` (`refundBankAccount` / `refundBankRouting`, PUT
 * /customers/{id}/fiscal-profile), que es otra cosa — un destino de reembolso, no un
 * historial de extractos — y no da pie a listar nada acá.
 */
@Component({
  selector: 'app-client-profile-bank',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-bank.component.html',
})
export class ClientProfileBankComponent {
  /** Se conserva el binding del padre para el día en que exista el servicio de banking. */
  @Input() clientId = '';
}
