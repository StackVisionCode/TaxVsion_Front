import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import {
  ENGAGEMENT_HINT,
  EmailActivityItem,
  laneLabel,
  statusLabel,
  statusTone,
} from '@core/postmaster/email-activity.model';
import { EmailActivityService } from '@core/postmaster/email-activity.service';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';

const RECENT_SIZE = 10;

/**
 * Perfil del cliente → Email delivery: qué pasó con los últimos correos que la oficina le mandó.
 * Busca por su dirección de email (Postmaster no guarda el cliente): si el cliente cambió de email,
 * los correos a la dirección anterior no aparecen acá. El historial completo vive en Settings.
 */
@Component({
  selector: 'app-client-profile-email-delivery',
  imports: [RouterLink, StateBlockComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-email-delivery.component.html',
})
export class ClientProfileEmailDeliveryComponent implements OnChanges {
  private readonly service = inject(EmailActivityService);

  @Input({ required: true }) email = '';

  readonly items = signal<EmailActivityItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly engagementHint = ENGAGEMENT_HINT;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly laneLabel = laneLabel;

  private request = 0;

  ngOnChanges(): void {
    this.load();
  }

  load(): void {
    const email = this.email.trim();
    const request = ++this.request;
    this.items.set([]);
    this.error.set(null);
    if (!email) {
      return;
    }

    this.loading.set(true);
    this.service.list({ status: 'All', recipient: email, page: 1, size: RECENT_SIZE }).subscribe({
      next: page => {
        if (request !== this.request) {
          return;
        }
        this.items.set(page.items);
        this.loading.set(false);
      },
      error: err => {
        if (request !== this.request) {
          return;
        }
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  formatDateTime(value: string | null): string {
    const date = parseUtcDateOrNull(value);
    return date
      ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';
  }
}
