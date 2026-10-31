import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatThreadComponent } from '@shared/ui/chat/chat-thread/chat-thread.component';
import { ChatComposerComponent } from '@shared/ui/chat/chat-composer/chat-composer.component';
import { MessageEditsDialogComponent } from '@shared/ui/chat/message-edits-dialog/message-edits-dialog.component';
import type { ChatMessage, MessageEdit, MessageEditsDto } from '@shared/ui/chat/chat-message.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import type { FileViewerDownload, FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import type { RecordedVoiceNote } from '@core/communication/voice-note-recorder.service';
import { ChatStore } from '../../data-access/chat.store';
import { AuthService } from '@core/auth/auth.service';
import { canWriteInGroup, isGroupAdmin } from '../../data-access/chat-groups';
import type { ChatConversation } from '../../ui/chat-conversation-list/chat-conversation-list.component';

/**
 * T-11 — hilo + composer de la conversación activa del ChatStore, con sus diálogos (versiones de un mensaje,
 * confirmar borrado, visor de adjuntos). Lo usan el módulo Chat y Support (D-12) para no duplicar el motor.
 * Un chat archivado (meeting terminado, ticket cerrado) se muestra en solo lectura.
 */
@Component({
  selector: 'app-chat-conversation-panel',
  imports: [CommonModule, ChatThreadComponent, ChatComposerComponent, MessageEditsDialogComponent, ConfirmDialogComponent, FileViewerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <div class="min-h-0 flex-1">
      <app-chat-thread [messages]="conversation.messages" [otherName]="conversation.name"
        [otherAvatarColor]="conversation.avatarColor" [participants]="conversation.participants ?? []"
        [conversationId]="conversation.id"
        [typingName]="conversation.typingName" [recordingName]="conversation.recordingName"
        [hasMoreHistory]="conversation.hasMoreHistory" [loadingOlder]="store.loadingOlder()"
        [editPolicy]="conversation.editPolicy" [canModerate]="canModerate"
        [reactionCatalog]="conversation.reactionPolicy?.catalog ?? []" [maxReactionsPerUser]="conversation.reactionPolicy?.maxPerUser ?? 3"
        [canReact]="canReact" [currentUserId]="currentUserId()" [attachmentUrlResolver]="store.attachmentUrlResolver"
        (reactionToggled)="store.toggleReaction($event.messageId, $event.emoji)" (editsRequested)="onEditsRequested($event)" (editExpired)="onEditExpired()"
        (attachmentClicked)="openAttachment($event)" (loadOlder)="store.loadOlderMessages()"
        (editSubmitted)="onEditSubmitted($event)" (deleteRequested)="pendingDeleteId.set($event)"
        (retryRequested)="store.retryMessage($event)" (transcriptRequested)="onTranscriptRequested($event)"
        (voiceTranscriptRequested)="store.requestVoiceNoteTranscript($event)"></app-chat-thread>
    </div>

    <div class="border-t border-gray-100 pt-3 sm:pt-4">
      @if (conversation.isArchived) {
        <!-- F8a: chat archivado (meeting terminado, ticket cerrado) = solo lectura -->
        <p data-role="conversation-closed" class="rounded-2xl bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">{{ closedLabel }}</p>
      } @else if (!canWrite) {
        <!-- F8b (D-23): modo anuncio -->
        <p data-role="admins-only" class="rounded-2xl bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">Only admins can send messages in this group.</p>
      } @else {
        <app-chat-composer [uploading]="store.uploadingAttachment()" (send)="store.sendMessage($event)"
          (attach)="store.sendAttachment($event)" (typing)="store.notifyTyping($event)"
          (sendVoiceNote)="onSendVoiceNote($event)" (recording)="store.notifyRecording($event)"></app-chat-composer>
      }
    </div>

    <!-- F8: versiones de un mensaje editado -->
    <app-message-edits-dialog [isOpen]="!!editsTarget()" [edits]="edits()" [loading]="editsLoading()" [error]="editsError()"
      (closed)="editsTarget.set(null)" />

    <app-confirm-dialog [isOpen]="isDeleteConfirmOpen()" heading="Delete message"
      message="This message will be removed for everyone in the conversation. This can't be undone." confirmLabel="Delete"
      (confirmed)="confirmDelete()" (cancelled)="pendingDeleteId.set(null)"></app-confirm-dialog>

    <!-- Visor global de adjuntos -->
    <app-file-viewer [isOpen]="viewerOpen()" [files]="viewerFiles()" [startIndex]="viewerIndex()"
      (indexChange)="viewerIndex.set($event)" (download)="onViewerDownload($event)"
      (closed)="viewerOpen.set(false)"></app-file-viewer>
  `,
})
export class ChatConversationPanelComponent {
  protected readonly store = inject(ChatStore);
  private readonly auth = inject(AuthService);
  protected readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) conversation!: ChatConversation;
  /** Texto cuando el chat está en solo lectura (Support dice "This ticket is closed."). */
  @Input() closedLabel = 'This conversation is closed.';

  @ViewChild(ChatThreadComponent) private thread?: ChatThreadComponent;

  /** F8d: reaccionar en un chat activo (archivado = solo lectura). */
  get canReact(): boolean {
    return !this.conversation.isArchived && !!this.conversation.reactionPolicy;
  }

  get canWrite(): boolean {
    return canWriteInGroup(this.conversation);
  }

  /** F8b: en su grupo, Owner/Admin borran mensajes ajenos (el backend lo valida igual). */
  get canModerate(): boolean {
    return this.conversation.kind === 'Group' && !this.conversation.isArchived && isGroupAdmin(this.conversation.myRole);
  }

  readonly pendingDeleteId = signal<string | null>(null);
  readonly isDeleteConfirmOpen = computed(() => this.pendingDeleteId() !== null);

  readonly viewerOpen = signal(false);
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

  /** F8 — mensaje cuyas versiones se están viendo (null = cerrado). */
  readonly editsTarget = signal<string | null>(null);
  readonly edits = signal<MessageEditsDto | null>(null);
  readonly editsLoading = signal(false);
  readonly editsError = signal<string | null>(null);

  /** Salta al mensaje si está cargado (búsqueda de la página). */
  scrollToMessage(messageId: string): boolean {
    return this.thread?.scrollToMessage(messageId) ?? false;
  }

  /** Abre el adjunto en el visor y navega entre los adjuntos cargados; si no está cargado, lo descarga. */
  openAttachment(fileId: string): void {
    const attachments = this.conversation.messages
      .filter((m): m is ChatMessage & { attachment: NonNullable<ChatMessage['attachment']> } => !m.isDeleted && !!m.attachment)
      .map(m => m.attachment)
      // F8d: los que siguen escaneando o fueron rechazados no se abren.
      .filter(a => a.status !== 'Pending' && a.status !== 'Unavailable');
    if (!attachments.some(a => a.fileId === fileId)) {
      this.store.downloadAttachment(fileId);
      return;
    }
    this.viewerFiles.set(attachments.map(a => this.store.attachmentViewerItem(a.fileId, a.name)));
    this.viewerIndex.set(attachments.findIndex(a => a.fileId === fileId));
    this.viewerOpen.set(true);
  }

  /** F8d: abre un archivo suelto (desde las pestañas de Info, aunque no esté cargado en el hilo). */
  openFile(fileId: string, name: string): void {
    this.viewerFiles.set([this.store.attachmentViewerItem(fileId, name)]);
    this.viewerIndex.set(0);
    this.viewerOpen.set(true);
  }

  /** F7 — "View transcript" de un mensaje del sistema (transcript de la llamada). */
  onTranscriptRequested(fileId: string): void {
    this.viewerFiles.set([this.store.attachmentViewerItem(fileId, 'Call transcript.txt')]);
    this.viewerIndex.set(0);
    this.viewerOpen.set(true);
  }

  onViewerDownload(event: FileViewerDownload): void {
    this.store.downloadAttachment(event.item.ref as string);
  }

  onSendVoiceNote(recorded: RecordedVoiceNote): void {
    void this.store.sendVoiceNote(recorded);
  }

  onEditSubmitted(edit: MessageEdit): void {
    void this.store.editMessage(edit.id, edit.text);
  }

  onEditExpired(): void {
    this.toast.error('This message can no longer be edited.');
  }

  onEditsRequested(messageId: string): void {
    this.editsTarget.set(messageId);
    this.edits.set(null);
    this.editsError.set(null);
    this.editsLoading.set(true);
    this.store.loadMessageEdits(this.conversation.id, messageId).subscribe({
      next: edits => {
        this.edits.set(edits);
        this.editsLoading.set(false);
      },
      error: () => {
        this.editsError.set("Couldn't load the edit history.");
        this.editsLoading.set(false);
      },
    });
  }

  confirmDelete(): void {
    const id = this.pendingDeleteId();
    if (id) void this.store.deleteMessage(id);
    this.pendingDeleteId.set(null);
  }
}
