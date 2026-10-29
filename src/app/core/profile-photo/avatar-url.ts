import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * URL pública de una foto de perfil: `GET /storage/avatars/{fileId}`, anónima e inmutable
 * (foto nueva = fileId nuevo, así que la caché del navegador nunca sirve una vieja).
 * Va por el gateway del tenant como el resto de la API. Nunca usar URLs presignadas para avatares.
 */
export function buildAvatarUrl(tenantBase: string, fileId: string | null | undefined): string | null {
  const id = fileId?.trim();
  if (!id) {
    return null;
  }
  return `${tenantBase.replace(/\/+$/, '')}/storage/avatars/${encodeURIComponent(id)}`;
}

/** Arma la URL de un avatar con la base del tenant actual. Sin tenant resuelto devuelve null (iniciales). */
@Injectable({ providedIn: 'root' })
export class AvatarUrlService {
  private readonly api = inject(ApiConfigService);

  url(fileId: string | null | undefined): string | null {
    if (!fileId) {
      return null;
    }
    try {
      return buildAvatarUrl(this.api.tenantBase(), fileId);
    } catch {
      // tenantBase() lanza en prod si aún no hay slug: se cae a las iniciales.
      return null;
    }
  }
}
