import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { ConversationAttachmentsService } from '@core/communication/conversation-attachments.service';
import { AttachmentMetaDto, ConversationContentPage, ConversationContentTab, ConversationKind, GroupActivityPage, GroupAvatarUpload, InitiatedAttachmentUpload, MessageEditsDto, MessageSearchResponse, MessageTranscriptUpdatedDto, MessagesPage, PagedConversations } from './chat.model';

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
  private readonly attachments = inject(ConversationAttachmentsService);
  private get base(): string {
    return this.api.tenantUrl('/communication');
  }

  listConversations(
    params: { page?: number; size?: number; includeArchived?: boolean; kinds?: readonly ConversationKind[] } = {},
  ): Observable<PagedConversations> {
    let query = new HttpParams();
    if (params.kinds?.length) {
      query = query.set('kinds', params.kinds.join(','));
    }
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
  /** F8 — versiones anteriores de un mensaje editado ("Edited"). */
  getMessageEdits(conversationId: string, messageId: string): Observable<MessageEditsDto> {
    return this.http.get<MessageEditsDto>(`${this.base}/conversations/${conversationId}/messages/${messageId}/edits`);
  }

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

  // ---------- F8d: adjuntos mediados por Communication (el CRM ya no llama a CloudStorage directo) ----------

  initiateAttachmentUpload(
    conversationId: string,
    file: { originalName: string; contentType: string; sizeBytes: number },
  ): Observable<InitiatedAttachmentUpload> {
    return this.attachments.initiateUpload(conversationId, file);
  }

  completeAttachmentUpload(conversationId: string, fileId: string): Observable<{ fileId: string; status: string }> {
    return this.attachments.completeUpload(conversationId, fileId);
  }

  /** Metadata, tipo real y estado del escaneo (Pending → "Scanning"; rechazado → "Unavailable"). */
  getAttachmentMeta(conversationId: string, fileId: string): Observable<AttachmentMetaDto> {
    return this.attachments.getMeta(conversationId, fileId);
  }

  /** URL presignada (solo si está disponible). */
  getAttachmentDownloadUrl(conversationId: string, fileId: string): Observable<{ downloadUrl: string }> {
    return this.attachments.getDownloadUrl(conversationId, fileId);
  }

  /** F8d — una pestaña de Info (Media, Documents, Audio o Links), más reciente primero. */
  getConversationContent(conversationId: string, tab: ConversationContentTab, before?: string | null): Observable<ConversationContentPage> {
    let query = new HttpParams().set('tab', tab);
    if (before) {
      query = query.set('before', before);
    }
    return this.http.get<ConversationContentPage>(`${this.base}/conversations/${conversationId}/content`, { params: query });
  }

  /** F8b (T-21) — foto del grupo: Communication media la subida a `Avatars` (solo servicios suben ahí). */
  startGroupAvatarUpload(
    conversationId: string,
    file: { originalName: string; contentType: string; sizeBytes: number },
  ): Observable<GroupAvatarUpload> {
    return this.http.post<GroupAvatarUpload>(`${this.base}/conversations/${conversationId}/avatar/upload`, file);
  }

  completeGroupAvatarUpload(conversationId: string, fileId: string): Observable<{ fileId: string; status: string }> {
    return this.http.post<{ fileId: string; status: string }>(`${this.base}/conversations/${conversationId}/avatar/${fileId}/complete`, {});
  }

  /** F8b (T-22) — bitácora del grupo (Owner/Admin o superpoder), más reciente primero. */
  getGroupActivity(conversationId: string, before?: string): Observable<GroupActivityPage> {
    let query = new HttpParams().set('take', 50);
    if (before) {
      query = query.set('before', before);
    }
    return this.http.get<GroupActivityPage>(`${this.base}/conversations/${conversationId}/audit`, { params: query });
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
