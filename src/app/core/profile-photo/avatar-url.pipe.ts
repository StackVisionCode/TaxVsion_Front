import { Pipe, PipeTransform, inject } from '@angular/core';
import { AvatarUrlService } from './avatar-url';

/**
 * `fileId` de una foto → su URL anónima (`/storage/avatars/{id}`), o null para caer a las iniciales.
 * Pura: el fileId es inmutable (foto nueva = id nuevo), así que basta con recalcular si cambia el id.
 *
 * Uso: `<app-avatar [name]="c.displayName" [seed]="c.id" [imageUrl]="c.avatarFileId | avatarUrl" />`
 */
@Pipe({ name: 'avatarUrl' })
export class AvatarUrlPipe implements PipeTransform {
  private readonly urls = inject(AvatarUrlService);

  transform(fileId: string | null | undefined): string | null {
    return this.urls.url(fileId);
  }
}
