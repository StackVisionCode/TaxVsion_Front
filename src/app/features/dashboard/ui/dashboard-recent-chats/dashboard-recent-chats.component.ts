import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { ChatService } from '../../../chat/data-access/chat.service';
import { ConversationSummary } from '../../../chat/data-access/chat.model';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/** Conversaciones que se piden (igual que la página de Chat) y cuántas se listan. */
const FETCH_SIZE = 50;
const MAX_ROWS = 5;

const AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

interface RecentChatRow {
  id: string;
  name: string;
  initials: string;
  /** Metadato real de la conversación ("Direct message" / "4 participants"). */
  subtitle: string;
  time: string;
  unreadCount: number;
  avatarBg: string;
}

/**
 * Widget "Recent Chats".
 *
 * Antes eran 5 conversaciones inventadas con nombres de clientes, mensajes
 * ("Can you confirm if my 1099 was filed already?"), horas y puntos de
 * "en línea" — todo falso, y el click solo borraba el contador local.
 *
 * Ahora se llama directamente a `GET /communication/conversations`
 * (`ChatService`, root y de solo lectura). NO se usa `ChatStore` a propósito:
 * su `load()` abre la conexión Socket.IO y además pide un mensaje por
 * conversación (N+1) para armar los previews — demasiado para un accesorio
 * del dashboard que se monta en cada visita.
 *
 * Consecuencia honesta de esa decisión: el endpoint de listado NO incluye el
 * último mensaje ni el estado de conexión, así que el widget NO los muestra
 * (antes se inventaban). Lo que se ve es lo que el backend sí devuelve:
 * nombre, tipo/participantes, no leídos y la fecha del último mensaje. El
 * hilo completo se abre en la página de Chat.
 */
@Component({
  selector: 'app-dashboard-recent-chats',
  imports: [CommonModule, RouterLink, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-recent-chats.component.html',
})
export class DashboardRecentChatsComponent implements OnInit {
  private readonly service = inject(ChatService);
  private readonly auth = inject(AuthService);

  private readonly conversations = signal<ConversationSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** No leídos sumados sobre las conversaciones traídas. */
  readonly unreadTotal = computed(() =>
    this.conversations().reduce((sum, conversation) => sum + conversation.unreadCount, 0),
  );

  readonly chats = computed<RecentChatRow[]>(() => {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    return [...this.conversations()]
      .sort((a, b) => this.activityMs(b) - this.activityMs(a))
      .slice(0, MAX_ROWS)
      .map((conversation, index) => {
        const other = conversation.participants.find(p => p.userId !== currentUserId);
        const name = conversation.title ?? other?.displayName ?? 'Conversation';
        return {
          id: conversation.id,
          name,
          initials: this.initialsOf(name),
          subtitle:
            conversation.kind === 'Direct'
              ? 'Direct message'
              : `${conversation.participants.length} participants`,
          time: this.relativeTime(conversation.lastMessageAtUtc ?? conversation.updatedAtUtc),
          unreadCount: conversation.unreadCount,
          avatarBg: AVATAR_COLORS[index % AVATAR_COLORS.length],
        };
      });
  });

  ngOnInit(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.listConversations({ size: FETCH_SIZE }).subscribe({
      next: result => {
        this.conversations.set(result.items ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  trackByChatId(_index: number, chat: RecentChatRow): string {
    return chat.id;
  }

  private activityMs(conversation: ConversationSummary): number {
    const value = new Date(conversation.lastMessageAtUtc ?? conversation.updatedAtUtc).getTime();
    return Number.isNaN(value) ? 0 : value;
  }

  private initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  private relativeTime(isoUtc: string): string {
    const then = new Date(isoUtc).getTime();
    if (Number.isNaN(then)) {
      return '';
    }
    const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
