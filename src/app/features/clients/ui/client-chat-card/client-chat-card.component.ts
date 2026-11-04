import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { ClientChatService } from '../../data-access/client-chat.service';
import { ClosedChatMessage, ClosedClientChat } from '../../data-access/client-chat.model';

/**
 * `loading`  — resolviendo el directorio.
 * `chattable` — el cliente tiene portal activo (`portalUserId`) → se puede iniciar chat 1:1.
 * `not-activated` — el cliente no está en el directorio chateable (sin portal) → invitar.
 * `no-access` — el directorio respondió 403 (sin permiso de chat) → la tarjeta se oculta.
 */
type ChatCardState = 'loading' | 'chattable' | 'not-activated' | 'no-access';

/**
 * Tarjeta "Chat" del tab Communication del perfil. Complementa el log de email (solo lectura) con
 * la mensajería en vivo del CRM: dice si el cliente es chateable — lo determina la ÚNICA fuente real,
 * `POST /communication/directory/customers/search` (trae `portalUserId`) — y abre el chat con deep-link.
 *
 * "Open chat" navega a `/chat` con `?startCustomer&startUser&name`; la página de chat, una vez
 * conectado el socket, inicia (o reabre) el 1:1 con ese cliente. Si el cliente no tiene portal, no
 * es chateable y la tarjeta remite a la pestaña Access para invitarlo. Sin permiso de chat el
 * directorio da 403 y la tarjeta no se muestra (no afirma un estado que no puede verificar).
 */
@Component({
  selector: 'app-client-chat-card',
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-chat-card.component.html',
})
export class ClientChatCardComponent implements OnChanges {
  @Input() customerId = '';
  @Input() email = '';
  @Input() displayName = '';

  private readonly chat = inject(ClientChatService);
  private readonly router = inject(Router);

  readonly state = signal<ChatCardState>('loading');
  private portalUserId: string | null = null;

  /** Chats cerrados porque su preparador ya no está en la oficina (historial en solo lectura). */
  readonly closedChats = signal<ClosedClientChat[]>([]);
  readonly viewing = signal<ClosedClientChat | null>(null);
  readonly messages = signal<ClosedChatMessage[]>([]);
  readonly messagesLoading = signal(false);
  readonly messagesFailed = signal(false);
  private nextBefore: string | null = null;
  readonly hasEarlier = signal(false);

  ngOnChanges(): void {
    if (this.customerId) {
      this.resolve();
      this.loadClosedChats();
    }
  }

  private loadClosedChats(): void {
    this.chat.listClosedChats(this.customerId).subscribe({
      next: page => this.closedChats.set(page.items ?? []),
      // Sin permiso o sin datos: la sección simplemente no aparece.
      error: () => this.closedChats.set([]),
    });
  }

  openClosedChat(chat: ClosedClientChat): void {
    this.viewing.set(chat);
    this.messages.set([]);
    this.nextBefore = null;
    this.loadMessages();
  }

  closeViewer(): void {
    this.viewing.set(null);
  }

  /** Trae la página anterior; el modal muestra de lo más viejo a lo más nuevo. */
  loadMessages(): void {
    const chat = this.viewing();
    if (!chat || this.messagesLoading()) {
      return;
    }
    this.messagesLoading.set(true);
    this.messagesFailed.set(false);
    this.chat.getMessages(chat.conversationId, this.nextBefore).subscribe({
      next: page => {
        const older = [...(page.items ?? [])].reverse();
        this.messages.update(current => [...older, ...current]);
        this.nextBefore = page.nextBeforeUtc;
        this.hasEarlier.set(!!page.nextBeforeUtc);
        this.messagesLoading.set(false);
      },
      error: () => {
        this.messagesFailed.set(true);
        this.messagesLoading.set(false);
      },
    });
  }

  date(iso: string | null): string {
    const parsed = parseUtcDateOrNull(iso);
    return parsed ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  time(iso: string): string {
    const parsed = parseUtcDateOrNull(iso);
    return parsed
      ? parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
  }

  firstName(): string {
    return this.displayName.trim().split(/\s+/)[0] || this.displayName;
  }

  private resolve(): void {
    // El directorio busca por texto: el email es el término más selectivo; cae al nombre si no hay.
    const term = (this.email || this.displayName).trim();
    if (!term) {
      this.state.set('not-activated');
      return;
    }
    this.state.set('loading');
    this.chat.searchCustomers(term, 25).subscribe({
      next: results => {
        const entry = results.find(candidate => candidate.customerId === this.customerId);
        if (entry?.portalUserId) {
          this.portalUserId = entry.portalUserId;
          this.state.set('chattable');
        } else {
          this.portalUserId = null;
          this.state.set('not-activated');
        }
      },
      error: () => this.state.set('no-access'),
    });
  }

  openChat(): void {
    if (!this.portalUserId) {
      return;
    }
    void this.router.navigate(['/chat'], {
      queryParams: {
        startCustomer: this.customerId,
        startUser: this.portalUserId,
        name: this.displayName,
      },
    });
  }
}
