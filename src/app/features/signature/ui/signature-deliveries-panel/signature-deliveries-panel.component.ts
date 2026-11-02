import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { SignatureService } from '../../data-access/signature.service';
import { SignedDocumentDelivery } from '../../data-access/signature.model';
import {
  canResendDelivery,
  canRevokeDelivery,
  deliveryPurposeLabel,
  deliveryStatusLabel,
} from '../../utils/delivery-summary.util';

/**
 * Entregas de documentos firmados de una solicitud: a quién se mandaron, si abrieron el enlace y hasta
 * cuándo vale. Reenviar rota el enlace (llega al mismo email); apagarlo pide confirmación porque el cliente
 * pierde el acceso. Si una solicitud completada que debía entregar no tiene entregas, se pueden enviar desde
 * aquí. No son shares de Documents, por eso viven acá y no en el gestor de archivos.
 */
@Component({
  selector: 'app-signature-deliveries-panel',
  imports: [DatePipe, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-deliveries-panel.component.html',
})
export class SignatureDeliveriesPanelComponent {
  private readonly service = inject(SignatureService);
  private readonly toast = inject(ToastService);

  private requestId: string | null = null;

  @Input() set request(id: string | null) {
    if (id === this.requestId) return;
    this.requestId = id;
    this.deliveries.set([]);
    this.loaded.set(false);
    if (id) void this.load(id);
  }

  /** La solicitud está completada y debía entregar: se ofrece enviar si no hay entregas. */
  @Input() canIssue = false;

  readonly deliveries = signal<SignedDocumentDelivery[]>([]);
  readonly loaded = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly issuing = signal(false);
  /** Entrega a apagar, pendiente de confirmar. */
  readonly pendingRevoke = signal<SignedDocumentDelivery | null>(null);

  readonly parseUtc = parseUtcDate;

  readonly statusLabel = deliveryStatusLabel;
  readonly purposeLabel = deliveryPurposeLabel;
  readonly canResend = canResendDelivery;
  readonly canRevoke = canRevokeDelivery;

  async resend(delivery: SignedDocumentDelivery): Promise<void> {
    await this.act(delivery, () => this.service.resendDelivery(this.requestId!, delivery.id), `New link sent to ${delivery.recipientEmail}`);
  }

  revoke(delivery: SignedDocumentDelivery): void {
    this.pendingRevoke.set(delivery);
  }

  async confirmRevoke(): Promise<void> {
    const delivery = this.pendingRevoke();
    if (!delivery) return;
    await this.act(delivery, () => this.service.revokeDelivery(this.requestId!, delivery.id), 'Link turned off');
    this.pendingRevoke.set(null);
  }

  async issue(): Promise<void> {
    const id = this.requestId;
    if (!id || this.issuing()) return;
    this.issuing.set(true);
    try {
      const list = await firstValueFrom(this.service.issueDeliveries(id));
      if (this.requestId === id) this.deliveries.set(list);
      this.toast.success('Signed documents sent');
    } catch (err) {
      this.toast.error(toApiError(err).message);
    } finally {
      this.issuing.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const list = await firstValueFrom(this.service.listDeliveries(id));
      if (this.requestId === id) {
        this.deliveries.set(list);
        this.loaded.set(true);
      }
    } catch {
      // Sin permiso de lectura: el panel simplemente no se muestra.
    }
  }

  private async act(
    delivery: SignedDocumentDelivery,
    call: () => ReturnType<SignatureService['resendDelivery']>,
    successMessage: string,
  ): Promise<void> {
    this.busyId.set(delivery.id);
    try {
      const updated = await firstValueFrom(call());
      this.deliveries.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      this.toast.success(successMessage);
    } catch (err) {
      this.toast.error(toApiError(err).message);
    } finally {
      this.busyId.set(null);
    }
  }
}
