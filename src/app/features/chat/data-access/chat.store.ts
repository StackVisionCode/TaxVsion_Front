import { PermissionService } from '@core/auth/permission.service';
import type { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subject, Subscription, firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { SOCKET_RATE_LIMITED_MESSAGE, isSocketRateLimited, throttleMessageOr } from '@core/errors/throttling';
import { ToastService } from '@shared/ui/toast/toast.service';
import { applyConversationUpdate, applyRoleChange, groupErrorMessage, removeParticipantFrom } from './chat-groups';
import { applyReaction, hasMyReaction, reactionErrorText } from '@shared/ui/chat/message-reactions/reaction-summary';
import { MESSAGE_TOO_LONG_TEXT } from '@shared/ui/chat/message-text';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileResponse, formatBytes } from '@core/cloud-storage/cloud-storage.model';
import { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatMessage } from '@shared/ui/chat/chat-thread/chat-thread.component';
import { toAttachmentScanState } from '@shared/ui/chat/chat-message.model';
import { ChatSearchResult, MIN_CHAT_SEARCH_LENGTH } from '../ui/chat-message-search/chat-message-search.component';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { RecordedVoiceNote } from '@core/communication/voice-note-recorder.service';
import { SoundsService } from '@core/communication/media/sounds.service';
import {
  ChatParticipant,
  ConversationKind,
  ConversationMeta,
  ConversationSummary,
  CustomerDirectoryEntry,
  EmployeeDirectoryEntry,
  MessageDto,
  MessageEditsDto,
  MessageTranscriptUpdatedDto,
  TypingDto,
  toVoiceNoteTranscriptState,
  type AttachmentMetaDto,
  type MessageReactionChangedDto,
} from './chat.model';
import type { UserProfileChangedEvent } from '@core/realtime/realtime.model';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import {
  addParticipant,
  applyProfileChangeToConversation,
  conversationAvatarColor,
  peerOf,
  seedAvatarsFromHistory,
  toChatParticipants,
  withParticipants,
} from './chat-participants';
import { chatStartErrorMessage } from './chat-start-error';
import { editErrorMessage } from '@shared/ui/chat/message-edit';

/** F8a: el módulo Chat lista solo 1:1 y grupos (Support y la sala tienen su propio lugar). */
const CHAT_KINDS: readonly ConversationKind[] = ['Direct', 'Group'];

/** Corta el "typing" saliente tras esta inactividad (además el server auto-expira). */
const TYPING_IDLE_MS = 3000;
/** Red de seguridad: si no llega `typing.stopped`, se limpia el indicador entrante igual. */
const TYPING_EXPIRY_MS = 6000;
/** Re-emite `recording.start` mientras se graba para renovar el TTL del server (20s). */
const RECORDING_HEARTBEAT_MS = 12000;
/** Red de seguridad del indicador "grabando…" entrante si no llega `recording.stopped`. */
const RECORDING_EXPIRY_MS = 22000;
/** Resultados por búsqueda de mensajes (el backend acepta hasta 200). */
const MESSAGE_SEARCH_LIMIT = 30;

