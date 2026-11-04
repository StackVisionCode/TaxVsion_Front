import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { PublicDeliveryItem, PublicDeliveryView, SignatureDeliveryService } from './signature-delivery.service';
import {
  DeliveryPageState,
  deliveryItemIcon,
  deliveryItemLabel,
  deliveryPageState,
  reissueErrorMessage,
} from './delivery-page.util';

/**
 * Página de entrega de documentos firmados: `https://<oficina>.taxoffix.io/d/<token>`, sin sesión
 * (fuera del authGuard). Lista los archivos de la entrega; cada descarga pide al backend una URL firmada
 * de pocos minutos. `?item=<id>` (botón del correo) arranca esa descarga sola. Con el enlace vencido
 * ofrece pedir uno nuevo, que siempre llega al email original (la página no deja elegir destino).
 */
@Component({
  selector: 'app-signature-delivery-page',
  standalone: true,
  imports: [BrandLogoComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-delivery-page.component.html',
  styleUrl: './signature-delivery-page.component.css',
})
export class SignatureDeliveryPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(SignatureDeliveryService);

  private token = '';

  readonly state = signal<DeliveryPageState>('loading');
  readonly view = signal<PublicDeliveryView | null>(null);
  readonly downloadingId = signal<string | null>(null);
  readonly downloadError = signal<string | null>(null);
  readonly reissueState = signal<'idle' | 'sending' | 'sent'>('idle');
  readonly reissueError = signal<string | null>(null);

  readonly icon = deliveryItemIcon;
  readonly label = deliveryItemLabel;

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.state.set('invalid');
      return;
    }

    try {
      const view = await firstValueFrom(this.service.get(this.token));
      this.view.set(view);
      this.state.set(deliveryPageState(view));
    } catch {
      this.state.set('invalid');
      return;
    }

    const itemId = this.route.snapshot.queryParamMap.get('item');
    const item = this.view()?.items.find((candidate) => candidate.id === itemId);
    if (this.state() === 'ready' && item) await this.download(item);
  }

  async download(item: PublicDeliveryItem): Promise<void> {
    this.downloadError.set(null);
    this.downloadingId.set(item.id);
    try {
      const { url } = await firstValueFrom(this.service.downloadUrl(this.token, item.id));
      window.location.assign(url);
    } catch (err) {
      const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
      this.downloadError.set(
        code === 'Signature.Delivery.FileUnavailable'
          ? 'This file is still being prepared. Please try again in a minute.'
          : "We couldn't start the download. Reload the page and try again.",
      );
    } finally {
      this.downloadingId.set(null);
    }
  }

  async requestNewLink(): Promise<void> {
    this.reissueError.set(null);
    this.reissueState.set('sending');
    try {
      await firstValueFrom(this.service.requestNewLink(this.token));
      this.reissueState.set('sent');
    } catch (err) {
      const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
      this.reissueError.set(reissueErrorMessage(code));
      this.reissueState.set('idle');
    }
  }

  formatDate(iso: string | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }
}
