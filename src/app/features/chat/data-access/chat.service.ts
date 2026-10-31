import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { MessageSearchResponse, MessageTranscriptUpdatedDto, MessagesPage, PagedConversations } from './chat.model';

/**
 * Cliente HTTP de Communication (`/communication`, servicio Fastify/TS vía
 * Gateway) — SOLO lectura. Crear conversación, enviar/editar/borrar mensaje,
 * typing, reacciones, etc. son Socket.IO-only en el backend real (el README
 * de Communication documenta endpoints REST que no existen en el código —
 * ver ChatSocketService para todo lo que es escritura).
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/communication');
  }

  listConversations(params: { page?: number; size?: number; includeArchived?: boolean } = {}): Observable<PagedConversations> {
    let query = new HttpParams();
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    if (params.includeArchived) {
      query = query.set('includeArchived', params.includeArchived);
    }
    return this.http.get<PagedConversations>(`${this.base}/conversations`, { params: query });
  }

  /** Historial paginado por cursor. Sin `before`/`since`: trae la página más reciente. */
  getMessages(
    conversationId: string,
    params: { before?: string; since?: string; take?: number } = {},
  ): Observable<MessagesPage> {
    let query = new HttpParams();
    if (params.before) {
      query = query.set('before', params.before);
    }
    if (params.since) {
      query = query.set('since', params.since);
    }
    if (params.take) {
      query = query.set('take', params.take);
    }
    return this.http.get<MessagesPage>(`${this.base}/conversations/${conversationId}/messages`, { params: query });
  }

  /** F7 — pide el transcript de una nota de voz (botón "Transcribe"); el texto llega por socket. */
  requestVoiceNoteTranscript(conversationId: string, messageId: string): Observable<MessageTranscriptUpdatedDto> {
    return this.http.post<MessageTranscriptUpdatedDto>(`${this.base}/conversations/${conversationId}/messages/${messageId}/transcript`, {});
  }

  /** F7 — búsqueda en el historial (texto y transcripts de notas de voz), más recientes primero. `q` ≥ 2 caracteres. */
  searchMessages(conversationId: string, q: string, limit?: number): Observable<MessageSearchResponse> {
    let query = new HttpParams().set('q', q);
    if (limit) {
      query = query.set('limit', limit);
    }
    return this.http.get<MessageSearchResponse>(`${this.base}/conversations/${conversationId}/messages/search`, { params: query });
  }
}
