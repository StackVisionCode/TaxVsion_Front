import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import { ChatSocketService } from './chat-socket.service';
import { ChatService } from './chat.service';
import { SocketAck } from './chat.model';
import { groupErrorMessage } from './chat-groups';

/**
 * F8b: acciones de administración de grupos (D-22, D-23, T-21) y silencio propio. Solo emite el comando y avisa
 * del error por código: el estado se actualiza con los eventos en vivo (`participant_*`, `conversation.updated`),
 * que el backend manda también a quien hizo la acción, así no hay dos fuentes de verdad.
 */
@Injectable({ providedIn: 'root' })
export class ChatGroupAdminService {
  private readonly socket = inject(ChatSocketService);
  private readonly chat = inject(ChatService);
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);

  /** Hay una acción en curso (para deshabilitar botones y evitar dobles clics). */
  readonly busy = signal(false);

  addMember(conversationId: string, userId: string): Promise<boolean> {
    return this.run(() => this.socket.addGroupMember(conversationId, userId));
  }

  removeMember(conversationId: string, userId: string): Promise<boolean> {
    return this.run(() => this.socket.removeGroupMember(conversationId, userId));
  }

  leave(conversationId: string): Promise<boolean> {
    return this.run(() => this.socket.removeGroupMember(conversationId));
  }

  setRole(conversationId: string, userId: string, role: 'Admin' | 'Member'): Promise<boolean> {
    return this.run(() => this.socket.setGroupMemberRole(conversationId, userId, role));
  }

  makeOwner(conversationId: string, userId: string): Promise<boolean> {
    return this.run(() => this.socket.transferGroupOwnership(conversationId, userId));
  }

  updateInfo(conversationId: string, info: { title?: string; description?: string | null; avatarFileId?: string | null }): Promise<boolean> {
    return this.run(() => this.socket.updateGroupInfo(conversationId, info));
  }

  setAdminsOnly(conversationId: string, enabled: boolean): Promise<boolean> {
    return this.run(() => this.socket.setGroupAdminsOnly(conversationId, enabled));
  }

  setMuted(conversationId: string, muted: boolean): Promise<boolean> {
    return this.run(() => this.socket.setConversationMuted(conversationId, muted));
  }

  /** Foto del grupo: subida mediada → MinIO → confirmar → guardar en el grupo (se ve cuando pasa el escaneo). */
  async uploadPhoto(conversationId: string, file: File): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.busy.set(true);
    try {
      const upload = await firstValueFrom(
        this.chat.startGroupAvatarUpload(conversationId, { originalName: file.name, contentType: file.type, sizeBytes: file.size }),
      );
      await firstValueFrom(this.cloudStorage.uploadToPresignedUrl(upload.uploadUrl, upload.formData, file));
      await firstValueFrom(this.chat.completeGroupAvatarUpload(conversationId, upload.fileId));
      const ack = await this.socket.updateGroupInfo(conversationId, { avatarFileId: upload.fileId });
      if (!ack.ok) {
        this.toast.error(groupErrorMessage(ack.code));
        return false;
      }
      // Se ve cuando pasa el antivirus y la revisión de contenido (T-20); si la bloquean, avisa la campana.
      this.toast.info('Group photo saved. It will appear once it passes our security and content checks.');
      return true;
    } catch (err) {
      const code = toApiError(err).code;
      this.toast.error(code === 'Chat.Group.AvatarType' ? 'Use a JPG, PNG or WebP image.' : groupErrorMessage(code));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async run(command: () => Promise<SocketAck<unknown>>): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.busy.set(true);
    try {
      const ack = await command();
      if (!ack.ok) {
        this.toast.error(groupErrorMessage(ack.code));
      }
      return ack.ok;
    } finally {
      this.busy.set(false);
    }
  }
}
