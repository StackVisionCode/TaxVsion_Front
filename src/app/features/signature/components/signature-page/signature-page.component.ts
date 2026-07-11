import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  SignatureRequest,
  SignatureStatus,
  SignatureTableComponent,
  Signer,
  deriveSignatureStatus,
} from '../../ui/signature-table/signature-table.component';
import { SignatureRequestPanelComponent } from '../../ui/signature-request-panel/signature-request-panel.component';
import { SignaturePreviewComponent } from '../../ui/signature-preview/signature-preview.component';
import { CreatedSignature, SignatureCreatorComponent } from '../../ui/signature-creator/signature-creator.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { SignatureLinkService, SigningLink } from '../../data-access/signature-link.service';
import { CHANNEL_META } from '../../ui/signature-request-panel/signature-wizard.mock';

type StatusFilter = 'All' | SignatureStatus;
const PAGE_SIZE = 8;

/** Builds a YYYY-MM-DD date string relative to today so the mock signature requests always look alive. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function signer(name: string, email: string, color: string, status: Signer['status'], signedAtDays: number | null): Signer {
  const initials = name
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return { name, initials, email, color, status, signedAt: signedAtDays === null ? null : dateInDays(signedAtDays) };
}

const SEED_REQUESTS: SignatureRequest[] = [
  {
    id: 'signature-1',
    documentName: 'Engagement Letter',
    client: 'Maria Gonzalez',
    signers: [signer('Maria Gonzalez', 'maria.gonzalez@email.com', 'bg-indigo-500', 'signed', -18)],
    status: 'completed',
    sentDate: dateInDays(-20),
    dueDate: dateInDays(-13),
    completedDate: dateInDays(-18),
    notes: 'Standard engagement letter for the 2025 filing season.',
  },
  {
    id: 'signature-2',
    documentName: 'Form 8879 E-file Authorization',
    client: 'David Chen',
    signers: [signer('David Chen', 'david.chen@email.com', 'bg-orange-500', 'pending', null)],
    status: 'pending',
    sentDate: dateInDays(-2),
    dueDate: dateInDays(5),
    completedDate: null,
    notes: '',
  },
  {
    id: 'signature-3',
    documentName: '2025 Tax Return Signature Page',
    client: 'Sarah & Mark Johnson',
    signers: [
      signer('Sarah Johnson', 'sarah.johnson@email.com', 'bg-[#7C6AE0]', 'signed', -1),
      signer('Mark Johnson', 'mark.johnson@email.com', 'bg-emerald-500', 'pending', null),
    ],
    status: 'in-progress',
    sentDate: dateInDays(-5),
    dueDate: dateInDays(2),
    completedDate: null,
    notes: 'Joint return, both spouses must sign before we can e-file.',
  },
  {
    id: 'signature-4',
    documentName: 'POA Form 2848',
    client: 'Robert Kim',
    signers: [signer('Robert Kim', 'robert.kim@email.com', 'bg-gray-900', 'rejected', -4)],
    status: 'rejected',
    sentDate: dateInDays(-10),
    dueDate: dateInDays(-3),
    completedDate: null,
    notes: 'Client wants to review with their attorney before granting power of attorney.',
  },
  {
    id: 'signature-5',
    documentName: 'W-9 Request',
    client: 'Lisa Martinez',
    signers: [signer('Lisa Martinez', 'lisa.martinez@email.com', 'bg-indigo-500', 'signed', -28)],
    status: 'completed',
    sentDate: dateInDays(-30),
    dueDate: dateInDays(-23),
    completedDate: dateInDays(-28),
    notes: '',
  },
  {
    id: 'signature-6',
    documentName: 'Amendment Authorization',
    client: 'James Wilson',
    signers: [signer('James Wilson', 'james.wilson@email.com', 'bg-orange-500', 'pending', null)],
    status: 'pending',
    sentDate: dateInDays(-1),
    dueDate: dateInDays(6),
    completedDate: null,
    notes: 'Amending 2023 return to correct dependent information.',
  },
  {
    id: 'signature-7',
    documentName: 'Engagement Letter',
    client: 'Patricia Brown',
    signers: [signer('Patricia Brown', 'patricia.brown@email.com', 'bg-[#7C6AE0]', 'signed', -38)],
    status: 'completed',
    sentDate: dateInDays(-40),
    dueDate: dateInDays(-33),
    completedDate: dateInDays(-38),
    notes: '',
  },
  {
    id: 'signature-8',
    documentName: 'Form 8879 E-file Authorization',
    client: 'Michael & Jennifer Davis',
    signers: [
      signer('Michael Davis', 'michael.davis@email.com', 'bg-emerald-500', 'signed', -13),
      signer('Jennifer Davis', 'jennifer.davis@email.com', 'bg-gray-900', 'signed', -12),
    ],
    status: 'completed',
    sentDate: dateInDays(-15),
    dueDate: dateInDays(-8),
    completedDate: dateInDays(-12),
    notes: '',
  },
  {
    id: 'signature-9',
    documentName: '2025 Tax Return Signature Page',
    client: 'Thomas Anderson',
    signers: [signer('Thomas Anderson', 'thomas.anderson@email.com', 'bg-indigo-500', 'pending', null)],
    status: 'pending',
    sentDate: dateInDays(-3),
    dueDate: dateInDays(4),
    completedDate: null,
    notes: '',
  },
  {
    id: 'signature-10',
    documentName: 'POA Form 2848',
    client: 'Nancy White',
    signers: [signer('Nancy White', 'nancy.white@email.com', 'bg-orange-500', 'signed', -22)],
    status: 'completed',
    sentDate: dateInDays(-25),
    dueDate: dateInDays(-18),
    completedDate: dateInDays(-22),
    notes: '',
  },
  {
    id: 'signature-11',
    documentName: 'W-9 Request',
    client: 'Christopher Lee',
    signers: [signer('Christopher Lee', 'christopher.lee@email.com', 'bg-[#7C6AE0]', 'rejected', -7)],
    status: 'rejected',
    sentDate: dateInDays(-12),
    dueDate: dateInDays(-5),
    completedDate: null,
    notes: 'Client declined, requested a phone call instead.',
  },
  {
    id: 'signature-12',
    documentName: 'Amendment Authorization',
    client: 'Amanda & Brian Taylor',
    signers: [
      signer('Amanda Taylor', 'amanda.taylor@email.com', 'bg-emerald-500', 'signed', -2),
      signer('Brian Taylor', 'brian.taylor@email.com', 'bg-gray-900', 'pending', null),
    ],
    status: 'in-progress',
    sentDate: dateInDays(-6),
    dueDate: dateInDays(1),
    completedDate: null,
    notes: '',
  },
];

/**
 * Página del módulo Signature (estilo "Aether"): stats pastel + tabs de
 * estado/búsqueda + tabla de solicitudes de firma + panel de creación (solo
 * creación, una solicitud no se edita una vez enviada) + vista previa de
 * solo lectura (takeover, mismo patrón *ngIf/else que campaigns-page).
 * Reemplaza al sistema completo de firma del CRM original (editor de
 * colocación de PDF, certificados y auditoría, flujo de firma orientado al
 * cliente) por un dashboard interno simplificado: todo el estado vive en
 * signals dentro de esta página, sin servicios ni backend.
 */
