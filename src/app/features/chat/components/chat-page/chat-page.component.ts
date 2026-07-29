import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatConversationListComponent } from '../../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatThreadComponent, ChatMessage } from '../../ui/chat-thread/chat-thread.component';
import { ChatComposerComponent } from '../../ui/chat-composer/chat-composer.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ChatStore } from '../../data-access/chat.store';

/**
 * Página del módulo Chat (estilo "Aether"): mensajería interna de equipo,
 * no el AI Assistant. Rail de conversaciones a la izquierda + hilo activo a
 * la derecha. Datos reales vía ChatStore (Communication: lista/historial
 * por HTTP, enviar/recibir en vivo por Socket.IO) — deja fuera de esta
 * conexión: crear conversación nueva (esta UI no tiene ese botón todavía),
 * adjuntos reales, reacciones, editar/borrar, y video-llamadas (fuera de
 * alcance del feature).
 */
@Component({
  selector: 'app-chat-page',
  imports: [CommonModule, ChatConversationListComponent, ChatThreadComponent, ChatComposerComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent {
  private readonly store = inject(ChatStore);

  readonly conversations = this.store.conversations;
  readonly loading = this.store.loading;
  readonly loadError = this.store.error;
  readonly activeConversationId = computed(() => this.store.activeConversationId() ?? '');

  readonly isInfoOpen = signal(false);

  constructor() {
    this.store.load();
  }

  get activeConversation() {
    return (
      this.conversations().find(conv => conv.id === this.store.activeConversationId()) ?? {
        id: '',
        name: '',
        avatarColor: 'bg-gray-900',
        online: false,
        unread: 0,
        messages: [] as ChatMessage[],
      }
    );
  }

  get sharedAttachments(): { name: string; size: string }[] {
    return this.activeConversation.messages
      .filter((message): message is ChatMessage & { attachment: { name: string; size: string } } => !!message.attachment)
      .map(message => message.attachment);
  }

  openInfo(): void {
    this.isInfoOpen.set(true);
  }

  closeInfo(): void {
    this.isInfoOpen.set(false);
  }

  selectConversation(id: string): void {
    this.store.selectConversation(id);
  }

  sendMessage(text: string): void {
    void this.store.sendMessage(text);
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }
}
