import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

export type DeliveryStatus = 'Active' | 'Expired' | 'Revoked';

export interface PublicDeliveryItem {
  id: string;
  title: string;
  kind: 'SignedDocument' | 'Certificate' | 'PartialCopy';
}

/** GET /signature/delivery/{token}: los archivos solo vienen con el enlace vigente. */
export interface PublicDeliveryView {
  status: DeliveryStatus;
  purpose: 'Completed' | 'PartialCopy';
  maskedEmail: string;
  expiresAtUtc: string;
  items: PublicDeliveryItem[];
  canRequestNewLink: boolean;
}

/**
 * Entrega de documentos firmados de Signature (sin sesión: la autoriza el secreto del enlace). Cada
 * descarga pide en el momento una URL firmada de pocos minutos; no es un share de Documents.
 */
@Injectable({ providedIn: 'root' })
export class SignatureDeliveryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  get(token: string): Observable<PublicDeliveryView> {
    return this.http.get<PublicDeliveryView>(this.url(token));
  }

  downloadUrl(token: string, itemId: string): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(`${this.url(token)}/files/${encodeURIComponent(itemId)}/download-url`, {});
  }

  requestNewLink(token: string): Observable<void> {
    return this.http.post<void>(`${this.url(token)}/reissue`, {});
  }

  private url(token: string): string {
    return this.api.tenantUrl(`/signature/delivery/${encodeURIComponent(token)}`);
  }
}
