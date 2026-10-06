import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { ChatService } from '../../../chat/data-access/chat.service';
import { ConversationSummary } from '../../../chat/data-access/chat.model';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { formatRelativeTime } from '@shared/utils/format.util';

/** Conversaciones que se piden (igual que la página de Chat) y cuántas se listan. */
const FETCH_SIZE = 50;
const MAX_ROWS = 5;

interface RecentChatRow {
  id: string;
  name: string;
  /** Metadato real de la conversación ("Direct message" / "4 participants"). */
  subtitle: string;
  time: string;
  unreadCount: number;
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
  imports: [CommonModule, RouterLink, StateBlockComponent, AvatarComponent],
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
      .map(conversation => {
        const other = conversation.participants.find(p => p.userId !== currentUserId);
        const name = conversation.title ?? other?.displayName ?? 'Conversation';
        return {
          id: conversation.id,
          name,
          subtitle:
            conversation.kind === 'Direct'
              ? 'Direct message'
              : `${conversation.participants.length} participants`,
          time: formatRelativeTime(conversation.lastMessageAtUtc ?? conversation.updatedAtUtc),
          unreadCount: conversation.unreadCount,
        };
      });
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
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
}
