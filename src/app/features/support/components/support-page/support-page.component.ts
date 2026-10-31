import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, ElementRef, OnDestroy, OnInit, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ChatStore } from '@features/chat/data-access/chat.store';
import { ChatConversationPanelComponent } from '@features/chat/components/conversation-panel/conversation-panel.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { fillViewportHeight } from '@shared/utils/fill-viewport-height';
import { SupportStore } from '../../data-access/support.store';
import { SupportTicket, canReopenTicket } from '../../data-access/support.model';
import { SupportContactOptionsComponent } from '../../ui/support-contact-options/support-contact-options.component';
import { SupportFaqComponent } from '../../ui/support-faq/support-faq.component';
import { SupportTicketFormComponent } from '../../ui/support-ticket-form/support-ticket-form.component';
import { SupportTicketListComponent } from '../../ui/support-ticket-list/support-ticket-list.component';
import { SUPPORT_STATUS_META } from '../../ui/support-status';

/** Alto mínimo usable de la bandeja (móvil apaisado): por debajo se deja scrollear la página. */
const MIN_INBOX_HEIGHT = 420;

/**
 * Bandeja de Support en dos paneles (como Chat): a la izquierda los tickets con sus no leídos, a la derecha el chat
 * del ticket elegido (motor del chat, D-12; solo lectura si se cerró, D-13) o, sin ticket, cómo funciona y el FAQ.
 * Por debajo de `lg` se ve un panel a la vez. Abrir un ticket lo da por leído y baja la burbuja del menú.
 */
@Component({
  selector: 'app-support-page',
  imports: [
    CommonModule,
    SupportContactOptionsComponent,
    SupportFaqComponent,
    SupportTicketFormComponent,
    SupportTicketListComponent,
    ChatConversationPanelComponent,
    StatusPillComponent,
    ModalComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-page.component.html',
  host: { class: 'flex flex-col', '[style.height.px]': 'fillHeight()' },
})
export class SupportPageComponent implements OnInit, OnDestroy {
  protected readonly store = inject(SupportStore);
  protected readonly chat = inject(ChatStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private openedConversationId: string | null = null;

  readonly fillHeight = fillViewportHeight(this.host, this.destroyRef, MIN_INBOX_HEIGHT);

  /** El ticket elegido abre (o cambia) su chat embebido; deseleccionarlo lo saca del motor del chat. */
  private readonly embedEffect = effect(() => {
    const ticket = this.store.selectedTicket();
    untracked(() => {
      if (this.openedConversationId && this.openedConversationId !== ticket?.conversationId) {
        this.chat.closeEmbedded(this.openedConversationId);
        this.openedConversationId = null;
      }
      if (ticket && this.openedConversationId !== ticket.conversationId) {
        this.chat.openEmbedded(ticket.conversationId, ticket.subject);
        this.openedConversationId = ticket.conversationId;
      }
    });
  });

  ngOnInit(): void {
    this.store.loadTickets();
    this.store.ticketCreated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ ticketId }) => this.store.selectTicketById(ticketId, unread => this.chat.noteSupportRead(unread)));
    // Mensajes de tickets en vivo: vista previa y no leídos de su fila.
    this.chat.supportActivity$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(activity => this.store.applyActivity(activity));
    // Deep link `?ticket=` (desde una notificación o desde /chat?conversation= de un ticket).
    const ticketId = this.route.snapshot.queryParamMap.get('ticket');
    if (ticketId) this.store.selectTicketById(ticketId, unread => this.chat.noteSupportRead(unread));
  }

  ngOnDestroy(): void {
    if (this.openedConversationId) this.chat.closeEmbedded(this.openedConversationId);
    this.store.selectTicket(null);
  }

  openTicket(ticket: SupportTicket): void {
    this.chat.noteSupportRead(this.store.selectTicket(ticket));
  }

  backToList(): void {
    this.store.selectTicket(null);
  }

  canReopen(ticket: SupportTicket): boolean {
    return canReopenTicket(ticket);
  }

  statusLabel(ticket: SupportTicket): string {
    return SUPPORT_STATUS_META[ticket.status].label;
  }

  statusPillClass(ticket: SupportTicket): string {
    return SUPPORT_STATUS_META[ticket.status].pillClass;
  }
}
