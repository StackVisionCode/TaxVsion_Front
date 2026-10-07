import { Component } from '@angular/core';
import { EmbeddedCustomerContext, EmbeddedCustomerHost } from '@core/customers/embedded-customer';
import { TaskStore } from '../../data-access/task.store';
import { TaskPageComponent } from '../task-page/task-page.component';

/**
 * Tareas de UN cliente para la pestaña Tasks del perfil (`features/clients`).
 * Reusa `TaskPageComponent` (board/list/calendar, filtros, crear, drawer) en modo embebido con su
 * propia instancia de `TaskStore` fijada al cliente (patrón `@core/customers/embedded-customer`);
 * la instancia root del store (dashboard, /task) no se toca.
 */
@Component({
  selector: 'app-client-task-workspace',
  imports: [TaskPageComponent],
  providers: [EmbeddedCustomerContext, TaskStore],
  host: { class: 'flex flex-col' },
  template: `<app-task-page />`,
})
export class ClientTaskWorkspaceComponent extends EmbeddedCustomerHost {}
