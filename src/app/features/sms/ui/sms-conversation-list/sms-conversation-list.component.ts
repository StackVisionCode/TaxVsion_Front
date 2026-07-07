import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SmsMessage } from '../sms-thread/sms-thread.component';

export interface SmsConversation {
  id: string;
  contactName: string;
  phone: string;
  avatarColor: string;
  unread: number;
  messages: SmsMessage[];
}

/**
 * Rail de conversaciones del módulo SMS (estilo "Aether"): avatar con
 * iniciales, nombre del contacto, número de teléfono, vista previa del
 * último mensaje, hora relativa y badge de no leídos. Incluye un buscador
 * local (píldora) que filtra por nombre o teléfono con un signal.
 */
@Component({
  selector: 'app-sms-conversation-list',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-conversation-list.component.html',
})
export class SmsConversationListComponent {
  @Input() conversations: SmsConversation[] = [];
  @Input() selectedId = '';
  @Output() conversationSelected = new EventEmitter<string>();

  readonly search = signal('');

  get filteredConversations(): SmsConversation[] {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.conversations;
    }
    return this.conversations.filter(
      conv => conv.contactName.toLowerCase().includes(term) || conv.phone.toLowerCase().includes(term),
    );
  }

  select(id: string): void {
    this.conversationSelected.emit(id);
  }

  lastMessage(conv: SmsConversation): SmsMessage | undefined {
    return conv.messages[conv.messages.length - 1];
  }

  preview(conv: SmsConversation): string {
    return this.lastMessage(conv)?.text ?? 'No messages yet';
  }

  lastTime(conv: SmsConversation): string {
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
