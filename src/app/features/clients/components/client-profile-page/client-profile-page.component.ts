import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ClientProfileOverviewComponent } from '../../ui/client-profile-overview/client-profile-overview.component';
import { ClientProfileInfoComponent } from '../../ui/client-profile-info/client-profile-info.component';
import { ClientProfileDocumentsComponent } from '../../ui/client-profile-documents/client-profile-documents.component';
import { ClientProfileInvoicesComponent } from '../../ui/client-profile-invoices/client-profile-invoices.component';
import { ClientProfileNotesComponent } from '../../ui/client-profile-notes/client-profile-notes.component';
import { ClientProfileCommunicationComponent } from '../../ui/client-profile-communication/client-profile-communication.component';
import { ClientProfileCallsComponent } from '../../ui/client-profile-calls/client-profile-calls.component';
import { ClientProfileBankComponent } from '../../ui/client-profile-bank/client-profile-bank.component';
import { ClientProfileFamilyComponent } from '../../ui/client-profile-family/client-profile-family.component';
import { ClientProfileRemindersComponent } from '../../ui/client-profile-reminders/client-profile-reminders.component';
import { ClientProfileMileageComponent } from '../../ui/client-profile-mileage/client-profile-mileage.component';
import { ClientProfilePermissionsComponent } from '../../ui/client-profile-permissions/client-profile-permissions.component';
import { ClientProfile } from '../../models/client-profile.model';
import { ClientFormPanelComponent } from '../../ui/client-form-panel/client-form-panel.component';
import { ClientItem } from '../../ui/client-table/client-table.component';
import { ClientsStore } from '../../data-access/clients.store';
import { customerToClientProfile } from '../../data-access/clients.model';
import { toApiError } from '@core/models/api-error.model';

export type ClientProfileTabId =
  | 'overview'
  | 'info'
  | 'documents'
  | 'invoices'
  | 'notes'
  | 'communication'
  | 'calls'
  | 'bank'
  | 'family'
  | 'reminders'
  | 'mileage'
  | 'permissions';

interface ClientProfileTab {
  id: ClientProfileTabId;
  label: string;
}

/** Entrada de la fila de tabs: una píldora simple, o una píldora "grupo" que despliega varias tabs relacionadas. */
type ClientProfileNavEntry =
  | { kind: 'tab'; id: ClientProfileTabId; label: string }
  | { kind: 'group'; label: string; tabs: ClientProfileTab[] };

/**
 * Se agrupan las tabs de Finance y Activity para no alargar la fila de
 * píldoras (12 tabs individuales no cabían sin scroll horizontal). Overview,
 * Info y Permissions quedan sueltas por ser las más consultadas o distintas
 * en naturaleza (administrativa) al resto.
 */
const PROFILE_NAV: ClientProfileNavEntry[] = [
  { kind: 'tab', id: 'overview', label: 'Overview' },
  { kind: 'tab', id: 'info', label: 'Info' },
  {
    kind: 'group',
    label: 'Finance',
    tabs: [
      { id: 'invoices', label: 'Invoices' },
      { id: 'bank', label: 'Bank' },
      { id: 'mileage', label: 'Mileage' },
    ],
  },
  {
    kind: 'group',
    label: 'Activity',
    tabs: [
      { id: 'documents', label: 'Documents' },
      { id: 'notes', label: 'Notes' },
      { id: 'communication', label: 'Communication' },
      { id: 'calls', label: 'Calls' },
      { id: 'family', label: 'Family' },
      { id: 'reminders', label: 'Reminders' },
    ],
  },
  { kind: 'tab', id: 'permissions', label: 'Permissions' },
];

const AVATAR_PALETTE = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

/**
 * Shell del perfil de cliente (patrón "Aether" tipo takeover, con
 * navegación por tabs estilo invoice-preview + settings-page): header con
 * botón de volver, avatar/nombre/chips de tipo y estado, botón "Edit" (abre
 * el mismo `app-client-form-panel` del directorio, precargado con este
 * cliente) y fila de tabs tipo píldora. El contenido de cada tab se resuelve
 * por *ngSwitch sobre activeTab().
 *
 * `client` viene de GET /customers/{id} (ClientsStore) — no de una seed
 * local. Solo Overview/Info/Family reciben el objeto completo; el resto
 * recibe el `clientId`.
 *
 * Estado de los datos por tab (auditoría ago-2026, ver el comentario de clase
 * de cada componente para el detalle del contrato):
 *  - REALES y filtradas por este cliente: Info, Family (del propio Customer),
 *    Notes (`/notes?targetType=Customer&targetId=`) y Communication
 *    (`/correspondence/customers/{id}/threads`).
 *  - REAL pero NO filtrable por cliente: Reminders (el servicio Reminder no
 *    tiene categoría `Customer`); lo declara en pantalla.
 *  - VACÍAS A PROPÓSITO, sin backend que las respalde por cliente: Overview
 *    (parcial), Invoices, Documents, Bank, Mileage, Calls y Permissions. Cada
 *    una muestra un estado vacío que explica qué falta. NO son un olvido:
 *    antes pintaban mocks estáticos bajo el nombre de un cliente real, que es
 *    justo lo que había que quitar antes de producción.
 */
