import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { skip } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ChatConversationListComponent } from '../../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatThreadComponent, ChatMessage, MessageEdit } from '../../ui/chat-thread/chat-thread.component';
import { ChatComposerComponent } from '../../ui/chat-composer/chat-composer.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ActiveCallService } from '@core/communication/active-call.service';
import {
  DirectorySearch,
  GroupCreateRequest,
  NewConversationModalComponent,
} from '../../ui/new-conversation-modal/new-conversation-modal.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import {
  CustomerDirectoryEntry,
  EmployeeDirectoryEntry,
  presenceDotClass,
  presenceLabel,
  presenceTextClass,
} from '../../data-access/chat.model';
import { ChatStore } from '../../data-access/chat.store';

/**
 * Página del módulo Chat (estilo "Aether"): mensajería interna de equipo,
 * no el AI Assistant. Rail de conversaciones a la izquierda + hilo activo a
 * la derecha. Datos reales vía ChatStore (Communication: lista/historial
 * por HTTP, enviar/recibir + nueva conversación + adjuntos en vivo por
 * Socket.IO) — deja fuera de esta conexión: reacciones, editar/borrar
 * mensajes, y video-llamadas (fuera de alcance del feature).
 */
@Component({
  selector: 'app-chat-page',
  imports: [
    CommonModule,
    ChatConversationListComponent,
    ChatThreadComponent,
    ChatComposerComponent,
    ModalComponent,
    NewConversationModalComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent {
  private readonly store = inject(ChatStore);
  private readonly activeCall = inject(ActiveCallService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly canStartAudioCall = this.store.canStartAudioCall;
  readonly canStartVideoCall = this.store.canStartVideoCall;
  readonly callPhase = this.activeCall.phase;

  readonly conversations = this.store.conversations;
  readonly loading = this.store.loading;
  readonly loadError = this.store.error;
  readonly activeConversationId = computed(() => this.store.activeConversationId() ?? '');
  readonly uploadingAttachment = this.store.uploadingAttachment;

  readonly isInfoOpen = signal(false);
  readonly isNewConversationOpen = signal(false);
  readonly loadingOlder = this.store.loadingOlder;
  private readonly pendingDeleteId = signal<string | null>(null);
  readonly isDeleteConfirmOpen = computed(() => this.pendingDeleteId() !== null);

  readonly employeeResults = this.store.employeeResults;
  readonly customerResults = this.store.customerResults;
  readonly employeeSearchLoading = this.store.employeeSearchLoading;
  readonly employeeSearchError = this.store.employeeSearchError;
  readonly newConversationError = this.store.newConversationError;
  readonly creatingConversation = this.store.creatingConversation;
  readonly canCreateGroups = this.store.canCreateGroups;

  constructor() {
    // Deep-link opcional `?conversation=<id>` (p. ej. desde un ticket de Support): abre esa.
    const preferId = this.route.snapshot.queryParamMap.get('conversation');
    this.store.load(preferId ?? undefined);
    // Si el param cambia estando ya en la página, enfocá la nueva conversación.
    this.route.queryParamMap.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('conversation');
      if (id && id !== this.store.activeConversationId()) {
        this.store.focusConversation(id);
      }
    });
  }

  get isActiveSupport(): boolean {
    return this.activeConversation.kind === 'Support';
  }

  /** Es un 1:1 llamable (Direct/Support con par conocido). */
  private get isCallableConversation(): boolean {
    const conv = this.activeConversation;
    return !!conv.peerUserId && (conv.kind === 'Direct' || conv.kind === 'Support');
  }

  get canCallActiveConversation(): boolean {
    return this.isCallableConversation && this.canStartAudioCall();
  }

  get canVideoCallActiveConversation(): boolean {
    return this.isCallableConversation && this.canStartVideoCall();
  }

  startAudioCall(): void {
    this.startCall('Audio');
  }

  startVideoCall(): void {
    this.startCall('Video');
  }

  private startCall(kind: 'Audio' | 'Video'): void {
    const conv = this.activeConversation;
    if (!conv.peerUserId) {
      return;
    }
    void this.activeCall.startCall(conv.peerUserId, conv.name, kind, conv.id);
  }

  get activeConversation() {
    return (
      this.conversations().find(conv => conv.id === this.store.activeConversationId()) ?? {
        id: '',
        name: '',
        kind: 'Direct' as const,
        peerUserId: null,
        avatarColor: 'bg-brand-bold',
        presence: 'Offline' as const,
        busyReason: null,
        typingName: null,
        readUpToMessageId: null,
        hasMoreHistory: false,
        unread: 0,
        messages: [] as ChatMessage[],
      }
    );
  }

  get sharedAttachments(): { name: string; size: string; fileId: string }[] {
    return this.activeConversation.messages
      .filter(
        (message): message is ChatMessage & { attachment: { name: string; size: string; fileId: string } } =>
          !!message.attachment,
      )
      .map(message => message.attachment);
  }

  openInfo(): void {
    this.isInfoOpen.set(true);
  }

  closeInfo(): void {
    this.isInfoOpen.set(false);
  }

  selectConversation(id: string): void {
    this.store.selectConversation(id);
  }

  sendMessage(text: string): void {
    void this.store.sendMessage(text);
  }

  onTyping(isTyping: boolean): void {
    this.store.notifyTyping(isTyping);
  }

  // Presencia del participante activo (etiqueta/colores accesibles, no solo color).
  get presenceLabel(): string {
    return presenceLabel(this.activeConversation.presence, this.activeConversation.busyReason);
  }

  get presenceDotClass(): string {
    return presenceDotClass(this.activeConversation.presence);
  }

  get presenceTextClass(): string {
    return presenceTextClass(this.activeConversation.presence);
  }

  get showPresenceDot(): boolean {
    return this.activeConversation.presence !== 'Offline';
  }

  onAttach(file: File): void {
    void this.store.sendAttachment(file);
  }

  onAttachmentClicked(fileId: string): void {
    this.store.downloadAttachment(fileId);
  }

  onLoadOlder(): void {
    this.store.loadOlderMessages();
  }

  onEditSubmitted(edit: MessageEdit): void {
    void this.store.editMessage(edit.id, edit.text);
  }

  onDeleteRequested(messageId: string): void {
    this.pendingDeleteId.set(messageId);
  }

  confirmDelete(): void {
    const id = this.pendingDeleteId();
    if (id) {
      void this.store.deleteMessage(id);
    }
    this.pendingDeleteId.set(null);
  }

  cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  openNewConversation(): void {
    this.store.resetNewConversationState();
    this.isNewConversationOpen.set(true);
  }

  closeNewConversation(): void {
    this.isNewConversationOpen.set(false);
  }

  onDirectorySearch(search: DirectorySearch): void {
    if (search.audience === 'clients') {
      this.store.searchCustomers(search.term);
    } else {
      this.store.searchEmployees(search.term);
    }
  }

  async onDirectSelected(entry: EmployeeDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectConversation(entry);
    if (ok) {
      this.isNewConversationOpen.set(false);
    }
  }

  async onCustomerSelected(entry: CustomerDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectWithCustomer(entry);
    if (ok) {
      this.isNewConversationOpen.set(false);
    }
  }

  async onGroupCreateRequested(request: GroupCreateRequest): Promise<void> {
    const ok = await this.store.createGroupConversation(request.title, request.members);
    if (ok) {
      this.isNewConversationOpen.set(false);
    }
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
