import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent } from '@shared/ui/segmented/segmented.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import {
  EMAIL_ACTIVITY_FILTERS,
  ENGAGEMENT_HINT,
  EmailActivityFilter,
  EmailActivityItem,
  laneLabel,
  statusLabel,
  statusTone,
} from '@core/postmaster/email-activity.model';
import { EMAIL_ACTIVITY_PAGE_SIZE, EmailActivityStore } from '../../data-access/email-activity.store';
import { EmailActivityDetailComponent } from '../../ui/email-activity-detail/email-activity-detail.component';

/**
 * Settings → Email activity. Qué pasó con cada correo que salió de la oficina: entregado, rebotado,
 * marcado como spam… El estado lo cuenta el proveedor después del envío (Postmaster lo guarda).
 */
@Component({
  selector: 'app-email-activity-page',
  imports: [
    RouterLink,
    DrawerComponent,
    PaginationComponent,
    SearchInputComponent,
    SegmentedComponent,
    StateBlockComponent,
    StatusPillComponent,
    EmailActivityDetailComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './email-activity-page.component.html',
})
export class EmailActivityPageComponent implements OnInit {
  readonly store = inject(EmailActivityStore);
  private readonly route = inject(ActivatedRoute);

  readonly filters = EMAIL_ACTIVITY_FILTERS;
  readonly pageSize = EMAIL_ACTIVITY_PAGE_SIZE;
  readonly engagementHint = ENGAGEMENT_HINT;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly laneLabel = laneLabel;

  ngOnInit(): void {
    this.store.start(this.route.snapshot.queryParamMap.get('recipient'));
  }

  onFilter(status: EmailActivityFilter): void {
    this.store.setStatus(status);
  }

  recipientsLabel(item: EmailActivityItem): string {
    const [first, ...rest] = item.recipients;
    return rest.length === 0 ? (first ?? '—') : `${first} +${rest.length}`;
  }

  formatDateTime(value: string | null): string {
    const date = parseUtcDateOrNull(value);
    return date
      ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';
  }
}