@Component({
  selector: 'app-client-profile-page',
  imports: [
    CommonModule,
    RouterModule,
    ClientProfileOverviewComponent,
    ClientProfileInfoComponent,
    ClientProfileDocumentsComponent,
    ClientProfileInvoicesComponent,
    ClientProfileNotesComponent,
    ClientProfileCommunicationComponent,
    ClientProfileCallsComponent,
    ClientProfileBankComponent,
    ClientProfileFamilyComponent,
    ClientProfileRemindersComponent,
    ClientProfileMileageComponent,
    ClientProfilePermissionsComponent,
    ClientFormPanelComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-page.component.html',
})
export class ClientProfilePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(ClientsStore);

  readonly navItems = PROFILE_NAV;
  readonly activeTab = signal<ClientProfileTabId>('overview');

  /** Label del grupo (Finance/Activity) cuyo dropdown está abierto, o null si ninguno. */
  readonly openGroupLabel = signal<string | null>(null);

  /**
   * Signal reactiva sobre paramMap (no un snapshot leído una sola vez): con
   * la RouteReuseStrategy de la app, navegar entre /clients/:id distintos
   * puede reutilizar esta misma instancia de componente en el lugar, así
   * que el id debe seguir actualizándose, no quedar congelado en el primero.
   */
  private readonly paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly client = signal<ClientProfile | null>(null);

  readonly isEditPanelOpen = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="profile-tab-group"]')) {
      this.openGroupLabel.set(null);
    }
  }

  constructor() {
    effect(() => {
      const id = this.paramMap().get('id');
      if (id) {
        this.loadClient(id);
      }
    });
  }

  private loadClient(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.store.getById(id).subscribe({
      next: customer => {
        this.client.set(customerToClientProfile(customer));
        this.loading.set(false);
      },
      error: err => {
        this.loadError.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  selectTab(id: ClientProfileTabId): void {
    this.activeTab.set(id);
    this.openGroupLabel.set(null);
  }

  toggleGroup(label: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openGroupLabel.set(this.openGroupLabel() === label ? null : label);
  }

  isGroupActive(group: Extract<ClientProfileNavEntry, { kind: 'group' }>): boolean {
    return group.tabs.some(tab => tab.id === this.activeTab());
  }

  openEditPanel(): void {
    this.isEditPanelOpen.set(true);
  }

  closeEditPanel(): void {
    this.isEditPanelOpen.set(false);
  }

  /** El form panel ya hizo el PATCH real (y actualizó ClientsStore) — acá solo se refleja en esta página. */
  handleClientSaved(updated: ClientItem): void {
    this.client.update(current => (current ? { ...current, ...updated } : current));
    this.closeEditPanel();
  }

  initials(client: ClientProfile): string {
    const words = client.displayName.trim().split(/\s+/);
    return words.length >= 2
      ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
      : client.displayName.substring(0, 2).toUpperCase();
  }

  avatarClass(client: ClientProfile): string {
    let hash = 0;
    for (let i = 0; i < client.id.length; i++) {
      hash = (hash * 31 + client.id.charCodeAt(i)) >>> 0;
    }
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  typeLabel(client: ClientProfile): string {
    return client.type === 'individual' ? 'Individual' : 'Company';
  }

  typeBadgeClass(client: ClientProfile): string {
    return client.type === 'individual' ? 'border-[#CFE2F7] text-indigo-600' : 'border-[#E8F1FB] text-orange-600';
  }

  statusChip(client: ClientProfile): string {
    return client.isActive ? 'border-emerald-200 text-emerald-600' : 'border-gray-300 text-gray-500';
  }

  statusDot(client: ClientProfile): string {
    return client.isActive ? 'bg-emerald-500' : 'bg-gray-400';
  }

  statusLabel(client: ClientProfile): string {
    return client.isActive ? 'Active' : 'Inactive';
  }
}
