import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingsPageComponent } from '../meetings-page/meetings-page.component';

/**
 * Reuniones de UN cliente para la pestaña Meetings del perfil (`features/clients`).
 * Reusa `MeetingsPageComponent` en modo embebido con su propia instancia de `MeetingsStore`
 * (patrón `@core/customers/embedded-customer`).
 */
@Component({
  selector: 'app-client-meetings-workspace',
  imports: [MeetingsPageComponent],
  providers: [EmbeddedCustomerContext, MeetingsStore],
  host: { class: 'flex flex-col' },
  template: `<app-meetings-page />`,
})
export class ClientMeetingsWorkspaceComponent extends EmbeddedCustomerHost {}
