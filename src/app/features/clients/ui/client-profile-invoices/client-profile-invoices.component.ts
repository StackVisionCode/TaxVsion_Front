import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';

/**
 * Pestaña "Invoices" del perfil de cliente — VACÍA A PROPÓSITO, no es un olvido.
 *
 * ⚠️ **Billing no permite listar las facturas de UN cliente.** El único listado del
 * servicio es `GET /billing/invoices`, que solo acepta `take` (ni filtro por customer, ni
 * paginación por cliente), y su fila (`InvoiceSummaryResponse`) NO incluye `customerId`
 * ni el nombre del cliente, así que tampoco se puede filtrar en el front después de
 * traerlas: no hay forma de decidir cuáles de esas facturas son de este cliente.
 *
 * El dato SÍ existe en el dominio — la factura guarda un `CustomerSnapshot` con su
 * `CustomerId` al crearse — pero nunca se proyecta a la respuesta, y el repositorio solo
 * tiene `ListByTenantAsync(tenantId, take)`. Es decir: falta exponerlo, no capturarlo.
 *
 * Antes esta pestaña pintaba un mock estático (INV-2026-0141, $1,850, totales facturado /
 * pendiente…) bajo el nombre de un cliente REAL traído de GET /customers/{id}. Eso es
 * peor que no mostrar nada: mezcla ficción con datos verdaderos. Se retiró por completo.
 *
 * Para completarla el backend necesita: `customerId` en `InvoiceSummaryResponse` y un
 * filtro `GET /billing/invoices?customerId=...` (o `GET /billing/customers/{id}/invoices`).
 * Los totales (facturado / pendiente) salen solos de ese listado.
 */
@Component({
  selector: 'app-client-profile-invoices',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-invoices.component.html',
})
export class ClientProfileInvoicesComponent {
  /** Se conserva el binding del padre para el día en que Billing exponga el filtro por cliente. */
  @Input() clientId = '';
}
