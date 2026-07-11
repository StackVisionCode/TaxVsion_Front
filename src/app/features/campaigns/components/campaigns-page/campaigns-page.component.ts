import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CampaignItem, CampaignStatus, CampaignTableComponent } from '../../ui/campaign-table/campaign-table.component';
import { CampaignFormPanelComponent } from '../../ui/campaign-form-panel/campaign-form-panel.component';
import { CampaignPreviewComponent } from '../../ui/campaign-preview/campaign-preview.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';

type StatusFilter = 'All' | CampaignStatus;
const PAGE_SIZE = 8;

/** Builds a YYYY-MM-DD date string relative to today so the mock campaigns always look alive. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const SEED_CAMPAIGNS: CampaignItem[] = [
  {
    id: 'campaign-1',
    name: 'Tax Season Kickoff Reminder',
    channel: 'email',
    audience: 'All active clients',
    content:
      'Tax season is here! Book your appointment before April 15th to avoid last-minute filing stress. Reply to this email or call our office to schedule.',
    status: 'sent',
    scheduledDate: dateInDays(-45),
    recipients: 1200,
    delivered: 1180,
    opened: 690,
    clicked: 210,
  },
  {
    id: 'campaign-2',
    name: 'April 15 Deadline Alert',
    channel: 'sms',
    audience: 'Overdue accounts',
    content: 'Reminder: your tax deadline is in 5 days and we still need your documents. Reply STOP to opt out.',
    status: 'active',
    scheduledDate: dateInDays(-1),
    recipients: 340,
    delivered: 335,
    opened: 300,
    clicked: 90,
  },
  {
    id: 'campaign-3',
    name: 'Referral Program Promotion',
    channel: 'email',
    audience: 'VIP clients',
    content:
      'Refer a friend and both of you get $50 off your next filing! Forward this email or share your personal referral link.',
    status: 'sent',
    scheduledDate: dateInDays(-20),
    recipients: 150,
    delivered: 148,
    opened: 102,
    clicked: 40,
  },
  {
    id: 'campaign-4',
    name: 'Document Request Nudge',
    channel: 'whatsapp',
    audience: 'Overdue accounts',
    content: 'Hi! Just a friendly reminder that we still need your W-2 and 1099 forms to finish your return.',
    status: 'active',
    scheduledDate: dateInDays(-2),
    recipients: 210,
    delivered: 205,
    opened: 180,
    clicked: 95,
  },
  {
    id: 'campaign-5',
    name: 'Client Satisfaction Survey',
    channel: 'email',
    audience: 'All active clients',
    content: "We'd love your feedback! Take our 2-minute survey about your experience this filing season.",
    status: 'sent',
    scheduledDate: dateInDays(-15),
    recipients: 980,
    delivered: 965,
    opened: 410,
    clicked: 120,
  },
  {
    id: 'campaign-6',
    name: 'New Client Welcome Series',
    channel: 'email',
    audience: 'New clients this month',
    content: 'Welcome aboard! Here is what to expect during your first tax season with us, step by step.',
    status: 'scheduled',
    scheduledDate: dateInDays(4),
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
  },
  {
    id: 'campaign-7',
    name: 'Extension Filing Reminder',
    channel: 'sms',
    audience: 'Overdue accounts',
    content: "Haven't filed yet? We can still submit an extension for you today. Text back or call our office.",
    status: 'draft',
    scheduledDate: null,
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
  },
  {
    id: 'campaign-8',
    name: 'VIP Appreciation Event Invite',
    channel: 'push',
    audience: 'VIP clients',
    content: "You're invited! Join us for our annual client appreciation evening. Tap to RSVP.",
    status: 'scheduled',
    scheduledDate: dateInDays(10),
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
  },
  {
    id: 'campaign-9',
    name: 'Quarterly Estimated Tax Reminder',
    channel: 'email',
    audience: 'All active clients',
    content: 'Your Q2 estimated tax payment is due soon. Log in to your portal to review the calculated amount.',
    status: 'paused',
    scheduledDate: dateInDays(-3),
    recipients: 500,
    delivered: 490,
    opened: 200,
    clicked: 55,
  },
  {
    id: 'campaign-10',
    name: 'Document Upload Nudge',
    channel: 'push',
    audience: 'Overdue accounts',
    content: 'Your document checklist is missing a few items. Tap to see what we still need from you.',
    status: 'sent',
    scheduledDate: dateInDays(-8),
    recipients: 300,
    delivered: 295,
    opened: 210,
    clicked: 88,
  },
  {
    id: 'campaign-11',
    name: 'Referral Thank You Bonus',
    channel: 'whatsapp',
    audience: 'Custom list',
    content: 'Thank you for referring a friend! Here is your $50 credit code to use on your next invoice.',
    status: 'draft',
    scheduledDate: null,
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
  },
  {
    id: 'campaign-12',
    name: 'Mid-Season Check-in',
    channel: 'sms',
    audience: 'All active clients',
    content: "Just checking in! Let us know if you have questions while we prepare your return.",
    status: 'scheduled',
    scheduledDate: dateInDays(6),
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
  },
];

/**
 * Página del módulo Campaigns (estilo "Aether"): stats pastel + tabs de
 * estado/búsqueda + tabla de campañas + panel de creación/edición + vista
 * previa de solo lectura (takeover, mismo patrón *ngIf/else que
 * invoices-page). Reemplaza al sistema completo de campañas multicanal del
 * CRM original (wizard paso a paso, editor de plantillas, cálculo de costos
 * por canal, segmentación avanzada de audiencias) por una versión
 * simplificada: todo el estado vive en signals dentro de esta página, sin
 * servicios ni backend, y la audiencia es una selección fija de segmentos.
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
export class CampaignsPageComponent {
  readonly campaigns = signal<CampaignItem[]>(SEED_CAMPAIGNS);

  readonly statusFilters: StatusFilter[] = ['All', 'draft', 'scheduled', 'active', 'sent', 'paused'];
  readonly activeFilter = signal<StatusFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingCampaign = signal<CampaignItem | null>(null);
  readonly previewCampaign = signal<CampaignItem | null>(null);
  readonly pendingDelete = signal<CampaignItem | null>(null);

  readonly deleteMessage = computed(() => {
    const campaign = this.pendingDelete();
    return campaign ? `You're about to delete campaign ${campaign.name}. This can't be undone.` : '';
  });

  readonly totalCampaigns = computed(() => this.campaigns().length);

  readonly activeNow = computed(() => this.campaigns().filter(campaign => campaign.status === 'active').length);

  readonly totalRecipientsReached = computed(() =>
    this.campaigns().reduce((sum, campaign) => sum + campaign.recipients, 0),
  );

  readonly avgOpenRate = computed(() => {
    const totalDelivered = this.campaigns().reduce((sum, campaign) => sum + campaign.delivered, 0);
    const totalOpened = this.campaigns().reduce((sum, campaign) => sum + campaign.opened, 0);
    return totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
  });

  readonly visibleCampaigns = computed<CampaignItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.campaigns()
      .filter(campaign => filter === 'All' || campaign.status === filter)
      .filter(
        campaign =>
          !query ||
          campaign.name.toLowerCase().includes(query) ||
          campaign.audience.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedCampaigns = computed<CampaignItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleCampaigns().slice(start, start + PAGE_SIZE);
  });

  filterLabel(filter: StatusFilter): string {
    return filter === 'All' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1);
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

  openCreatePanel(): void {
    this.editingCampaign.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(campaign: CampaignItem): void {
    this.editingCampaign.set(campaign);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingCampaign.set(null);
  }

  handleSaved(campaign: CampaignItem): void {
    this.campaigns.update(list => {
      const exists = list.some(item => item.id === campaign.id);
      return exists ? list.map(item => (item.id === campaign.id ? campaign : item)) : [...list, campaign];
    });
    this.closePanel();
  }

  duplicateCampaign(campaign: CampaignItem): void {
    const copy: CampaignItem = {
      ...campaign,
      id: `campaign-${Date.now()}`,
      name: `${campaign.name} (copy)`,
      status: 'draft',
      scheduledDate: null,
      recipients: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
    };
    this.campaigns.update(list => [...list, copy]);
  }

  togglePauseResume(campaign: CampaignItem): void {
    this.campaigns.update(list =>
      list.map(item =>
        item.id === campaign.id ? { ...item, status: item.status === 'paused' ? ('active' as const) : ('paused' as const) } : item,
      ),
    );
  }

  deleteCampaign(campaign: CampaignItem): void {
    this.pendingDelete.set(campaign);
  }

  confirmDelete(): void {
    const campaign = this.pendingDelete();
    if (!campaign) {
      return;
    }
    this.campaigns.update(list => list.filter(item => item.id !== campaign.id));
    if (this.previewCampaign()?.id === campaign.id) {
      this.previewCampaign.set(null);
    }
    this.pendingDelete.set(null);
  }

  openPreview(campaign: CampaignItem): void {
    this.previewCampaign.set(campaign);
  }

  closePreview(): void {
    this.previewCampaign.set(null);
  }
}
