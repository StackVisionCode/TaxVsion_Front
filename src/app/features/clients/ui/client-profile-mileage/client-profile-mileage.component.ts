import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';

/**
 * Pestaña "Mileage" del perfil de cliente — VACÍA A PROPÓSITO, no es un olvido.
 *
 * ⚠️ **No existe ningún servicio de kilometraje en el backend.** No hay endpoints de
 * viajes, vehículos ni odómetro: nada que consultar, ni por cliente ni por tenant.
 *
 * Antes esta pestaña pintaba un mock estático especialmente peligroso: un vehículo
 * concreto (2022 Toyota Camry), una MATRÍCULA inventada (FL-7DXK21), direcciones reales
 * de Miami, un odómetro de 12.400 millas y un "Est. reimbursement" calculado con una tasa
 * IRS hardcodeada — todo bajo el nombre de un cliente REAL traído de GET /customers/{id}.
 * Un importe deducible inventado en una app de impuestos es un riesgo, no un placeholder.
 * Se retiró por completo.
 *
 * Para completarla el backend necesita un servicio de mileage: vehículos por cliente,
 * viajes (origen/destino/instantes/distancia) y el listado
 * `GET /mileage/customers/{customerId}/trips`. La tasa estándar del IRS también debería
 * venir del backend (cambia cada año fiscal), nunca hardcodeada en el front.
 */
@Component({
  selector: 'app-client-profile-mileage',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-mileage.component.html',
})
export class ClientProfileMileageComponent {
  /** Se conserva el binding del padre para el día en que exista el servicio de mileage. */
  @Input() clientId = '';
}
