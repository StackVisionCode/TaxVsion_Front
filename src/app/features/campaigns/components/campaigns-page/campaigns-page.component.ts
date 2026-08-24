import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { CampaignFormValue, CampaignItem, CampaignStatus } from '../../data-access/campaigns.model';
import { CampaignsStore, RecipientsError } from '../../data-access/campaigns.store';
import { CampaignTableComponent } from '../../ui/campaign-table/campaign-table.component';
import { CampaignFormPanelComponent } from '../../ui/campaign-form-panel/campaign-form-panel.component';
import { CampaignPreviewComponent, CampaignTestResult } from '../../ui/campaign-preview/campaign-preview.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';

type StatusFilter = 'All' | CampaignStatus;
const PAGE_SIZE = 8;

/**
 * Página del módulo Campaigns (estilo "Aether"): stats pastel + tabs de estado/búsqueda +
 * tabla + panel de creación/lanzamiento + vista previa de solo lectura (takeover, mismo
 * patrón *ngIf/else que invoices-page).
 *
 * Integrada al backend real: EmailCampaignsController del servicio Notification
 * (`/notifications/email/campaigns` vía Gateway, CampaignsStore). El backend solo maneja
 * campañas de EMAIL con ciclo Draft → Scheduled → Running → Completed (+ Paused/Failed del
 * scheduler y Cancelled manual): los canales SMS/WhatsApp/Push del mock, la edición, el
 * duplicado, el borrado y el pause/resume no tienen endpoint y se retiraron de la UI.
 * Búsqueda/filtros/paginación son client-side (el listado no expone búsqueda y se trae
 * completo por lotes).
 */
