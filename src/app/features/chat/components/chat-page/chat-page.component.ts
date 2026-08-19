import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatConversationListComponent } from '../../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatThreadComponent, ChatMessage } from '../../ui/chat-thread/chat-thread.component';
import { ChatComposerComponent } from '../../ui/chat-composer/chat-composer.component';
import { GroupCreateRequest, NewConversationModalComponent } from '../../ui/new-conversation-modal/new-conversation-modal.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { EmployeeDirectoryEntry } from '../../data-access/chat.model';
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
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent {
  private readonly store = inject(ChatStore);

  readonly conversations = this.store.conversations;
  readonly loading = this.store.loading;
  readonly loadError = this.store.error;
  readonly activeConversationId = computed(() => this.store.activeConversationId() ?? '');
  readonly uploadingAttachment = this.store.uploadingAttachment;

  readonly isInfoOpen = signal(false);
  readonly isNewConversationOpen = signal(false);

  readonly employeeResults = this.store.employeeResults;
  readonly employeeSearchLoading = this.store.employeeSearchLoading;
  readonly employeeSearchError = this.store.employeeSearchError;
  readonly newConversationError = this.store.newConversationError;
  readonly creatingConversation = this.store.creatingConversation;
  readonly canCreateGroups = this.store.canCreateGroups;

  constructor() {
    this.store.load();
  }

  get activeConversation() {
    return (
      this.conversations().find(conv => conv.id === this.store.activeConversationId()) ?? {
        id: '',
        name: '',
        avatarColor: 'bg-gray-900',
        online: false,
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

  onAttach(file: File): void {
    void this.store.sendAttachment(file);
  }

  onAttachmentClicked(fileId: string): void {
    this.store.downloadAttachment(fileId);
  }

  openNewConversation(): void {
    this.store.resetNewConversationState();
    this.isNewConversationOpen.set(true);
  }

  closeNewConversation(): void {
    this.isNewConversationOpen.set(false);
  }

  onEmployeeSearch(term: string): void {
    this.store.searchEmployees(term);
  }

  async onDirectSelected(entry: EmployeeDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectConversation(entry);
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
