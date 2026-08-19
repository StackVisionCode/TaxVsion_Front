import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SmsConversationListComponent, SmsConversation } from '../../ui/sms-conversation-list/sms-conversation-list.component';
import { SmsThreadComponent, SmsMessage } from '../../ui/sms-thread/sms-thread.component';
import { SmsComposerComponent } from '../../ui/sms-composer/sms-composer.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

function nowLabel(): string {
  return 'Just now';
}

const SEED_CONVERSATIONS: SmsConversation[] = [
  {
    id: 'sms-1',
    contactName: 'Rachel Nguyen',
    phone: '+1 (555) 234-5678',
    avatarColor: 'bg-gray-900',
    unread: 1,
    messages: [
      { id: 'sm1', direction: 'outbound', text: 'Reminder: your tax appointment is tomorrow at 10 AM. Reply YES to confirm.', time: '9:00 AM', status: 'delivered' },
      { id: 'sm2', direction: 'inbound', text: 'YES, see you then!', time: '9:04 AM', status: 'delivered' },
      { id: 'sm3', direction: 'outbound', text: 'Great, confirmed. Please bring your W-2 and last year\'s return.', time: '9:05 AM', status: 'delivered' },
      { id: 'sm4', direction: 'inbound', text: 'Will do, thank you!', time: '9:06 AM', status: 'delivered' },
    ],
  },
  {
    id: 'sms-2',
    contactName: 'David Park',
    phone: '+1 (555) 341-9082',
    avatarColor: 'bg-indigo-600',
    unread: 0,
    messages: [
      { id: 'sm5', direction: 'outbound', text: 'Hi David, we\'re still missing your 1099-NEC for the Q1 filing.', time: 'Yesterday', status: 'delivered' },
      { id: 'sm6', direction: 'inbound', text: 'Sorry, been traveling. I\'ll upload it tonight.', time: 'Yesterday', status: 'delivered' },
      { id: 'sm7', direction: 'outbound', text: 'No rush, just flag it once it\'s in the portal.', time: 'Yesterday', status: 'delivered' },
    ],
  },
  {
    id: 'sms-3',
    contactName: 'Monica Alvarez',
    phone: '+1 (555) 762-3315',
    avatarColor: 'bg-orange-500',
    unread: 2,
    messages: [
      { id: 'sm8', direction: 'outbound', text: 'Your refund of $1,240 was accepted by the IRS today.', time: '11:10 AM', status: 'delivered' },
      { id: 'sm9', direction: 'inbound', text: 'That\'s great news, when should I expect the deposit?', time: '11:15 AM', status: 'delivered' },
      { id: 'sm10', direction: 'inbound', text: 'Also, can you resend the filing copy?', time: '11:16 AM', status: 'delivered' },
    ],
  },
  {
    id: 'sms-4',
    contactName: 'Tom Whitfield',
    phone: '+1 (555) 448-2207',
    avatarColor: 'bg-[#7C6AE0]',
    unread: 0,
    messages: [
      { id: 'sm11', direction: 'outbound', text: 'We filed an extension for your return, new deadline is Oct 15.', time: 'Mon', status: 'delivered' },
      { id: 'sm12', direction: 'inbound', text: 'Perfect, thanks for handling that.', time: 'Mon', status: 'delivered' },
      { id: 'sm13', direction: 'outbound', text: 'Of course. We\'ll follow up once your K-1s arrive.', time: 'Mon', status: 'delivered' },
      { id: 'sm14', direction: 'inbound', text: 'Sounds good.', time: 'Mon', status: 'delivered' },
    ],
  },
  {
    id: 'sms-5',
    contactName: 'Priya Sharma',
    phone: '+1 (555) 913-6640',
    avatarColor: 'bg-emerald-500',
    unread: 0,
    messages: [
      { id: 'sm15', direction: 'inbound', text: 'Hi, any update on my refund status?', time: 'Tue', status: 'delivered' },
      { id: 'sm16', direction: 'outbound', text: 'Checking now, one moment.', time: 'Tue', status: 'delivered' },
      { id: 'sm17', direction: 'outbound', text: 'Still processing with the IRS, usually takes 21 days. We\'ll notify you.', time: 'Tue', status: 'failed' },
    ],
  },
  {
    id: 'sms-6',
    contactName: 'Carlos Mendes',
    phone: '+1 (555) 587-1129',
    avatarColor: 'bg-rose-500',
    unread: 1,
    messages: [
      { id: 'sm18', direction: 'outbound', text: 'Your e-file authorization form (8879) still needs a signature.', time: '2:30 PM', status: 'delivered' },
      { id: 'sm19', direction: 'inbound', text: 'Just signed it in the portal.', time: '2:41 PM', status: 'delivered' },
      { id: 'sm20', direction: 'outbound', text: 'Received, thank you! We\'ll e-file today.', time: '2:42 PM', status: 'pending' },
    ],
  },
];

