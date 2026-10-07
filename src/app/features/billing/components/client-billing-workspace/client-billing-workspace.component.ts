import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { BillingStore } from '../../data-access/billing.store';
import { BillingPageComponent } from '../billing-page/billing-page.component';

/**
 * Facturas de UN cliente para la pestaña Billing del perfil (`features/clients`).
 * Reusa `BillingPageComponent` en modo embebido con su propia instancia de `BillingStore`
 * (patrón `@core/customers/embedded-customer`): solo facturas, filtradas por `customerId`, y el alta
 * con el cliente ya fijado.
 */
@Component({
  selector: 'app-client-billing-workspace',
  imports: [BillingPageComponent],
  providers: [EmbeddedCustomerContext, BillingStore],
  host: { class: 'flex flex-col' },
  template: `<app-billing-page />`,
})
export class ClientBillingWorkspaceComponent extends EmbeddedCustomerHost {}
