import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder for the "recent conversations" widget. The original
 * pulled live threads from ChatService over a websocket, filtered them by
 * customer assignment via AssignmentService/CustomerService, and opened a
 * full chat modal (CuentaChatsComponent) on click. None of that backend
 * plumbing survives here — the conversation list is a fixed, realistic mock.
 * Clicking a conversation just marks it read locally, which is a purely
 * local UI behavior and is kept fully working via signals.
 */
interface RecentChatDisplay {
  id: string;
  displayName: string;
  initials: string;
  lastMessage: string;
  timestamp: Date;
  unreadCount: number;
  isOnline: boolean;
  avatarColor: string;
}

const AVATAR_COLORS = [
  'from-blue-400 to-blue-600',
  'from-purple-400 to-purple-600',
  'from-pink-400 to-pink-600',
  'from-orange-400 to-orange-600',
  'from-teal-400 to-teal-600',
];

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

@Component({
  selector: 'app-dashboard-recent-chats',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-recent-chats.component.html',
  styleUrl: './dashboard-recent-chats.component.scss',
})
export class DashboardRecentChatsComponent {
  readonly recentChats = signal<RecentChatDisplay[]>([
    {
      id: 'chat-1',
      displayName: 'Maria Gonzalez',
      initials: 'MG',
      lastMessage: 'Can you confirm if my 1099 was filed already?',
      timestamp: minutesAgo(5),
      unreadCount: 2,
      isOnline: true,
      avatarColor: AVATAR_COLORS[0],
    },
    {
      id: 'chat-2',
      displayName: 'James Carter',
      initials: 'JC',
      lastMessage: 'Thanks so much for the update on my refund!',
      timestamp: minutesAgo(70),
      unreadCount: 0,
      isOnline: false,
      avatarColor: AVATAR_COLORS[1],
    },
    {
      id: 'chat-3',
      displayName: 'Aisha Thompson',
      initials: 'AT',
      lastMessage: 'I just uploaded the missing W-2 form.',
      timestamp: minutesAgo(190),
      unreadCount: 1,
      isOnline: true,
      avatarColor: AVATAR_COLORS[2],
    },
    {
      id: 'chat-4',
      displayName: 'Robert Kim',
      initials: 'RK',
      lastMessage: 'When is the extension deadline again?',
      timestamp: minutesAgo(60 * 26),
      unreadCount: 0,
      isOnline: false,
      avatarColor: AVATAR_COLORS[3],
    },
    {
      id: 'chat-5',
      displayName: 'Linda Martinez',
      initials: 'LM',
      lastMessage: 'Perfect, see you at the appointment.',
      timestamp: minutesAgo(60 * 50),
      unreadCount: 0,
      isOnline: false,
      avatarColor: AVATAR_COLORS[4],
    },
  ]);

  readonly totalUnreadCount = computed(() =>
    this.recentChats().reduce((sum, chat) => sum + chat.unreadCount, 0)
  );

  openChat(chat: RecentChatDisplay): void {
    // Purely local: mark the conversation as read. No backend or chat modal wired up.
    if (chat.unreadCount === 0) {
      return;
    }
    this.recentChats.update(chats =>
      chats.map(c => (c.id === chat.id ? { ...c, unreadCount: 0 } : c))
    );
  }

  formatTimestamp(timestamp: Date): string {
    const diffMs = Date.now() - timestamp.getTime();
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  truncateMessage(message: string, maxLength: number = 50): string {
    if (!message) return 'No messages yet';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  }

  trackByChat(index: number, item: RecentChatDisplay): string {
    return item.id;
  }
}
