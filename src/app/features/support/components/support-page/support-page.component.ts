import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportStore } from '../../data-access/support.store';
import { SupportContactOptionsComponent } from '../../ui/support-contact-options/support-contact-options.component';
import { SupportFaqComponent } from '../../ui/support-faq/support-faq.component';
import { SupportTicketFormComponent } from '../../ui/support-ticket-form/support-ticket-form.component';
import { SupportTicketListComponent } from '../../ui/support-ticket-list/support-ticket-list.component';

/**
 * Página del módulo Support (estilo "Aether"). Contenedor smart: único punto
 * que inyecta SupportStore. Opciones de contacto y FAQ siguen estáticos; el
 * formulario de tickets y la lista "My tickets" van contra Communication
 * (`/communication/support`) vía el store, con datos bajando por inputs.
 */
@Component({
  selector: 'app-support-page',
  imports: [
    CommonModule,
    SupportContactOptionsComponent,
    SupportFaqComponent,
    SupportTicketFormComponent,
    SupportTicketListComponent,
  ],
  templateUrl: './support-page.component.html',
})
export class SupportPageComponent implements OnInit {
  protected readonly store = inject(SupportStore);

  ngOnInit(): void {
    this.store.loadTickets(1);
  }
}
