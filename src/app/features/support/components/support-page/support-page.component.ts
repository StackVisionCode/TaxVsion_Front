import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SupportStore } from '../../data-access/support.store';
import { SupportTicket } from '../../data-access/support.model';
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.store.loadTickets(1);
    // Flujo pedido: al abrir un ticket, saltar a su conversación en vivo (reusa el motor de chat).
    this.store.ticketCreated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId }) => this.openConversation(conversationId));
  }

  /** Abre (deep-link) la conversación de un ticket en el chat. */
  onOpenConversation(ticket: SupportTicket): void {
    this.openConversation(ticket.conversationId);
  }

  private openConversation(conversationId: string): void {
    void this.router.navigate(['/chat'], { queryParams: { conversation: conversationId } });
  }
}