/** Id local para mensajes optimistas (no viaja al backend: el socket usa su propio clientKey). */
function newLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(iso: string): string {
  return parseUtcDate(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateGroup(iso: string): string {
  const date = parseUtcDate(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) {
    return 'Today';
  }
  if (sameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Store de Chat de equipo (Communication, `/communication` vía Gateway). El
 * listado y el historial vienen de HTTP; crear conversación, enviar/editar/
 * borrar mensaje, typing y presencia son Socket.IO-only en el backend real
 * (ver ChatSocketService). Nueva conversación (directa o grupo, según
 * `canCreateGroups`) y adjuntos reales (CloudStorage, `@core/cloud-storage`)
 * ya están conectados; siguen afuera: reacciones, editar/borrar desde la UI,
 * y video-llamadas.
 */
/** Mensaje de un ticket de Support tal como lo necesita la bandeja (fila, vista previa y no leídos). */
export interface SupportActivity {
  conversationId: string;
  fromMe: boolean;
  kind: string;
  body: string | null;
  createdAtUtc: string;
  /** El hilo del ticket está abierto y a la vista: no cuenta como no leído. */
  viewing: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly perms = inject(PermissionService);
  private readonly chatService = inject(ChatService);
  private readonly socket = inject(ChatSocketService);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(ChatDirectoryService);
  private readonly attachments = inject(ChatAttachmentsService);
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);
  private readonly sounds = inject(SoundsService);

  private readonly _conversations = signal<ChatConversation[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _activeConversationId = signal<string | null>(null);

  /** Lista del módulo Chat (sin las conversaciones abiertas desde otro módulo, como un ticket de Support). */
  readonly conversations = computed(() => this._conversations().filter(c => !c.embedded));
  /** F8a (D-12): conversación activa abierta desde otro módulo (Support), o null. */
  readonly embeddedConversation = computed(() => {
    const id = this._activeConversationId();
    return this._conversations().find(c => c.id === id && c.embedded) ?? null;
  });
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly activeConversationId = this._activeConversationId.asReadonly();
  /**
   * La página /chat está montada (la pone la propia página). El store es root y conserva la
   * conversación activa al salir de /chat, así que "activa" sola no significa "la estoy viendo".
   */
  readonly pageAttached = signal(false);
  /** F8c (T-15): la pestaña está visible (sin esto, un mensaje se marcaba leído con la pestaña oculta). */
  private readonly documentVisible = signal(typeof document === 'undefined' || document.visibilityState !== 'hidden');
  readonly connected = this.socket.connected;
  /** No-leídos totales de todas las conversaciones — para el badge del sidebar. */
  // F8b (ADD-05 H-6): un chat silenciado no suma al badge (sigue mostrando sus no leídos en la lista).
  readonly totalUnread = computed(() => this.conversations().reduce((sum, c) => sum + (c.isMuted ? 0 : c.unread), 0));
  /** F8a: no leídos de los tickets de Support (su propio módulo y badge); se recalcula al cargar la lista. */
  private readonly _supportUnread = signal(0);
  readonly supportUnread = this._supportUnread.asReadonly();
  /** Cada mensaje de un ticket (visto o no): la bandeja de Support marca cuál trae el mensaje nuevo. */
  readonly supportActivity$ = new Subject<SupportActivity>();
  /**
   * F8a: el deep link `/chat?conversation=` apuntó a un chat de otro módulo (Support o Meeting). La página
   * navega y lo limpia; el store no conoce el router.
   */
  private readonly _redirect = signal<{ commands: string[]; queryParams: Record<string, string> } | null>(null);
  readonly redirect = this._redirect.asReadonly();

  /** userId del otro participante por conversación 1:1 — para reflejar chat.presence.changed. */
  private readonly otherParticipantByConversation = new Map<string, string>();
  /** createdAtUtc del último mensaje conocido por conversación — cursor `since` del backfill al reconectar. */
  private readonly lastMessageAtByConversation = new Map<string, string>();
  private socketWired = false;

  // ---------- Historial (scrollback) ----------
  /** Cursor `before` de la próxima página más vieja por conversación (null = no hay más). */
  private readonly historyCursorByConversation = new Map<string, string | null>();
  private readonly _loadingOlder = signal(false);
  readonly loadingOlder = this._loadingOlder.asReadonly();

  /** Error de la última acción de mensaje (edit/delete) para mostrar al usuario. */
  private readonly _messageActionError = signal<string | null>(null);
  readonly messageActionError = this._messageActionError.asReadonly();

  // ---------- Typing ----------
  /** Conversación en la que YO estoy escribiendo ahora (para no re-emitir typing.start). */
  private typingActiveConversationId: string | null = null;
  private typingStopTimer: ReturnType<typeof setTimeout> | undefined;
  /** Expiración por (conversación:usuario) del typing ENTRANTE — clave `${convId}:${userId}`. */
  private readonly typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---------- Recording (indicador "grabando una nota de voz…") ----------
  private recordingActiveConversationId: string | null = null;
  private recordingHeartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly recordingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---------- Nueva conversación ----------
  private readonly _employeeResults = signal<EmployeeDirectoryEntry[]>([]);
  private readonly _customerResults = signal<CustomerDirectoryEntry[]>([]);
  private readonly _employeeSearchLoading = signal(false);
  private readonly _employeeSearchError = signal<string | null>(null);
  private readonly _newConversationError = signal<string | null>(null);
  private directorySearch: Subscription | null = null;
  private readonly _creatingConversation = signal(false);

  readonly employeeResults = this._employeeResults.asReadonly();
  readonly customerResults = this._customerResults.asReadonly();
  readonly employeeSearchLoading = this._employeeSearchLoading.asReadonly();
  readonly employeeSearchError = this._employeeSearchError.asReadonly();
  readonly newConversationError = this._newConversationError.asReadonly();
  readonly creatingConversation = this._creatingConversation.asReadonly();
  /** F8c: cursor de la siguiente página del directorio (null = no hay más). */
  private readonly _directoryCursor = signal<{ audience: 'team' | 'clients'; cursor: string } | null>(null);
  readonly hasMoreDirectory = computed(() => this._directoryCursor() !== null);
  private directoryTerm: string | null = null;

  /** communication.group.create solo lo tiene Tenant Admin por defecto — ver MeResponse.permissions. */
  readonly canCreateGroups = computed(
    () => this.perms.has('communication.group.create'),
  );

  /** F8b (D-22): administra cualquier grupo de la oficina sin ser miembro (Tenant Admin o `group.manage_members`). */
  readonly canAdministerAnyGroup = computed(() => this.perms.has('communication.group.manage_members'));

  /** Permiso para iniciar llamadas de audio 1:1 (el backend exige communication.call.start en initiate). */
  readonly canStartAudioCall = computed(
    () => this.perms.has('communication.call.start'),
  );

  /** Permiso para iniciar videollamadas 1:1 (el backend exige communication.videocall.start en initiate con kind Video). */
  readonly canStartVideoCall = computed(
    () => this.perms.has('communication.videocall.start'),
  );

  // ---------- Adjuntos ----------
  private readonly _uploadingAttachment = signal(false);
  readonly uploadingAttachment = this._uploadingAttachment.asReadonly();

  // ---------- F7: búsqueda de mensajes (texto + transcripts de notas de voz) ----------
  private readonly _searchQuery = signal('');
  private readonly _searchResults = signal<ChatSearchResult[]>([]);
  private readonly _searchLoading = signal(false);
  private readonly _searchError = signal<string | null>(null);
  private readonly _searchTruncated = signal(false);
  private messageSearchSub: Subscription | null = null;
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly searchResults = this._searchResults.asReadonly();
  readonly searchLoading = this._searchLoading.asReadonly();
  readonly searchError = this._searchError.asReadonly();
  readonly searchTruncated = this._searchTruncated.asReadonly();

  /** Metadata resuelta perezosamente para adjuntos ajenos/históricos (el MessageDto solo trae el fileId). */
  private readonly attachmentMetaCache = new Map<string, AttachmentMetaDto>();
  private readonly pendingFileMetaLookups = new Set<string>();

  /**
   * Abre una conversación por id reutilizando todo el motor de chat. Si ya está en la
   * lista la selecciona; si no (p. ej. deep-link a un ticket de Support recién creado),
   * recarga la lista pidiéndole que quede seleccionada esa. Lo usa el deep-link de Support.
   */
  focusConversation(id: string): void {
    if (this._conversations().some(c => c.id === id)) {
      this.selectConversation(id);
    } else {
      this.load(id);
    }
  }

  /**
   * Prepara el chat lo justo para el badge de no-leídos del sidebar SIN abrir el módulo:
   * conecta el socket, cablea los eventos (para que los mensajes nuevos suban el conteo en
   * vivo) y carga la lista de conversaciones (con sus no-leídos) — sin previews ni seleccionar
   * ni marcar leído nada. Lo llama el shell al entrar.
   */
  primeForBadge(): void {
    this.socket.connect();
    this.wireSocketEventsOnce();
    if (this._conversations().length === 0) {
      this.refreshConversationList();
    }
  }

  load(preferConversationId?: string): void {
    this.socket.connect();
    this.wireSocketEventsOnce();

    this._loading.set(true);
    this._error.set(null);
    this.chatService.listConversations({ size: 50, kinds: CHAT_KINDS }).subscribe({
      next: result => {
        this._supportUnread.set(result.unreadByKind?.Support ?? 0);
        this.otherParticipantByConversation.clear();
        const currentUserId = this.auth.currentUser()?.id ?? null;
        result.items.forEach(summary => {
          const other = summary.participants.find(p => p.userId !== currentUserId);
          if (other) {
            this.otherParticipantByConversation.set(summary.id, other.userId);
          }
        });

        // Preview: 1 mensaje por conversación (el backend no incluye snippet del último mensaje en la lista).
        const previews: Observable<ChatConversation>[] = result.items.map(summary =>
          this.chatService.getMessages(summary.id, { take: 1 }).pipe(
            map(page => this.toConversation(summary, currentUserId, page.items)),
            catchError(() => of(this.toConversation(summary, currentUserId, []))),
          ),
        );
        (previews.length ? forkJoin(previews) : of([] as ChatConversation[])).subscribe(conversations => {
          this._conversations.set(conversations);
          this._loading.set(false);
          // Deep-link: si pidieron una conversación puntual (Support), abrí esa; si no, la primera.
          if (preferConversationId) {
            if (!conversations.some(c => c.id === preferConversationId)) {
              // No vino en esta página (ticket viejo): la abrimos igual — es válida para el usuario.
              this.ensureOptimisticConversation(preferConversationId, 'Conversation');
            }
            this.selectConversation(preferConversationId);
          } else {
            // F8c (ADD-06 H-5): sin deep link no se abre ningún hilo. Si ya había una activa (store singleton que
            // sobrevive a navegar en la SPA), se vuelve a pedir su historial completo (la lista trae solo 1 mensaje).
            const active = this._activeConversationId();
            if (active && conversations.some(c => c.id === active)) {
              this.selectConversation(active);
            } else {
              this._activeConversationId.set(null);
            }
          }
          // F8c (COMP-03): estado de presencia de todos los pares de una vez (el punto de cada fila).
          this.socket.queryPresence([...new Set(this.otherParticipantByConversation.values())]);
        });
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  selectConversation(id: string): void {
    if (this._activeConversationId() !== id) {
      this.clearMessageSearch();
    }
    this._activeConversationId.set(id);
    this._conversations.update(list => list.map(c => (c.id === id ? { ...c, unread: 0 } : c)));

    // Snapshot de presencia del peer: `chat.presence.changed` solo llega en transiciones, así que si el
    // otro ya estaba conectado antes de abrir, quedaba "Offline" falso. Se pide su estado actual (la
    // respuesta entra por el mismo `presenceChanged$`).
    const peerUserId = this.otherParticipantByConversation.get(id);
    if (peerUserId) {
      this.socket.queryPresence([peerUserId]);
    }

    // Trae el historial recién al abrir el hilo (evita 1 llamada "take=50" por conversación al cargar la lista).
    // El backend pagina DESC (más nuevo→más viejo); lo invertimos a ASC para renderizar cronológico.
    this.chatService.getMessages(id, { take: 50 }).subscribe({
      next: page => {
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const ordered = [...page.items].reverse();
        const messages = ordered.map(dto => this.toMessage(dto, currentUserId));
        this._conversations.update(list =>
          list.map(c =>
            c.id === id
              ? seedAvatarsFromHistory(
                  {
                    ...c,
                    messages,
                    hasMoreHistory: page.nextBeforeUtc !== null,
                    editPolicy: page.editPolicy ?? null,
                    reactionPolicy: page.reactionPolicy ?? null,
                    isArchived: page.conversation?.isArchived ?? false,
                  },
                  page.items,
                  currentUserId,
                )
              : c,
          ),
        );
        this.historyCursorByConversation.set(id, page.nextBeforeUtc);
        // F8a (ADD-12 H-11): un deep link a un chat de Support o de una sala no se abre aquí: va a su módulo.
        if (!this.isEmbedded(id) && this.redirectToOwnerModule(id, page.conversation)) {
          return;
        }
        const last = ordered[ordered.length - 1]; // más reciente
        if (last) {
          this.noteLatestTimestamp(id, last.createdAtUtc);
          void this.socket.markRead(id, last.id);
        }
      },
      error: err => console.warn('No se pudo cargar el historial del chat:', toApiError(err).message),
    });
  }

  /**
   * Envío optimista: la burbuja aparece al instante ("sending") y el hilo baja al fondo sin esperar
   * al socket. Con el ack se reemplaza en su lugar por el mensaje real (misma `renderKey` ⇒ el nodo no
   * se recrea); si falla queda marcada "failed" para reintentar.
   */
  async sendMessage(text: string): Promise<void> {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    const tempId = `tmp-${newLocalId()}`;
    const now = new Date().toISOString();
    this.upsertOwnMessage(conversationId, tempId, {
      id: tempId,
      renderKey: tempId,
      senderId: 'me',
      text,
      time: formatTime(now),
      dateGroup: formatDateGroup(now),
      isEdited: false,
      isDeleted: false,
      createdAtUtc: now,
      status: 'sending',
    });
    await this.deliverPending(conversationId, tempId, text);
  }

  /** Reintenta un mensaje que quedó "failed" (mismo nodo, vuelve a "sending"). */
  async retryMessage(tempId: string): Promise<void> {
    const conversationId = this._activeConversationId();
    const pending = this._conversations()
      .find(c => c.id === conversationId)
      ?.messages.find(m => m.id === tempId && m.status === 'failed');
    if (!conversationId || !pending?.text) {
      return;
    }
    this.upsertOwnMessage(conversationId, tempId, { ...pending, status: 'sending' });
    await this.deliverPending(conversationId, tempId, pending.text);
  }

  private async deliverPending(conversationId: string, tempId: string, text: string): Promise<void> {
    const ack = await this.socket.sendMessage(conversationId, text);
    if (!ack.ok) {
      console.warn('No se pudo enviar el mensaje:', ack.message);
      this.patchOwnMessage(conversationId, tempId, { status: 'failed' });
      // La burbuja "failed" ya ofrece reintentar; si fue por ir demasiado rápido, además se dice.
      if (isSocketRateLimited(ack.code)) {
        this.toast.error(SOCKET_RATE_LIMITED_MESSAGE);
      } else if (ack.code === 'Chat.Message.TooLong') {
        this.toast.error(MESSAGE_TOO_LONG_TEXT);
      }
      return;
    }
    const dto = ack.value.message;
    this.noteLatestTimestamp(conversationId, dto.createdAtUtc);
    const real = { ...this.toMessage(dto, this.auth.currentUser()?.id ?? null), renderKey: tempId };
    this._conversations.update(list =>
      list.map(c => {
        if (c.id !== conversationId) {
          return c;
        }
        // El broadcast del propio mensaje pudo llegar antes que el ack y ya ocupó el lugar del pendiente.
        if (c.messages.some(m => m.id === real.id)) {
          return { ...c, messages: c.messages.filter(m => m.id !== tempId) };
        }
        return { ...c, messages: c.messages.map(m => (m.id === tempId ? real : m)) };
      }),
    );
  }

  /** Inserta (o reemplaza por id) un mensaje propio en la conversación. */
  private upsertOwnMessage(conversationId: string, id: string, message: ChatMessage): void {
    this._conversations.update(list =>
      list.map(c => {
        if (c.id !== conversationId) {
          return c;
        }
        const exists = c.messages.some(m => m.id === id);
        return {
          ...c,
          messages: exists ? c.messages.map(m => (m.id === id ? message : m)) : [...c.messages, message],
        };
      }),
    );
  }

  private patchOwnMessage(conversationId: string, id: string, patch: Partial<ChatMessage>): void {
    this._conversations.update(list =>
      list.map(c =>
        c.id === conversationId ? { ...c, messages: c.messages.map(m => (m.id === id ? { ...m, ...patch } : m)) } : c,
      ),
    );
  }

  async sendAttachment(file: File): Promise<void> {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    this._uploadingAttachment.set(true);
    try {
      const fileId = await firstValueFrom(this.attachments.uploadAttachment(conversationId, file));
      const ack = await this.socket.sendAttachment(conversationId, fileId);
      if (!ack.ok) {
        console.warn('No se pudo enviar el adjunto:', ack.message);
        this.toast.error(isSocketRateLimited(ack.code) ? SOCKET_RATE_LIMITED_MESSAGE : "Couldn't send the attachment.");
        return;
      }
      this.appendMessage(ack.value.message, { name: file.name, size: formatBytes(file.size), fileId });
    } catch (err) {
      console.warn('No se pudo subir el adjunto:', toApiError(err).message);
      this.toast.error(throttleMessageOr(err, "Couldn't upload the attachment."));
    } finally {
      this._uploadingAttachment.set(false);
    }
  }

  /**
   * Descarga un adjunto con un ancla oculta (la presignada viene con content-disposition=attachment):
   * baja el archivo sin abrir una pestaña en blanco ni exponer la URL.
   */
  downloadAttachment(fileId: string, conversationId = this._activeConversationId()): void {
    if (!conversationId) {
      return;
    }
    this.chatService.getAttachmentDownloadUrl(conversationId, fileId).subscribe({
      next: res => {
        const anchor = document.createElement('a');
        anchor.href = res.downloadUrl;
        anchor.rel = 'noopener';
        anchor.download = '';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      },
      error: err => this.toast.error(toApiError(err).message),
    });
  }

  /** Ítem del visor global para un adjunto (la URL presignada se pide al mostrarlo). */
  attachmentViewerItem(fileId: string, name: string, conversationId = this._activeConversationId()): FileViewerItem {
    // F8d: tipo REAL (detectado) para que el visor elija bien; la URL la da Communication (membresía).
    const meta = this.attachmentMetaCache.get(fileId);
    return {
      name: meta?.fileName ?? name,
      contentType: meta?.contentType ?? null,
      sizeBytes: meta?.sizeBytes ?? null,
      resolveUrl: () => this.chatService.getAttachmentDownloadUrl(conversationId ?? '', fileId).pipe(map(res => res.downloadUrl)),
      ref: fileId,
    };
  }

  /** F8d: URL de un adjunto o nota de voz de la conversación activa (para el reproductor del hilo). */
  readonly attachmentUrlResolver = (fileId: string): Promise<string> => {
    const conversationId = this._activeConversationId() ?? '';
    return firstValueFrom(this.chatService.getAttachmentDownloadUrl(conversationId, fileId)).then(res => res.downloadUrl);
  };

  // ---------- F7: búsqueda de mensajes ----------

  /**
   * Busca en la conversación activa (`GET …/messages/search`): texto y transcripts de notas de voz. Con
   * menos de 2 caracteres limpia los resultados. Una búsqueda nueva cancela la que sigue en vuelo.
   */
  searchMessages(query: string): void {
    const conversationId = this._activeConversationId();
    const q = query.trim();
    this._searchQuery.set(query);
    this.messageSearchSub?.unsubscribe();
    this.messageSearchSub = null;
    this._searchError.set(null);
    if (!conversationId || q.length < MIN_CHAT_SEARCH_LENGTH) {
      this._searchResults.set([]);
      this._searchTruncated.set(false);
      this._searchLoading.set(false);
      return;
    }
    this._searchLoading.set(true);
    const currentUserId = this.auth.currentUser()?.id ?? null;
    this.messageSearchSub = this.chatService.searchMessages(conversationId, q, MESSAGE_SEARCH_LIMIT).subscribe({
      next: res => {
        this._searchResults.set(res.items.filter(dto => !dto.isDeleted).map(dto => this.toSearchResult(dto, currentUserId)));
        this._searchTruncated.set(res.truncated);
        this._searchLoading.set(false);
      },
      error: err => {
        this._searchResults.set([]);
        this._searchError.set(toApiError(err).message);
        this._searchLoading.set(false);
      },
    });
  }

  clearMessageSearch(): void {
    this.messageSearchSub?.unsubscribe();
    this.messageSearchSub = null;
    this._searchQuery.set('');
    this._searchResults.set([]);
    this._searchLoading.set(false);
    this._searchError.set(null);
    this._searchTruncated.set(false);
  }

  private toSearchResult(dto: MessageDto, currentUserId: string | null): ChatSearchResult {
    const isVoiceNote = dto.kind === 'Attachment' && (dto.audioDurationMs != null || !!dto.transcriptText);
    return {
      id: dto.id,
      senderName: currentUserId && dto.senderId === currentUserId ? 'You' : dto.senderDisplayName,
      text: (isVoiceNote ? dto.transcriptText : dto.body) ?? dto.body ?? dto.transcriptText ?? '',
      time: formatTime(dto.createdAtUtc),
      dateGroup: formatDateGroup(dto.createdAtUtc),
      isVoiceNote,
    };
  }

  /**
   * F7 — botón "Transcribe" de una nota de voz: se marca "Transcribing…" al instante y se pide al servidor;
   * si el pedido falla se vuelve al estado anterior y se avisa. El texto llega por `transcript_updated`.
   */
  requestVoiceNoteTranscript(messageId: string): void {
    const conversationId = this._activeConversationId();
    const message = this._conversations().find(c => c.id === conversationId)?.messages.find(m => m.id === messageId);
    if (!conversationId || !message?.voiceNote) return;
    const previous = message.voiceNote.transcriptState;
    const previousText = message.voiceNote.transcriptText ?? null;
    this.applyTranscriptUpdate({ conversationId, messageId, transcriptState: 'Processing', transcriptText: null });
    this.chatService.requestVoiceNoteTranscript(conversationId, messageId).subscribe({
      next: update => this.applyTranscriptUpdate(update),
      error: () => {
        this.applyTranscriptUpdate({ conversationId, messageId, transcriptState: previous ?? 'NotRequested', transcriptText: previousText });
        this.toast.error("Couldn't start the transcription. Try again.");
      },
    });
  }

  /** F7 — llegó (o falló) el transcript de una nota de voz: se parchea el mensaje si está cargado. */
  private applyTranscriptUpdate(update: MessageTranscriptUpdatedDto): void {
    const state = toVoiceNoteTranscriptState(update.transcriptState ?? update.state);
    this._conversations.update(list =>
      list.map(c =>
        c.id === update.conversationId && c.messages.some(m => m.id === update.messageId && m.voiceNote)
          ? {
              ...c,
              messages: c.messages.map(m =>
                m.id === update.messageId && m.voiceNote
                  ? { ...m, voiceNote: { ...m.voiceNote, transcriptState: state, transcriptText: update.transcriptText ?? null } }
                  : m,
              ),
            }
          : c,
      ),
    );
  }

  // ---------- Typing ----------

  /**
   * Lo llama el composer en cada pulsación (true) y al enviar/vaciar/blur (false). Throttlea el
   * socket: emite `typing.start` una sola vez y `typing.stop` tras {@link TYPING_IDLE_MS} de inactividad.
   */
  notifyTyping(isTyping: boolean): void {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    if (!isTyping) {
      this.stopTypingNow();
      return;
    }
    if (this.typingActiveConversationId !== conversationId) {
      this.stopTypingNow(); // por si cambió de conversación mientras escribía
      this.socket.typingStart(conversationId);
      this.typingActiveConversationId = conversationId;
    }
    clearTimeout(this.typingStopTimer);
    this.typingStopTimer = setTimeout(() => this.stopTypingNow(), TYPING_IDLE_MS);
  }

  private stopTypingNow(): void {
    clearTimeout(this.typingStopTimer);
    const active = this.typingActiveConversationId;
    if (active) {
      this.socket.typingStop(active);
      this.typingActiveConversationId = null;
    }
  }

  private applyIncomingTyping(dto: TypingDto, started: boolean): void {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    if (dto.userId === currentUserId) {
      return; // eco de mi propio typing
    }
    this.clearTypingExpiry(dto.conversationId, dto.userId);
    if (started) {
      this.setTypingName(dto.conversationId, dto.displayName);
      const key = `${dto.conversationId}:${dto.userId}`;
      this.typingExpiryTimers.set(
        key,
        setTimeout(() => {
          this.typingExpiryTimers.delete(key);
          this.setTypingName(dto.conversationId, null);
        }, TYPING_EXPIRY_MS),
      );
    } else {
      this.setTypingName(dto.conversationId, null);
    }
  }

  private clearTypingExpiry(conversationId: string, userId: string): void {
    const key = `${conversationId}:${userId}`;
    const existing = this.typingExpiryTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.typingExpiryTimers.delete(key);
    }
  }

  private setTypingName(conversationId: string, name: string | null): void {
    this._conversations.update(list => list.map(c => (c.id === conversationId ? { ...c, typingName: name } : c)));
  }

  // ---------- Notas de voz ----------

  /** Sube la nota grabada a la carpeta "Voice Notes" del tenant y la envía como adjunto de audio + metadata. */
  async sendVoiceNote(recorded: RecordedVoiceNote): Promise<void> {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    this._uploadingAttachment.set(true);
    try {
      // Extensión acorde al contenedor: audio/mp4 → .mp4 (CloudStorage mapea .mp4→video/mp4), resto → .webm.
      const ext = recorded.mimeType === 'audio/mp4' ? 'mp4' : 'webm';
      const file = new File([recorded.blob], `voice-note-${Date.now()}.${ext}`, { type: recorded.mimeType });
      const fileId = await firstValueFrom(this.attachments.uploadVoiceNote(conversationId, file));
      const ack = await this.socket.sendVoiceNote(conversationId, fileId, recorded.durationMs, recorded.waveform);
      if (!ack.ok) {
        console.warn('No se pudo enviar la nota de voz:', ack.message);
        this.toast.error(isSocketRateLimited(ack.code) ? SOCKET_RATE_LIMITED_MESSAGE : "Couldn't send the voice note.");
        return;
      }
      this.appendMessage(ack.value.message);
    } catch (err) {
      console.warn('No se pudo subir la nota de voz:', toApiError(err).message);
      this.toast.error(throttleMessageOr(err, "Couldn't upload the voice note."));
    } finally {
      this._uploadingAttachment.set(false);
    }
  }

  /** URL presignada de descarga para reproducir una nota de voz (la usa VoiceNotePlayback en el bubble). */
  resolveVoiceNoteUrl(fileId: string): Promise<string> {
    return this.attachmentUrlResolver(fileId);
  }

  // ---------- Recording indicator ----------

  /** Lo llama el composer al iniciar/parar la grabación. Emite start + heartbeat cada 12s; stop al parar. */
  notifyRecording(isRecording: boolean): void {
    const conversationId = this._activeConversationId();
    if (!conversationId) {
      return;
    }
    if (!isRecording) {
      this.stopRecordingNow();
      return;
    }
    if (this.recordingActiveConversationId !== conversationId) {
      this.stopRecordingNow();
      this.socket.recordingStart(conversationId);
      this.recordingActiveConversationId = conversationId;
      this.recordingHeartbeat = setInterval(() => this.socket.recordingStart(conversationId), RECORDING_HEARTBEAT_MS);
    }
  }

  private stopRecordingNow(): void {
    clearInterval(this.recordingHeartbeat);
    this.recordingHeartbeat = undefined;
    const active = this.recordingActiveConversationId;
    if (active) {
      this.socket.recordingStop(active);
      this.recordingActiveConversationId = null;
    }
  }

  private applyIncomingRecording(dto: TypingDto, started: boolean): void {
    const currentUserId = this.auth.currentUser()?.id ?? null;
    if (dto.userId === currentUserId) {
      return; // eco de mi propia grabación
    }
    const key = `${dto.conversationId}:${dto.userId}`;
    const existing = this.recordingExpiryTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.recordingExpiryTimers.delete(key);
    }
    if (started) {
      this.setRecordingName(dto.conversationId, dto.displayName);
      this.recordingExpiryTimers.set(
        key,
        setTimeout(() => {
          this.recordingExpiryTimers.delete(key);
          this.setRecordingName(dto.conversationId, null);
        }, RECORDING_EXPIRY_MS),
      );
    } else {
      this.setRecordingName(dto.conversationId, null);
    }
  }

  private setRecordingName(conversationId: string, name: string | null): void {
    this._conversations.update(list => list.map(c => (c.id === conversationId ? { ...c, recordingName: name } : c)));
  }

  /**
   * F8a (D-12): abre una conversación de otro módulo (el chat de un ticket en Support) con el mismo motor
   * (historial, envío, edición, adjuntos, eventos en vivo) sin que aparezca en la lista de Chat.
   */
  openEmbedded(conversationId: string, name: string): void {
    this.socket.connect();
    this.wireSocketEventsOnce();
    if (!this._conversations().some(c => c.id === conversationId)) {
      this.ensureOptimisticConversation(conversationId, name);
    }
    this._conversations.update(list => list.map(c => (c.id === conversationId ? { ...c, name, kind: 'Support', embedded: true } : c)));
    this.selectConversation(conversationId);
  }

  /** Cierra la conversación embebida al salir del módulo (la lista de Chat no cambia). */
  closeEmbedded(conversationId: string): void {
    if (this._activeConversationId() === conversationId) {
      this._activeConversationId.set(null);
    }
    this._conversations.update(list => list.filter(c => !(c.id === conversationId && c.embedded)));
  }

  private isEmbedded(conversationId: string): boolean {
    return this._conversations().some(c => c.id === conversationId && c.embedded);
  }

  /** La página ya navegó al módulo dueño. */
  clearRedirect(): void {
    this._redirect.set(null);
  }

  /** F8a: si la conversación es de Support o de una sala, sale de la lista y pide ir a su módulo. */
  private redirectToOwnerModule(conversationId: string, meta: ConversationMeta | undefined): boolean {
    if (!meta || CHAT_KINDS.includes(meta.kind)) {
      return false;
    }
    this._conversations.update(list => list.filter(c => c.id !== conversationId));
    if (this._activeConversationId() === conversationId) {
      this._activeConversationId.set(null);
    }
    if (meta.kind === 'Support') {
      this._redirect.set({ commands: ['/support'], queryParams: meta.supportTicketId ? { ticket: meta.supportTicketId } : {} });
    } else if (meta.kind === 'Meeting') {
      this._redirect.set({ commands: ['/meetings'], queryParams: meta.meetingId ? { meetingId: meta.meetingId } : {} });
    }
    return true;
  }

  // ---------- Editar / borrar mensaje ----------

  clearMessageActionError(): void {
    this._messageActionError.set(null);
  }

  /** Edita un mensaje propio. La UI se actualiza con el broadcast `chat.message.edited`. */
  async editMessage(messageId: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    this._messageActionError.set(null);
    const ack = await this.socket.editMessage(messageId, trimmed);
    if (!ack.ok) {
      this.reportMessageActionError(ack.code, editErrorMessage(ack.code) ?? "Couldn't edit the message.");
    }
  }

  /** F8 — versiones anteriores de un mensaje (al tocar "edited"). */
  loadMessageEdits(conversationId: string, messageId: string): Observable<MessageEditsDto> {
    return this.chatService.getMessageEdits(conversationId, messageId);
  }

  /** Borra (soft) un mensaje propio. La UI se actualiza con el broadcast `chat.message.deleted`. */
  async deleteMessage(messageId: string): Promise<void> {
    this._messageActionError.set(null);
    const ack = await this.socket.deleteMessage(messageId);
    if (!ack.ok) {
      this.reportMessageActionError(ack.code, "Couldn't delete the message.");
    }
  }

  // Ninguna vista pinta `messageActionError`: sin el toast, un fallo al editar/borrar pasaba en silencio.
  private reportMessageActionError(code: string, fallback: string): void {
    const message = isSocketRateLimited(code) ? SOCKET_RATE_LIMITED_MESSAGE : fallback;
    this._messageActionError.set(message);
    this.toast.error(message);
  }

  // ---------- Historial (scrollback) ----------

  /** Carga la página más vieja del hilo activo y la antepone (dedupe por id). Lo dispara el thread al llegar arriba. */
  loadOlderMessages(): void {
    const id = this._activeConversationId();
    if (!id || this._loadingOlder()) {
      return;
    }
    const cursor = this.historyCursorByConversation.get(id);
    if (!cursor) {
      return; // no hay más historial
    }
    this._loadingOlder.set(true);
    this.chatService.getMessages(id, { before: cursor, take: 50 }).subscribe({
      next: page => {
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const older = [...page.items].reverse().map(dto => this.toMessage(dto, currentUserId)); // DESC→ASC
        this._conversations.update(list =>
          list.map(c => {
            if (c.id !== id) {
              return c;
            }
            const existing = new Set(c.messages.map(m => m.id));
            const deduped = older.filter(m => !existing.has(m.id));
            return seedAvatarsFromHistory(
              { ...c, messages: [...deduped, ...c.messages], hasMoreHistory: page.nextBeforeUtc !== null },
              page.items,
              currentUserId,
            );
          }),
        );
        this.historyCursorByConversation.set(id, page.nextBeforeUtc);
        this._loadingOlder.set(false);
      },
      error: err => {
        this._loadingOlder.set(false);
        console.warn('No se pudo cargar más historial:', toApiError(err).message);
      },
    });
  }

  // ---------- Nueva conversación ----------

  /** F8c (T-14): primera página del rail Team (sin término = todos por nombre). */
  searchEmployees(term: string): void {
    const trimmed = term.trim() || null;
    this._customerResults.set([]); // solo una audiencia a la vez
    this.directoryTerm = trimmed;
    this.runDirectorySearch(this.directory.pageEmployees(trimmed), page => {
      this._employeeResults.set(page.items);
      this._directoryCursor.set(page.nextCursor ? { audience: 'team', cursor: page.nextCursor } : null);
    });
  }

  /** F8c (T-14): primera página del rail Clients (ABAC en el servidor). */
  searchCustomers(term: string): void {
    const trimmed = term.trim() || null;
    this._employeeResults.set([]); // solo una audiencia a la vez
    this.directoryTerm = trimmed;
    this.runDirectorySearch(this.directory.pageCustomers(trimmed), page => {
      this._customerResults.set(page.items);
      this._directoryCursor.set(page.nextCursor ? { audience: 'clients', cursor: page.nextCursor } : null);
    });
  }

  /** F8c: siguiente página de la audiencia actual ("Load more"). */
  loadMoreDirectory(): void {
    const next = this._directoryCursor();
    if (!next || this._employeeSearchLoading()) {
      return;
    }
    if (next.audience === 'team') {
      this.runDirectorySearch(this.directory.pageEmployees(this.directoryTerm, next.cursor), page => {
        this._employeeResults.update(list => [...list, ...page.items]);
        this._directoryCursor.set(page.nextCursor ? { audience: 'team', cursor: page.nextCursor } : null);
      });
    } else {
      this.runDirectorySearch(this.directory.pageCustomers(this.directoryTerm, next.cursor), page => {
        this._customerResults.update(list => [...list, ...page.items]);
        this._directoryCursor.set(page.nextCursor ? { audience: 'clients', cursor: page.nextCursor } : null);
      });
    }
  }

  /** Una búsqueda nueva cancela la que sigue en vuelo: así una respuesta vieja nunca pisa los resultados del texto actual. */
  private runDirectorySearch<T>(request: Observable<T>, apply: (result: T) => void): void {
    this.directorySearch?.unsubscribe();
    this._employeeSearchLoading.set(true);
    this._employeeSearchError.set(null);
    this.directorySearch = request.subscribe({
      next: result => {
        apply(result);
        this._employeeSearchLoading.set(false);
      },
      error: err => {
        this._employeeSearchError.set(toApiError(err).message);
        this._employeeSearchLoading.set(false);
      },
    });
  }

  private cancelDirectorySearch(): void {
    this.directorySearch?.unsubscribe();
    this.directorySearch = null;
    this._employeeSearchLoading.set(false);
  }

  resetNewConversationState(): void {
    this.cancelDirectorySearch();
    this._directoryCursor.set(null);
    this.directoryTerm = null;
    this._employeeResults.set([]);
    this._customerResults.set([]);
    this._employeeSearchError.set(null);
    this._newConversationError.set(null);
    this._creatingConversation.set(false);
  }

  async startDirectConversation(entry: EmployeeDirectoryEntry): Promise<boolean> {
    return this.startDirectWith(entry.userId, entry.displayName, entry.avatarFileId);
  }

  /**
   * Inicia (o reabre) el chat 1:1 con un cliente usando su `portalUserId`. Los clientes
   * sin cuenta de portal (`portalUserId == null`) no son chateables — la UI ni siquiera
   * ofrece la acción, así que esto es una guarda defensiva.
   */
  async startDirectWithCustomer(entry: CustomerDirectoryEntry): Promise<boolean> {
    if (!entry.portalUserId) {
      return false;
    }
    return this.startDirectWith(entry.portalUserId, entry.displayName, entry.avatarFileId);
  }

  /** Núcleo compartido de start_direct (empleado o cliente): mismo comando, mismo optimismo/navegación. */
  private async startDirectWith(
    recipientUserId: string,
    displayName: string,
    avatarFileId?: string | null,
  ): Promise<boolean> {
    this._creatingConversation.set(true);
    this._newConversationError.set(null);
    const ack = await this.socket.startDirectConversation(recipientUserId);
    this._creatingConversation.set(false);
    if (!ack.ok) {
      this._newConversationError.set(chatStartErrorMessage(ack.code, ack.message));
      return false;
    }
    this.ensureOptimisticConversation(ack.value.conversationId, displayName, {
      userId: recipientUserId,
      displayName,
      ...(avatarFileId !== undefined ? { avatarFileId } : {}),
    });
    this.selectConversation(ack.value.conversationId);
    return true;
  }

  /** F8b: miembros de equipo y clientes; el backend aplica la política única (T-18) y responde por código. */
  async createGroupConversation(title: string, memberUserIds: string[], description?: string): Promise<boolean> {
    this._creatingConversation.set(true);
    this._newConversationError.set(null);
    const ack = await this.socket.startGroupConversation(title, memberUserIds, description);
    this._creatingConversation.set(false);
    if (!ack.ok) {
      this._newConversationError.set(groupErrorMessage(ack.code));
      return false;
    }
    const summary = ack.value.conversation;
    if (summary && !this._conversations().some(c => c.id === summary.id)) {
      // T-12: la fila llega completa en el ack (miembros, roles); no hace falta releer la lista.
      const currentUserId = this.auth.currentUser()?.id ?? null;
      this._conversations.update(list => [this.toConversation(summary, currentUserId, []), ...list]);
    } else {
      this.ensureOptimisticConversation(ack.value.conversationId, title);
    }
    this.selectConversation(ack.value.conversationId);
    return true;
  }

  /** El ack de start_direct/start_group no trae title/participants — se arma la fila con lo que ya elegimos en el picker. */
  private ensureOptimisticConversation(id: string, name: string, peer?: ChatParticipant): void {
    if (this._conversations().some(c => c.id === id)) {
      return;
    }
    // Con el par elegido en el picker ya hay foto y color correctos antes de re-leer la lista.
    const conversation: ChatConversation = {
      id,
      name,
      kind: 'Direct',
      peerUserId: null,
      avatarColor: conversationAvatarColor(id, peer?.userId),
      avatarFileId: peer?.avatarFileId ?? null,
      participants: peer ? [peer] : [],
      presence: 'Offline',
      busyReason: null,
      typingName: null,
      recordingName: null,
      hasMoreHistory: false,
      unread: 0,
      messages: [],
    };
    this._conversations.update(list => [conversation, ...list]);
  }

  private toConversation(
    summary: ConversationSummary,
    currentUserId: string | null,
    lastMessages: MessageDto[],
  ): ChatConversation {
    const others = summary.participants.filter(p => p.userId !== currentUserId);
    const other = others[0];
    const participants = toChatParticipants(summary.participants);
    const peer = peerOf(participants, currentUserId);
    return {
      id: summary.id,
      name: summary.title ?? other?.displayName ?? 'Conversation',
      kind: summary.kind,
      // Solo hay "par" en un 1:1 real (2 participantes) — en grupo no aplica llamar.
      peerUserId: others.length === 1 ? others[0].userId : null,
      avatarColor: conversationAvatarColor(summary.id, peer?.userId),
      // Foto del par en un 1:1; los grupos van con iniciales.
      avatarFileId: peer?.avatarFileId ?? null,
      participants,
      // Sin estado inicial confiable del backend (la lista no lo trae) — se actualiza en vivo vía chat.presence.changed.
      presence: 'Offline',
      busyReason: null,
      typingName: null,
      recordingName: null,
      hasMoreHistory: false,
      unread: summary.unreadCount,
      messages: lastMessages.map(dto => this.toMessage(dto, currentUserId)),
      // F8b: datos del grupo, modo anuncio, silencio propio y mi rol (ausentes en backends viejos).
      description: summary.description ?? null,
      groupAvatarFileId: summary.avatarFileId ?? null,
      adminsOnlyWrite: summary.adminsOnlyWrite ?? false,
      isMuted: summary.isMuted ?? false,
      myRole: summary.myRole ?? null,
      ...(summary.isArchived !== undefined ? { isArchived: summary.isArchived } : {}),
    };
  }

  private toMessage(dto: MessageDto, currentUserId: string | null, knownAttachment?: ChatMessage['attachment']): ChatMessage {
    const isMine = !!currentUserId && dto.senderId === currentUserId;
    // Nota de voz: adjunto con metadata de audio (durationMs/waveform del backend). Se renderiza como
    // player en vez de tarjeta de archivo. Un adjunto normal no trae audioDurationMs/audioWaveform.
    const isVoice =
      !dto.isDeleted &&
      dto.kind === 'Attachment' &&
      !!dto.attachmentFileId &&
      (dto.audioDurationMs != null || (dto.audioWaveform?.length ?? 0) > 0);
    return {
      id: dto.id,
      senderId: isMine ? 'me' : 'them',
      // Remitente real de los ajenos: color por userId y foto (la vigente sale de los participantes).
      ...(isMine
        ? {}
        : {
            senderUserId: dto.senderId,
            senderName: dto.senderDisplayName,
            ...(dto.senderAvatarFileId !== undefined ? { senderAvatarFileId: dto.senderAvatarFileId } : {}),
          }),
      // System = evento del sistema en el hilo (p.ej. "Missed call", "Call ended 2:34") → se pinta centrado.
      isSystem: !dto.isDeleted && dto.kind === 'System',
      ...(dto.reactions?.length ? { reactions: dto.reactions } : {}),
      // F7 — System con archivo (transcript de la llamada): enlace "View transcript".
      ...(!dto.isDeleted && dto.kind === 'System' && dto.attachmentFileId ? { systemAttachmentFileId: dto.attachmentFileId } : {}),
      text:
        dto.isDeleted
          ? '(message deleted)'
          : dto.kind === 'Text' || dto.kind === 'System'
            ? (dto.body ?? undefined)
            : undefined,
      attachment:
        !dto.isDeleted && !isVoice && dto.kind === 'Attachment' && dto.attachmentFileId
          ? (knownAttachment ?? this.resolveAttachment(dto.conversationId, dto.attachmentFileId))
          : undefined,
      voiceNote: isVoice
        ? {
            fileId: dto.attachmentFileId!,
            durationMs: dto.audioDurationMs ?? 0,
            waveform: dto.audioWaveform ?? [],
            // F7 (D-27) — transcript bajo el reproductor (Processing → Ready/Failed/Skipped por socket).
            transcriptState: toVoiceNoteTranscriptState(dto.transcriptState),
            transcriptText: dto.transcriptText ?? null,
          }
        : undefined,
      time: formatTime(dto.createdAtUtc),
      dateGroup: formatDateGroup(dto.createdAtUtc),
      isEdited: dto.isEdited,
      editCount: dto.editCount ?? 0,
      isDeleted: dto.isDeleted,
      createdAtUtc: dto.createdAtUtc,
      // Cotejo inicial del historial (solo mis mensajes): el backend calcula entregado/leído del otro.
      status: isMine ? (dto.readAtUtc ? 'read' : dto.deliveredAtUtc ? 'delivered' : 'sent') : undefined,
    };
  }

  /**
   * Avanza los cotejos de MIS mensajes hasta `upToMessageId` (por createdAtUtc) al recibir un recibo
   * del otro. "read" implica "delivered"; monótono (nunca retrocede read→delivered→sent).
   */
  private advanceOwnReceipts(conversationId: string, upToMessageId: string, kind: 'delivered' | 'read'): void {
    this._conversations.update(list =>
      list.map(c => {
        if (c.id !== conversationId) {
          return c;
        }
        const upTo = c.messages.find(m => m.id === upToMessageId);
        if (!upTo) {
          return c;
        }
        const cutoff = upTo.createdAtUtc;
        const rank = { sent: 0, delivered: 1, read: 2 } as const;
        const next = kind === 'read' ? 'read' : 'delivered';
        return {
          ...c,
          messages: c.messages.map(m => {
            if (m.senderId !== 'me' || m.createdAtUtc > cutoff) {
              return m;
            }
            if (m.status === 'sending' || m.status === 'failed') {
              return m; // todavía no está en el servidor
            }
            const current = m.status ?? 'sent';
            return rank[next] > rank[current] ? { ...m, status: next } : m;
          }),
        };
      }),
    );
  }

  /**
   * MessageDto solo trae el fileId — arma un placeholder y pide la metadata a Communication una vez (cacheada):
   * nombre, tamaño, tipo real y estado del escaneo (F8d: Scanning/Unavailable en el hilo).
   */
  private resolveAttachment(conversationId: string, fileId: string): NonNullable<ChatMessage['attachment']> {
    const cached = this.attachmentMetaCache.get(fileId);
    if (cached) {
      return this.toAttachmentView(cached);
    }
    // Si la respuesta llega en el mismo ciclo (caché HTTP), se devuelve ya resuelta en vez del marcador.
    let resolved: NonNullable<ChatMessage['attachment']> | null = null;
    if (!this.pendingFileMetaLookups.has(fileId)) {
      this.pendingFileMetaLookups.add(fileId);
      this.chatService.getAttachmentMeta(conversationId, fileId).subscribe({
        next: meta => {
          this.pendingFileMetaLookups.delete(fileId);
          // Escaneando o en revisión: no se cachea para volver a preguntar al reabrir el hilo.
          if (meta.status !== 'Pending' && meta.status !== 'PendingReview') {
            this.attachmentMetaCache.set(fileId, meta);
          }
          const view = this.toAttachmentView(meta);
          resolved = view;
          this._conversations.update(list =>
            list.map(c => ({ ...c, messages: c.messages.map(m => (m.attachment?.fileId === fileId ? { ...m, attachment: view } : m)) })),
          );
        },
        error: () => this.pendingFileMetaLookups.delete(fileId),
      });
    }
    return resolved ?? { name: 'Attachment', size: '', fileId };
  }

  private toAttachmentView(meta: AttachmentMetaDto): NonNullable<ChatMessage['attachment']> {
    const status = toAttachmentScanState(meta.status);
    return { name: meta.fileName ?? 'Attachment', size: meta.sizeBytes != null ? formatBytes(meta.sizeBytes) : '', fileId: meta.fileId, status, contentType: meta.contentType };
  }

  /** Guarda el createdAtUtc más reciente por conversación (cursor `since` del backfill). Las fechas ISO UTC comparan lexicográfico = cronológico. */
  private noteLatestTimestamp(conversationId: string, createdAtUtc: string): void {
    const prev = this.lastMessageAtByConversation.get(conversationId);
    if (!prev || createdAtUtc > prev) {
      this.lastMessageAtByConversation.set(conversationId, createdAtUtc);
    }
  }

  /** La bandeja de Support abrió un ticket que tenía `count` mensajes sin leer: la burbuja baja lo mismo. */
  noteSupportRead(count: number): void {
    if (count > 0) this._supportUnread.update(n => Math.max(0, n - count));
  }

  private appendMessage(dto: MessageDto, knownAttachment?: ChatMessage['attachment']): void {
    if (dto.conversationKind === 'Support') {
      this.supportActivity$.next({
        conversationId: dto.conversationId,
        fromMe: dto.senderId === this.auth.currentUser()?.id,
        kind: dto.kind,
        body: dto.isDeleted ? null : (dto.body ?? null),
        createdAtUtc: dto.createdAtUtc,
        viewing: this.isEmbedded(dto.conversationId) && this.isViewing(dto.conversationId),
      });
    }
    // F8a (T-10): Support y la sala tienen su propio módulo; aquí solo cuentan para el badge de Support.
    if (dto.conversationKind && !CHAT_KINDS.includes(dto.conversationKind) && !this.isEmbedded(dto.conversationId)) {
      if (dto.conversationKind === 'Support' && dto.senderId !== this.auth.currentUser()?.id) {
        this._supportUnread.update(n => n + 1);
      }
      return;
    }
    this.noteLatestTimestamp(dto.conversationId, dto.createdAtUtc);
    const currentUserId = this.auth.currentUser()?.id ?? null;
    const message = this.toMessage(dto, currentUserId, knownAttachment);
    const fromOther = message.senderId === 'them';
    // F8c (T-15): "leído" solo si el hilo está realmente a la vista (página montada o embebido, pestaña visible).
    const isActive = this.isViewing(dto.conversationId);
    if (fromOther) {
      // Su mensaje llegó: el indicador de "typing" ya no aplica.
      this.clearTypingExpiry(dto.conversationId, dto.senderId);
      // Cotejos hacia el emisor: si tengo la conversación ABIERTA → leído (2 azules); si NO la tengo
      // abierta → solo entregado (2 grises). Estar conectado nunca equivale a haber leído.
      if (isActive) {
        void this.socket.markRead(dto.conversationId, dto.id);
        // Mensaje en la conversación que tengo abierta en /chat: sonido de "mensaje recibido".
        if (this.pageAttached()) {
          this.sounds.play('chat-message');
        }
      } else {
        void this.socket.markDelivered(dto.conversationId, dto.id);
      }
    }
    // Conversación aún NO en la lista (la oficina la creó y mandó el primer mensaje mientras estaba
    // en /chat, o se perdió el `conversation.created`): un `list.map` no la insertaría → sin fila ni
    // badge. Se re-lee la lista (trae la nueva con su unreadCount del server). Espeja al Portal.
    if (!this._conversations().some(c => c.id === dto.conversationId)) {
      this.refreshConversationList();
      return;
    }
    this._conversations.update(list =>
      list.map(c => {
        if (c.id !== dto.conversationId) {
          return c;
        }
        if (c.messages.some(m => m.id === message.id)) {
          return c; // ya insertado (ack local + broadcast del propio mensaje)
        }
        // Eco de MI mensaje que llega antes que el ack: ocupa el lugar del pendiente con el mismo texto
        // (heredando su renderKey) en vez de mostrarse duplicado hasta que llegue el ack.
        if (!fromOther && message.text) {
          const pending = c.messages.find(m => m.status === 'sending' && m.text === message.text);
          if (pending) {
            return {
              ...c,
              messages: c.messages.map(m => (m === pending ? { ...message, renderKey: pending.renderKey } : m)),
            };
          }
        }
        return {
          ...c,
          messages: [...c.messages, message],
          typingName: fromOther ? null : c.typingName,
          unread: isActive ? 0 : c.unread + (fromOther ? 1 : 0),
        };
      }),
    );
  }

  /** F8c (T-15): la conversación está abierta Y se ve (página de chat o embebida, y la pestaña visible). */
  private isViewing(conversationId: string): boolean {
    return (
      this._activeConversationId() === conversationId &&
      (this.pageAttached() || this.isEmbedded(conversationId)) &&
      this.documentVisible()
    );
  }

  /** F8c: cierra el hilo (vuelve al estado sin conversación). */
  closeConversation(): void {
    this.clearMessageSearch();
    this._activeConversationId.set(null);
  }

  /** Al volver a la pestaña con un hilo abierto, se marca leído lo que llegó mientras no se veía. */
  private onDocumentVisible(): void {
    const id = this._activeConversationId();
    if (!id || !this.isViewing(id)) {
      return;
    }
    const conv = this._conversations().find(c => c.id === id);
    const lastFromOther = conv?.messages.filter(m => m.senderId === 'them' && !m.status).at(-1);
    if (conv && conv.unread > 0 && lastFromOther) {
      void this.socket.markRead(id, lastFromOther.id);
    }
    this._conversations.update(list => list.map(c => (c.id === id ? { ...c, unread: 0 } : c)));
  }

  private wireSocketEventsOnce(): void {
    if (this.socketWired) {
      return;
    }
    this.socketWired = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.documentVisible.set(document.visibilityState !== 'hidden');
        if (this.documentVisible()) {
          this.onDocumentVisible();
        }
      });
    }

    this.socket.messageNew$.subscribe(dto => this.appendMessage(dto));

    // La oficina creó (o me añadió a) una conversación estando yo en /chat: el payload es delgado (sin
    // participants/unreadCount), así que re-leo la lista completa para que la fila y su badge aparezcan
    // sin recargar. Solo si aún no la tengo (evita refetch redundante cuando ya la insertó un mensaje).
    this.socket.conversationCreated$.subscribe(summary => {
      if (!this._conversations().some(c => c.id === summary.id)) {
        this.refreshConversationList();
      }
    });

    // Alguien sumó un miembro: si ya tengo la conversación entra con su foto; si me sumaron a mí, re-leo la lista.
    this.socket.participantAdded$.subscribe(added => {
      if (!added?.conversationId) {
        return;
      }
      if (!this._conversations().some(c => c.id === added.conversationId)) {
        this.refreshConversationList();
        return;
      }
      const currentUserId = this.auth.currentUser()?.id ?? null;
      const participant: ChatParticipant = {
        userId: added.newParticipantUserId,
        displayName: added.newParticipantDisplayName,
        role: 'Member',
        ...(added.newParticipantActorType ? { actorType: added.newParticipantActorType } : {}),
        ...(added.newParticipantAvatarFileId !== undefined ? { avatarFileId: added.newParticipantAvatarFileId } : {}),
      };
      this._conversations.update(list =>
        list.map(c => (c.id === added.conversationId ? addParticipant(c, participant, currentUserId) : c)),
      );
    });

    // F8a: archivado; F8b: datos del grupo, modo anuncio y silencio propio.
    this.socket.conversationUpdated$.subscribe(update => {
      if (!update?.conversationId) {
        return;
      }
      this._conversations.update(list =>
        list.map(c => (c.id === update.conversationId ? applyConversationUpdate(c, update) : c)),
      );
    });

    // F8b: salió o lo sacaron. Si soy yo, el grupo sale de la lista con aviso; si no, se quita al miembro.
    this.socket.participantRemoved$.subscribe(removed => {
      if (!removed?.conversationId) {
        return;
      }
      const currentUserId = this.auth.currentUser()?.id ?? null;
      if (removed.removedParticipantUserId === currentUserId) {
        const conv = this._conversations().find(c => c.id === removed.conversationId);
        this._conversations.update(list => list.filter(c => c.id !== removed.conversationId));
        if (this._activeConversationId() === removed.conversationId) {
          this._activeConversationId.set(null);
        }
        if (conv && removed.reason === 'Kicked' && removed.removedByUserId !== currentUserId) {
          this.toast.info(`You were removed from ${conv.name}.`);
        }
        return;
      }
      this._conversations.update(list =>
        list.map(c => (c.id === removed.conversationId ? removeParticipantFrom(c, removed.removedParticipantUserId, currentUserId) : c)),
      );
    });

    // F8b (D-22): roles en vivo (incluida la sucesión automática).
    this.socket.roleChanged$.subscribe(change => {
      if (!change?.conversationId) {
        return;
      }
      const currentUserId = this.auth.currentUser()?.id ?? null;
      this._conversations.update(list =>
        list.map(c => (c.id === change.conversationId ? applyRoleChange(c, change, currentUserId) : c)),
      );
    });

    // Un miembro del staff cambió su foto/nombre: se actualiza en todas las conversaciones donde participa.
    this.socket.userProfileChanged$.subscribe(change => this.applyProfileChange(change));

    this.socket.messageEdited$.subscribe(edit => {
      this._conversations.update(list =>
        list.map(c =>
          c.id === edit.conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === edit.messageId
                    ? { ...m, text: edit.body, isEdited: true, editCount: edit.editCount ?? (m.editCount ?? 0) + 1 }
                    : m,
                ),
              }
            : c,
        ),
      );
    });

    this.socket.messageDeleted$.subscribe(del => {
      this._conversations.update(list =>
        list.map(c =>
          c.id === del.conversationId
            ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === del.messageId
                    ? { ...m, text: '(message deleted)', attachment: undefined, isDeleted: true }
                    : m,
                ),
              }
            : c,
        ),
      );
    });

    this.socket.presenceChanged$.subscribe(presence => {
      this._conversations.update(list =>
        list.map(c =>
          this.otherParticipantByConversation.get(c.id) === presence.userId
            ? { ...c, presence: presence.status, busyReason: presence.busyReason }
            : c,
        ),
      );
    });

    // Typing entrante: refleja "… is typing" y auto-expira por si no llega el stop.
    this.socket.typingStarted$.subscribe(dto => this.applyIncomingTyping(dto, true));
    this.socket.typingStopped$.subscribe(dto => this.applyIncomingTyping(dto, false));

    this.socket.recordingStarted$.subscribe(dto => this.applyIncomingRecording(dto, true));
    this.socket.recordingStopped$.subscribe(dto => this.applyIncomingRecording(dto, false));

    // Cotejos LEÍDO (2 azules): el otro abrió la conversación y leyó hasta lastReadMessageId.
    this.socket.messageRead$.subscribe(receipt => {
      const currentUserId = this.auth.currentUser()?.id ?? null;
      if (receipt.userId === currentUserId) {
        return; // mi propia lectura, no el "visto" del otro
      }
      this.advanceOwnReceipts(receipt.conversationId, receipt.lastReadMessageId, 'read');
    });

    // Cotejos ENTREGADO (2 grises): el otro recibió hasta upToMessageId SIN abrir el chat.
    this.socket.messageDelivered$.subscribe(receipt => {
      const currentUserId = this.auth.currentUser()?.id ?? null;
      if (receipt.userId === currentUserId) {
        return;
      }
      this.advanceOwnReceipts(receipt.conversationId, receipt.upToMessageId, 'delivered');
    });

    // F7 — transcript de nota de voz listo / fallido / omitido.
    this.socket.messageTranscriptUpdated$.subscribe(update => this.applyTranscriptUpdate(update));

    this.socket.attachmentFlagged$.subscribe(flag => {
      // T-20: aprobado tras revisión — se vuelve a pedir la metadata para mostrarlo con su nombre y tamaño.
      if (flag.status === 'Available') {
        this.attachmentMetaCache.delete(flag.fileId);
        this.resolveAttachment(flag.conversationId, flag.fileId);
        return;
      }
      const status = toAttachmentScanState(flag.status);
      this._conversations.update(list =>
        list.map(c =>
          c.id === flag.conversationId
            ? {
                ...c,
                // F8d: queda en su lugar sin abrir ni descargar ("Under review", "Blocked…" o "Unavailable").
                messages: c.messages.map(m =>
                  m.id === flag.messageId && m.attachment ? { ...m, attachment: { ...m.attachment, status } } : m,
                ),
              }
            : c,
        ),
      );
    });

    // F8d (T-26): reacciones en vivo (las mías también vuelven como evento).
    this.socket.reactionAdded$.subscribe(change => this.applyReactionChange(change, +1));
    this.socket.reactionRemoved$.subscribe(change => this.applyReactionChange(change, -1));

    // Reconexión: tras un corte, el server pudo emitir mensajes que este cliente no recibió.
    // Se refresca la lista (no-leídos/orden/nuevas) y se rellena el hilo activo con `?since=`.
    // (session.revoked lo maneja el shell, filtrado por sid — no se toca el socket acá.)
    this.socket.reconnected$.subscribe(() => this.resync());
  }

  /** F8d: agrega o quita la reacción propia según si ya está puesta; el estado lo trae el evento. */
  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    const me = this.auth.currentUser()?.id ?? null;
    const message = this._conversations().flatMap(c => c.messages).find(m => m.id === messageId);
    const mine = hasMyReaction(message?.reactions, emoji, me);
    const ack = mine ? await this.socket.removeReaction(messageId, emoji) : await this.socket.addReaction(messageId, emoji);
    if (!ack.ok) {
      this.toast.error(reactionErrorText(ack.code));
    }
  }

  private applyReactionChange(change: MessageReactionChangedDto, delta: 1 | -1): void {
    if (!change?.messageId) {
      return;
    }
    this._conversations.update(list =>
      list.map(c =>
        c.id !== change.conversationId
          ? c
          : { ...c, messages: c.messages.map(m => (m.id === change.messageId ? { ...m, reactions: applyReaction(m.reactions ?? [], change, delta) } : m)) },
      ),
    );
  }

  /** Aplica `user.profile.changed` (match por userId; campo ausente = se conserva, null = sin foto). */
  applyProfileChange(change: UserProfileChangedEvent | null | undefined): void {
    if (!change?.userId) {
      return;
    }
    const currentUserId = this.auth.currentUser()?.id ?? null;
    const list = this._conversations();
    const next = list.map(c => applyProfileChangeToConversation(c, change, currentUserId));
    if (next.some((c, i) => c !== list[i])) {
      this._conversations.set(next);
    }
  }

  /** Tras reconectar: refresca la lista y rellena el hilo activo con lo perdido durante el corte. */
  private resync(): void {
    this.refreshConversationList();
    const activeId = this._activeConversationId();
    if (!activeId) {
      return;
    }
    // La presencia solo llega en transiciones: durante el corte se perdió el `presence.changed` del par
    // (p.ej. su llamada terminó y pasó a Online), y sin re-consultarlo se queda "In a call" pegado hasta
    // refrescar. Se pide el snapshot actual del peer (la respuesta entra por el mismo `presenceChanged$`).
    const peerUserId = this.otherParticipantByConversation.get(activeId);
    if (peerUserId) {
      this.socket.queryPresence([peerUserId]);
    }
    const since = this.lastMessageAtByConversation.get(activeId);
    this.chatService.getMessages(activeId, since ? { since } : { take: 50 }).subscribe({
      next: page => {
        page.items.forEach(dto => this.appendMessage(dto)); // appendMessage deduplica por id
        const last = page.items[page.items.length - 1];
        if (last) {
          void this.socket.markRead(activeId, last.id);
        }
      },
      error: err => console.warn('No se pudo re-sincronizar el hilo tras reconectar:', toApiError(err).message),
    });
  }

  /** Re-lee la lista (no-leídos + orden + conversaciones nuevas) sin descartar los mensajes ya cargados. */
  private refreshConversationList(): void {
    this.chatService.listConversations({ size: 50, kinds: CHAT_KINDS }).subscribe({
      next: result => {
        this._supportUnread.set(result.unreadByKind?.Support ?? 0);
        const currentUserId = this.auth.currentUser()?.id ?? null;
        const activeId = this._activeConversationId();
        const existing = new Map(this._conversations().map(c => [c.id, c]));
        const merged = result.items.map(summary => {
          const other = summary.participants.find(p => p.userId !== currentUserId);
          if (other) {
            this.otherParticipantByConversation.set(summary.id, other.userId);
          }
          const prev = existing.get(summary.id);
          if (prev) {
            // Conserva mensajes/estado local; el hilo activo se mantiene en 0 (se marca leído aparte).
            // Los participantes sí se refrescan (fotos nuevas), sin perder una foto si el DTO no la trae.
            const participants = toChatParticipants(summary.participants, prev.participants);
            return withParticipants(
              { ...prev, unread: activeId === summary.id ? 0 : summary.unreadCount },
              participants,
              currentUserId,
            );
          }
          return this.toConversation(summary, currentUserId, []);
        });
        const embedded = this._conversations().filter(c => c.embedded && !merged.some(m => m.id === c.id));
        this._conversations.set([...merged, ...embedded]);
      },
      error: err =>
        console.warn('No se pudo refrescar la lista de conversaciones tras reconectar:', toApiError(err).message),
    });
  }
}
