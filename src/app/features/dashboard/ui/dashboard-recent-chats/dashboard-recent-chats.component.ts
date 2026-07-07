import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface RecentChat {
  id: string;
  name: string;
  initials: string;
  lastMessage: string;
  time: string;
  unreadCount: number;
  isOnline: boolean;
  /** Solid avatar circle color (Aether rotation). */
  avatarBg: string;
}

const AVATAR_COLORS = [
  'bg-gray-900',
  'bg-indigo-600',
  'bg-[#7C6AE0]',
  'bg-orange-500',
  'bg-emerald-500',
];

/**
 * Widget "Recent Chats" (referencia "Aether"): lista de conversaciones con
 * avatar de iniciales, preview del último mensaje y contador de no leídos en
 * píldora negra. Click marca la conversación como leída (solo estado local).
 */
@Component({
  selector: 'app-dashboard-recent-chats',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-recent-chats.component.html',
})
export class DashboardRecentChatsComponent {
  readonly chats = signal<RecentChat[]>([
    {
      id: 'chat-1',
      name: 'Maria Gonzalez',
      initials: 'MG',
      lastMessage: 'Can you confirm if my 1099 was filed already?',
      time: '5 min ago',
      unreadCount: 2,
      isOnline: true,
      avatarBg: AVATAR_COLORS[0],
    },
    {
      id: 'chat-2',
      name: 'James Carter',
      initials: 'JC',
      lastMessage: 'Thanks so much for the update on my refund!',
      time: '1h ago',
      unreadCount: 0,
      isOnline: false,
      avatarBg: AVATAR_COLORS[1],
    },
    {
      id: 'chat-3',
      name: 'Aisha Thompson',
      initials: 'AT',
      lastMessage: 'I just uploaded the missing W-2 form.',
      time: '3h ago',
      unreadCount: 1,
      isOnline: true,
      avatarBg: AVATAR_COLORS[2],
    },
    {
      id: 'chat-4',
      name: 'Robert Kim',
      initials: 'RK',
      lastMessage: 'When is the extension deadline again?',
      time: '1d ago',
      unreadCount: 0,
      isOnline: false,
      avatarBg: AVATAR_COLORS[3],
    },
    {
      id: 'chat-5',
      name: 'Linda Martinez',
      initials: 'LM',
      lastMessage: 'Perfect, see you at the appointment.',
      time: '2d ago',
      unreadCount: 0,
      isOnline: false,
      avatarBg: AVATAR_COLORS[4],
    },
  ]);

  readonly unreadTotal = computed(() =>
    this.chats().reduce((sum, chat) => sum + chat.unreadCount, 0),
  );

  markAsRead(chat: RecentChat): void {
    if (chat.unreadCount === 0) {
      return;
    }
    this.chats.update(chats =>
      chats.map(c => (c.id === chat.id ? { ...c, unreadCount: 0 } : c)),
    );
  }

  trackByChatId(_index: number, chat: RecentChat): string {
    return chat.id;
  }
}
