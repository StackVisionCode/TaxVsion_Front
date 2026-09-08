import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ClientChatService } from '../../data-access/client-chat.service';

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
 * `GET /communication/directory/customers` (trae `portalUserId`) — y abre el chat con deep-link.
 *
 * "Open chat" navega a `/chat` con `?startCustomer&startUser&name`; la página de chat, una vez
 * conectado el socket, inicia (o reabre) el 1:1 con ese cliente. Si el cliente no tiene portal, no
 * es chateable y la tarjeta remite a la pestaña Access para invitarlo. Sin permiso de chat el
 * directorio da 403 y la tarjeta no se muestra (no afirma un estado que no puede verificar).
 */
@Component({
  selector: 'app-client-chat-card',
  imports: [CommonModule],
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

  ngOnChanges(): void {
    if (this.customerId) {
      this.resolve();
    }
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
