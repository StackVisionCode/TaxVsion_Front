import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { SmsStore } from '../../data-access/sms.store';
import { SmsPageComponent } from '../sms-page/sms-page.component';

/**
 * SMS de UN cliente para la pestaña SMS del perfil (`features/clients`).
 * Reusa `SmsPageComponent` en modo embebido con su propia instancia de `SmsStore`
 * (patrón `@core/customers/embedded-customer`).
 */
@Component({
  selector: 'app-client-sms-workspace',
  imports: [SmsPageComponent],
  providers: [EmbeddedCustomerContext, SmsStore],
  host: { class: 'flex flex-col' },
  template: `<app-sms-page />`,
})
export class ClientSmsWorkspaceComponent extends EmbeddedCustomerHost {}