@Component({
  selector: 'app-campaigns-page',
  imports: [
    CommonModule,
    FormsModule,
    CampaignTableComponent,
    CampaignFormPanelComponent,
    CampaignPreviewComponent,
    PaginationComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaigns-page.component.html',
})
export class CampaignsPageComponent implements OnInit {
  readonly store = inject(CampaignsStore);

  readonly statusFilters: StatusFilter[] = [
    'All',
    'draft',
    'scheduled',
    'active',
    'sent',
    'paused',
    'cancelled',
    'failed',
  ];
  readonly activeFilter = signal<StatusFilter>('All');
  readonly search = signal('');

  // ---------- Panel crear / lanzar ----------
  readonly isPanelOpen = signal(false);
  /** Draft que se está lanzando desde el menú de la tabla; null = panel en modo creación. */
  readonly launchTarget = signal<CampaignItem | null>(null);
  readonly panelSaving = signal(false);
  readonly panelError = signal<string | null>(null);

  // ---------- Preview + correo de prueba ----------
  /** Id (no el objeto): la fila del preview se re-deriva del store y se mantiene fresca. */
  private readonly previewId = signal<string | null>(null);
  readonly previewCampaign = computed<CampaignItem | null>(() => {
    const id = this.previewId();
    return id ? (this.store.campaigns().find(campaign => campaign.id === id) ?? null) : null;
  });
  readonly testSending = signal(false);
  readonly testResult = signal<CampaignTestResult | null>(null);

  // ---------- Cancelación ----------
  readonly pendingCancel = signal<CampaignItem | null>(null);
  readonly cancelMessage = computed(() => {
    const campaign = this.pendingCancel();
    return campaign
      ? `You're about to cancel campaign ${campaign.name}. A cancelled campaign cannot be resumed.`
      : '';
  });

  // ---------- Stats (derivadas de lo cargado) ----------
  readonly totalCampaigns = computed(() => this.store.totalCount());

  readonly activeNow = computed(
    () => this.store.campaigns().filter(campaign => campaign.status === 'active' || campaign.status === 'scheduled').length,
  );

  readonly totalRecipientsReached = computed(() =>
    this.store.campaigns().reduce((sum, campaign) => sum + campaign.recipients, 0),
  );

  readonly avgOpenRate = computed(() => {
    const totalDelivered = this.store.campaigns().reduce((sum, campaign) => sum + campaign.delivered, 0);
    const totalOpened = this.store.campaigns().reduce((sum, campaign) => sum + campaign.opened, 0);
    return totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
  });

  // ---------- Filtro + paginación client-side ----------
  readonly visibleCampaigns = computed<CampaignItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.store
      .campaigns()
      .filter(campaign => filter === 'All' || campaign.status === filter)
      .filter(
        campaign =>
          !query ||
          campaign.name.toLowerCase().includes(query) ||
          campaign.templateName.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedCampaigns = computed<CampaignItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleCampaigns().slice(start, start + PAGE_SIZE);
  });

  readonly emptyMessage = computed(() =>
    this.store.campaigns().length === 0
      ? 'No campaigns yet — create your first one'
      : 'No campaigns match your search',
  );

  ngOnInit(): void {
    this.store.init();
  }

  retryLoad(): void {
    this.store.refresh();
  }

  filterLabel(filter: StatusFilter): string {
    if (filter === 'All') {
      return 'All';
    }
    if (filter === 'active') {
      return 'Sending';
    }
    return filter.charAt(0).toUpperCase() + filter.slice(1);
  }

  setFilter(filter: StatusFilter): void {
    this.activeFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  formatNumber(value: number): string {
    return value.toLocaleString('en-US');
  }

  formatPercent(value: number): string {
    return `${value.toFixed(0)}%`;
  }

  // ---------- Panel ----------

  openCreatePanel(): void {
    this.launchTarget.set(null);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  openLaunchPanel(campaign: CampaignItem): void {
    this.launchTarget.set(campaign);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    if (this.panelSaving()) {
      return;
    }
    this.isPanelOpen.set(false);
    this.launchTarget.set(null);
    this.panelError.set(null);
  }

  /** Crear: POST /notifications/email/campaigns (+ POST {id}/schedule si el form trae fecha). */
  handleSubmitted(form: CampaignFormValue): void {
    this.panelSaving.set(true);
    this.panelError.set(null);
    this.store.createCampaign(form).subscribe({
      next: () => {
        this.panelSaving.set(false);
        this.isPanelOpen.set(false);
      },
      error: (err: unknown) => {
        this.panelSaving.set(false);
        this.panelError.set(err instanceof RecipientsError ? err.message : toApiError(err).message);
      },
    });
  }

  /** Lanzar un Draft existente: POST {id}/schedule (fecha vacía = ahora). */
  handleLaunched(dateYmd: string): void {
    const target = this.launchTarget();
    if (!target) {
      return;
    }
    this.panelSaving.set(true);
    this.panelError.set(null);
    this.store.scheduleCampaign(target.id, dateYmd).subscribe({
      next: () => {
        this.panelSaving.set(false);
        this.isPanelOpen.set(false);
        this.launchTarget.set(null);
      },
      error: (err: unknown) => {
        this.panelSaving.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }

  // ---------- Cancelación ----------

  requestCancel(campaign: CampaignItem): void {
    this.pendingCancel.set(campaign);
  }

  confirmCancel(): void {
    const campaign = this.pendingCancel();
    if (!campaign) {
      return;
    }
    this.store.cancelCampaign(campaign.id);
    this.pendingCancel.set(null);
  }

  // ---------- Preview + correo de prueba ----------

  openPreview(campaign: CampaignItem): void {
    this.previewId.set(campaign.id);
    this.testResult.set(null);
    this.testSending.set(false);
  }

  closePreview(): void {
    this.previewId.set(null);
  }

  /** POST {id}/send-test — el 202 solo confirma que el correo quedó encolado. */
  handleSendTest(email: string): void {
    const campaign = this.previewCampaign();
    if (!campaign || this.testSending()) {
      return;
    }
    this.testSending.set(true);
    this.testResult.set(null);
    this.store.sendTest(campaign.id, email).subscribe({
      next: () => {
        this.testSending.set(false);
        this.testResult.set({ ok: true, message: `Test email queued for ${email}.` });
      },
      error: (err: unknown) => {
        this.testSending.set(false);
        this.testResult.set({ ok: false, message: toApiError(err).message });
      },
    });
  }
}