@Component({
  selector: 'app-signature-page',
  imports: [
    CommonModule,
    FormsModule,
    SignatureTableComponent,
    SignatureRequestPanelComponent,
    SignaturePreviewComponent,
    SignatureCreatorComponent,
    PaginationComponent,
    ModalComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-page.component.html',
})
export class SignaturePageComponent {
  private readonly router = inject(Router);
  private readonly linkService = inject(SignatureLinkService);

  readonly channelMeta = CHANNEL_META;
  readonly requests = signal<SignatureRequest[]>(SEED_REQUESTS);

  /** Enlaces de firma de la solicitud recién enviada (modal "Request sent"). */
  readonly sentLinks = signal<SigningLink[] | null>(null);

  readonly statusFilters: StatusFilter[] = ['All', 'pending', 'in-progress', 'completed', 'rejected'];
  readonly activeFilter = signal<StatusFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);

  /** Generador de firmas (adaptado del CRM legado): modal + firma propia del preparador. */
  readonly isCreatorOpen = signal(false);
  readonly mySignature = signal<CreatedSignature | null>(null);

  /** Read-only detail takeover; no edit mode in this feature, but kept as a plain signal set explicitly (not a computed over an @Input) so it stays safe to extend later. */
  readonly previewRequest = signal<SignatureRequest | null>(null);

  readonly toastMessage = signal<string | null>(null);

  readonly totalRequests = computed(() => this.requests().length);

  readonly pendingSignatures = computed(() =>
    this.requests().reduce((sum, request) => sum + request.signers.filter(item => item.status === 'pending').length, 0),
  );

  readonly completedThisMonth = computed(() => {
    const now = new Date();
    return this.requests().filter(request => {
      if (request.status !== 'completed' || !request.completedDate) {
        return false;
      }
      const completed = new Date(`${request.completedDate}T00:00:00`);
      return completed.getFullYear() === now.getFullYear() && completed.getMonth() === now.getMonth();
    }).length;
  });

  readonly avgTimeToSign = '1.8 days';

  readonly visibleRequests = computed<SignatureRequest[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.requests()
      .filter(request => filter === 'All' || request.status === filter)
      .filter(
        request =>
          !query ||
          request.documentName.toLowerCase().includes(query) ||
          request.client.toLowerCase().includes(query),
      );
  });

  filterLabel(filter: StatusFilter): string {
    switch (filter) {
      case 'All':
        return 'All';
      case 'pending':
        return 'Pending';
      case 'in-progress':
        return 'In Progress';
      case 'completed':
        return 'Completed';
      case 'rejected':
        return 'Rejected';
    }
  }

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedRequests = computed<SignatureRequest[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleRequests().slice(start, start + PAGE_SIZE);
  });

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

  openCreatePanel(): void {
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
  }

  openCreator(): void {
    this.isCreatorOpen.set(true);
  }

  closeCreator(): void {
    this.isCreatorOpen.set(false);
  }

  handleSignatureCreated(signature: CreatedSignature): void {
    this.mySignature.set(signature);
    this.closeCreator();
    this.showToast('Signature saved');
  }

  handleSent(request: SignatureRequest): void {
    const finalRequest = { ...request, status: deriveSignatureStatus(request.signers) };
    this.requests.update(list => [...list, finalRequest]);
    this.closePanel();
    // Modal con los enlaces seguros por firmante (propuesta UX).
    this.sentLinks.set(this.linkService.register(finalRequest));
  }

  closeLinksModal(): void {
    this.sentLinks.set(null);
    this.showToast('Signature request sent');
  }

  copyLink(link: SigningLink): void {
    const url = `${window.location.origin}${link.url}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    this.showToast(`Link for ${link.signer.name.split(' ')[0]} copied`);
  }

  openLink(link: SigningLink): void {
    this.sentLinks.set(null);
    void this.router.navigateByUrl(link.url);
  }

  /** Acción "Open signing link" de la tabla: abre el enlace del primer firmante pendiente. */
  handleOpenLink(request: SignatureRequest): void {
    const links = this.linkService.register(request);
    const target = links.find(link => link.signer.status === 'pending') ?? links[0];
    if (target) {
      void this.router.navigateByUrl(target.url);
    }
  }

  openPreview(request: SignatureRequest): void {
    this.previewRequest.set(request);
  }

  closePreview(): void {
    this.previewRequest.set(null);
  }

  resendReminder(request: SignatureRequest): void {
    this.showToast(`Reminder resent for "${request.documentName}"`);
  }

  cancelRequest(request: SignatureRequest): void {
    this.requests.update(list =>
      list.map(item => (item.id === request.id ? { ...item, status: 'rejected' as const } : item)),
    );
    if (this.previewRequest()?.id === request.id) {
      this.previewRequest.set(null);
    }
    this.showToast(`Signature request "${request.documentName}" cancelled`);
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2500);
  }
}
