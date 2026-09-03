import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage } from '../chat-thread/chat-thread.component';
import {
  ConversationKind,
  PresenceBusyReason,
  PresenceStatus,
  presenceDotClass,
  presenceLabel,
} from '../../data-access/chat.model';

export interface ChatConversation {
  id: string;
  name: string;
  kind: ConversationKind;
  /** userId del par en un 1:1 (Direct/Support con 2 participantes), o null (grupo/desconocido). Para llamar. */
  peerUserId: string | null;
  avatarColor: string;
  presence: PresenceStatus;
  busyReason: PresenceBusyReason;
  /** displayName del otro participante que está escribiendo (1:1), o null. */
  typingName: string | null;
  /** id del último mensaje que el otro participante marcó como leído (para "Seen"). */
  readUpToMessageId: string | null;
  /** Hay más historial más viejo por cargar (scrollback). */
  hasMoreHistory: boolean;
  unread: number;
  messages: ChatMessage[];
}

/**
 * Rail de conversaciones del Chat de equipo (estilo "Aether"): avatar con
 * iniciales, punto de estado "online", vista previa del último mensaje,
 * hora relativa y badge de no leídos. Incluye un buscador local (píldora)
 * que filtra por nombre con un signal.
 */
@Component({
  selector: 'app-chat-conversation-list',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-conversation-list.component.html',
})
export class ChatConversationListComponent {
  @Input() conversations: ChatConversation[] = [];
  @Input() selectedId = '';
  @Output() conversationSelected = new EventEmitter<string>();

  readonly search = signal('');

  get filteredConversations(): ChatConversation[] {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.conversations;
    }
    return this.conversations.filter(conv => conv.name.toLowerCase().includes(term));
  }

  select(id: string): void {
    this.conversationSelected.emit(id);
  }

  lastMessage(conv: ChatConversation): ChatMessage | undefined {
    return conv.messages[conv.messages.length - 1];
  }

  preview(conv: ChatConversation): string {
    const last = this.lastMessage(conv);
    if (!last) {
      return 'No messages yet';
    }
    if (last.attachment) {
      return `📎 ${last.attachment.name}`;
    }
    return last.text ?? '';
  }

  /** El punto de estado solo se muestra si el otro está Online o Busy (Offline no pinta punto). */
  showPresenceDot(conv: ChatConversation): boolean {
    return conv.presence !== 'Offline';
  }

  presenceDotClass(conv: ChatConversation): string {
    return presenceDotClass(conv.presence);
  }

  presenceLabel(conv: ChatConversation): string {
    return presenceLabel(conv.presence, conv.busyReason);
  }

  lastTime(conv: ChatConversation): string {
    return this.lastMessage(conv)?.time ?? '';
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
