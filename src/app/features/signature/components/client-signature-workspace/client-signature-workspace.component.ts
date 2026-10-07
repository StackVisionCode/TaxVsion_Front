import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { SignatureStore } from '../../data-access/signature.store';
import { SignaturePageComponent } from '../signature-page/signature-page.component';

/**
 * Firmas de UN cliente para la pestaña Signatures del perfil (`features/clients`).
 * Reusa `SignaturePageComponent` en modo embebido con su propia instancia de `SignatureStore`
 * (listado filtrado por `customerId`; patrón `@core/customers/embedded-customer`).
 */
@Component({
  selector: 'app-client-signature-workspace',
  imports: [SignaturePageComponent],
  providers: [EmbeddedCustomerContext, SignatureStore],
  host: { class: 'flex flex-col' },
  template: `<app-signature-page />`,
})
export class ClientSignatureWorkspaceComponent extends EmbeddedCustomerHost {}