/**
 * Página del módulo SMS (estilo "Aether"): bandeja de conversaciones de
 * texto con clientes del despacho. Rail de contactos a la izquierda +
 * hilo activo a la derecha, con datos estáticos en signals (sin backend
 * real de mensajería). Incluye un overlay simple de "New broadcast" para
 * redactar un mensaje masivo: no hay selector de destinatarios real ni
 * integración de pasarela de pago (fuera de alcance, este módulo no
 * replica el balance/recarga/precios del CRM original).
 */
@Component({
  selector: 'app-sms-page',
  imports: [CommonModule, FormsModule, SmsConversationListComponent, SmsThreadComponent, SmsComposerComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-page.component.html',
  styleUrl: './sms-page.component.css',
})
export class SmsPageComponent {
  readonly conversations = signal<SmsConversation[]>(SEED_CONVERSATIONS);
  readonly activeConversationId = signal('sms-1');

  readonly isBroadcastOpen = signal(false);
  readonly broadcastText = signal('');
  readonly toastMessage = signal<string | null>(null);

  readonly activeConversation = computed<SmsConversation>(
    () => this.conversations().find(conv => conv.id === this.activeConversationId()) ?? this.conversations()[0],
  );

  selectConversation(id: string): void {
    this.activeConversationId.set(id);
    this.conversations.update(list => list.map(conv => (conv.id === id ? { ...conv, unread: 0 } : conv)));
  }

  sendMessage(text: string): void {
    const id = `sms-msg-${Date.now()}`;
    const message: SmsMessage = { id, direction: 'outbound', text, time: nowLabel(), status: 'sent' };
    const activeId = this.activeConversationId();
    this.conversations.update(list =>
      list.map(conv => (conv.id === activeId ? { ...conv, messages: [...conv.messages, message] } : conv)),
    );

    // Simula la confirmación de entrega del proveedor de SMS tras un breve delay.
    setTimeout(() => {
      this.conversations.update(list =>
        list.map(conv =>
          conv.id === activeId
            ? { ...conv, messages: conv.messages.map(m => (m.id === id ? { ...m, status: 'delivered' } : m)) }
            : conv,
        ),
      );
    }, 800);
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

  openBroadcast(): void {
    this.isBroadcastOpen.set(true);
  }

  closeBroadcast(): void {
    this.isBroadcastOpen.set(false);
    this.broadcastText.set('');
  }

  sendBroadcast(): void {
    // No hay pasarela de envío real ni selector de destinatarios: solo
    // cierra el overlay y confirma con un toast transitorio.
    this.isBroadcastOpen.set(false);
    this.broadcastText.set('');
    this.showToast('Broadcast sent to all contacts');
  }

  callContact(): void {
    // Sin integración real de telefonía: confirma la intención con un toast.
    this.showToast(`Calling ${this.activeConversation().contactName}...`);
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2500);
  }
}
