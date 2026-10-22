import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import {
  ENGAGEMENT_HINT,
  EmailActivityDetail,
  laneLabel,
  statusLabel,
  statusTone,
  timelineLabel,
} from '@core/postmaster/email-activity.model';

/** Contenido del drawer: destinatarios con su resultado y la línea de tiempo del correo. */
@Component({
  selector: 'app-email-activity-detail',
  imports: [StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './email-activity-detail.component.html',
})
export class EmailActivityDetailComponent {
  @Input({ required: true }) detail!: EmailActivityDetail;

  readonly engagementHint = ENGAGEMENT_HINT;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly laneLabel = laneLabel;
  readonly timelineLabel = timelineLabel;

  formatDateTime(value: string | null): string {
    const date = parseUtcDateOrNull(value);
    return date
      ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';
  }
}
