import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { MailStore } from '../../data-access/mail.store';
import { MailPageComponent } from '../mail-page/mail-page.component';

/**
 * Correo de UN cliente para la pestaña Mail del perfil (`features/clients`).
 * Reusa `MailPageComponent` en modo embebido con su propia instancia de `MailStore`
 * (patrón `@core/customers/embedded-customer`): cliente fijo, sin picker ni conexión OAuth.
 */
@Component({
  selector: 'app-client-mail-workspace',
  imports: [MailPageComponent],
  providers: [EmbeddedCustomerContext, MailStore],
  host: { class: 'flex min-h-[36rem] flex-col' },
  template: `<app-mail-page />`,
})
export class ClientMailWorkspaceComponent extends EmbeddedCustomerHost {}
