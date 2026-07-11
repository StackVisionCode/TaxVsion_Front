import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatConversationListComponent, ChatConversation } from '../../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatThreadComponent, ChatMessage } from '../../ui/chat-thread/chat-thread.component';
import { ChatComposerComponent } from '../../ui/chat-composer/chat-composer.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

function nowLabel(): string {
  return 'Just now';
}

/**
 * Página del módulo Chat (estilo "Aether"): mensajería interna de equipo,
 * no el AI Assistant. Rail de conversaciones a la izquierda + hilo activo a
 * la derecha, con datos estáticos en signals (sin backend/websocket real).
 * Reemplaza al god component "TaxTalk" de 1974 líneas del CRM original,
 * dejando fuera video-llamadas y grabación de voz (fuera de alcance aquí).
 */
@Component({
  selector: 'app-chat-page',
  imports: [CommonModule, ChatConversationListComponent, ChatThreadComponent, ChatComposerComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent {
  readonly conversations = signal<ChatConversation[]>([
    {
      id: 'conv-1',
      name: 'Sarah Kim (Reviewer)',
      avatarColor: 'bg-gray-900',
      online: true,
      unread: 2,
      messages: [
        { id: 'm1', senderId: 'them', text: 'Hey! Can you take a look at the Martinez return before EOD?', time: '9:02 AM', dateGroup: 'Today' },
        { id: 'm2', senderId: 'me', text: 'Sure, pulling it up now.', time: '9:05 AM', dateGroup: 'Today' },
        { id: 'm3', senderId: 'them', attachment: { name: 'Martinez_1040_draft.pdf', size: '1.2 MB' }, time: '9:06 AM', dateGroup: 'Today' },
        { id: 'm4', senderId: 'them', text: 'Flagged a couple of line items in there.', time: '9:07 AM', dateGroup: 'Today' },
        { id: 'm5', senderId: 'me', text: 'Got it, reviewing now — give me 15 minutes.', time: '9:10 AM', dateGroup: 'Today' },
      ],
    },
    {
      id: 'conv-2',
      name: 'James Cooper (Preparer)',
      avatarColor: 'bg-indigo-600',
      online: true,
      unread: 0,
      messages: [
        { id: 'm6', senderId: 'them', text: 'Client portal upload finally worked for the Chen file.', time: 'Yesterday', dateGroup: 'Yesterday' },
        { id: 'm7', senderId: 'me', text: 'Nice, thanks for following up.', time: 'Yesterday', dateGroup: 'Yesterday' },
        { id: 'm8', senderId: 'them', text: 'Starting on the Ferreira S-corp today, should be done by 3.', time: '10:14 AM', dateGroup: 'Today' },
        { id: 'm9', senderId: 'me', text: 'Sounds good, ping me if you hit any K-1 issues.', time: '10:16 AM', dateGroup: 'Today' },
      ],
    },
    {
      id: 'conv-3',
      name: 'Aisha Thompson (Admin)',
      avatarColor: 'bg-[#7C6AE0]',
      online: false,
      unread: 5,
      messages: [
        { id: 'm10', senderId: 'them', text: 'Reminder: staff meeting moved to 2:30 PM today.', time: '8:30 AM', dateGroup: 'Today' },
        { id: 'm11', senderId: 'them', text: 'Also, new client intake forms are in the shared drive.', time: '8:31 AM', dateGroup: 'Today' },
        { id: 'm12', senderId: 'me', text: "Thanks, I'll check them out.", time: '8:40 AM', dateGroup: 'Today' },
        { id: 'm13', senderId: 'them', attachment: { name: 'Staff_Meeting_Agenda.docx', size: '84 KB' }, time: '8:41 AM', dateGroup: 'Today' },
      ],
    },
    {
      id: 'conv-4',
      name: 'Marcus Webb (Partner)',
      avatarColor: 'bg-orange-500',
      online: true,
      unread: 0,
      messages: [
        { id: 'm14', senderId: 'me', text: 'Do you have a minute to discuss the Whitfield engagement?', time: 'Yesterday', dateGroup: 'Yesterday' },
        { id: 'm15', senderId: 'them', text: 'Yes, call me after lunch.', time: 'Yesterday', dateGroup: 'Yesterday' },
        { id: 'm16', senderId: 'them', text: "Actually let's just do it over chat — what's the concern?", time: '11:02 AM', dateGroup: 'Today' },
        { id: 'm17', senderId: 'me', text: 'Their K-1s came in late again, may push the deadline.', time: '11:05 AM', dateGroup: 'Today' },
        { id: 'm18', senderId: 'them', text: "Let's file an extension then, better safe than sorry.", time: '11:07 AM', dateGroup: 'Today' },
      ],
    },
    {
      id: 'conv-5',
      name: 'Elena Petrova (Bookkeeper)',
      avatarColor: 'bg-emerald-500',
      online: false,
      unread: 0,
      messages: [
        { id: 'm19', senderId: 'them', text: 'Reconciled the Q2 books for Summit Bakery.', time: 'Yesterday', dateGroup: 'Yesterday' },
        { id: 'm20', senderId: 'them', attachment: { name: 'Summit_Bakery_Q2_Reconciliation.xlsx', size: '310 KB' }, time: 'Yesterday', dateGroup: 'Yesterday' },
        { id: 'm21', senderId: 'me', text: 'Perfect timing, thank you!', time: 'Yesterday', dateGroup: 'Yesterday' },
      ],
    },
    {
      id: 'conv-6',
      name: 'David Okafor (IT Support)',
      avatarColor: 'bg-orange-500',
      online: true,
      unread: 1,
      messages: [
        { id: 'm22', senderId: 'them', text: 'Heads up — portal maintenance tonight 11 PM-1 AM.', time: '1:15 PM', dateGroup: 'Today' },
        { id: 'm23', senderId: 'me', text: 'Thanks for the heads up, will let clients know.', time: '1:18 PM', dateGroup: 'Today' },
        { id: 'm24', senderId: 'them', text: 'Also your VPN cert renewed, no action needed.', time: '1:19 PM', dateGroup: 'Today' },
      ],
    },
  ]);

  readonly activeConversationId = signal('conv-1');
  readonly isInfoOpen = signal(false);

  get activeConversation(): ChatConversation {
    return this.conversations().find(conv => conv.id === this.activeConversationId()) ?? this.conversations()[0];
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
    this.activeConversationId.set(id);
    this.conversations.update(list => list.map(conv => (conv.id === id ? { ...conv, unread: 0 } : conv)));
  }

  sendMessage(text: string): void {
    const message: ChatMessage = { id: `m-${Date.now()}`, senderId: 'me', text, time: nowLabel(), dateGroup: 'Today' };
    const activeId = this.activeConversationId();
    this.conversations.update(list =>
      list.map(conv => (conv.id === activeId ? { ...conv, messages: [...conv.messages, message] } : conv)),
    );
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
