import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ClientProfileOverviewComponent } from '../../ui/client-profile-overview/client-profile-overview.component';
import { ClientProfileInfoComponent } from '../../ui/client-profile-info/client-profile-info.component';
import { ClientProfileDocumentsComponent } from '../../ui/client-profile-documents/client-profile-documents.component';
import { ClientProfileInvoicesComponent } from '../../ui/client-profile-invoices/client-profile-invoices.component';
import { ClientProfileNotesComponent } from '../../ui/client-profile-notes/client-profile-notes.component';
import { ClientProfileCommunicationComponent } from '../../ui/client-profile-communication/client-profile-communication.component';
import { ClientProfile, SEED_CLIENT_PROFILES } from '../../models/client-profile.model';

export type ClientProfileTabId = 'overview' | 'info' | 'documents' | 'invoices' | 'notes' | 'communication';

interface ClientProfileTab {
  id: ClientProfileTabId;
  label: string;
}

const PROFILE_TABS: ClientProfileTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'info', label: 'Info' },
  { id: 'documents', label: 'Documents' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'notes', label: 'Notes' },
  { id: 'communication', label: 'Communication' },
];

/**
 * Shell del perfil de cliente (patrón "Aether" tipo takeover, con
 * navegación por tabs estilo invoice-preview + settings-page): header con
 * botón de volver, avatar/nombre/chips de tipo y estado, botón "Edit"
 * (solo visual por ahora), y fila de tabs tipo píldora. El contenido de cada
 * tab se resuelve por *ngSwitch sobre activeTab(); Documents/Invoices/Notes/
 * Communication quedan como placeholders a la espera de otro agente.
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
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-page.component.html',
})
export class ClientProfilePageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly tabs = PROFILE_TABS;
  readonly activeTab = signal<ClientProfileTabId>('overview');

  /**
   * Signal reactiva sobre paramMap (no un snapshot leído una sola vez): con
   * la RouteReuseStrategy de la app, navegar entre /clients/:id distintos
   * puede reutilizar esta misma instancia de componente en el lugar, así
   * que el id debe seguir actualizándose, no quedar congelado en el primero.
   */
  private readonly paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });

  readonly client = computed<ClientProfile>(() => {
    const id = this.paramMap().get('id');
    return SEED_CLIENT_PROFILES.find(item => item.id === id) ?? SEED_CLIENT_PROFILES[0];
  });

  private readonly avatarPalette = ['bg-indigo-500', 'bg-orange-500', 'bg-[#7C6AE0]', 'bg-emerald-500', 'bg-gray-900'];

  selectTab(id: ClientProfileTabId): void {
    this.activeTab.set(id);
  }

  initials(client: ClientProfile): string {
    const words = client.displayName.trim().split(/\s+/);
    return words.length >= 2
      ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
      : client.displayName.substring(0, 2).toUpperCase();
  }

  avatarClass(client: ClientProfile): string {
    const index = SEED_CLIENT_PROFILES.findIndex(item => item.id === client.id);
    return this.avatarPalette[Math.max(index, 0) % this.avatarPalette.length];
  }

  typeLabel(client: ClientProfile): string {
    return client.type === 'individual' ? 'Individual' : 'Company';
  }

  typeBadgeClass(client: ClientProfile): string {
    return client.type === 'individual' ? 'border-[#CBD9F2] text-indigo-600' : 'border-[#F2E3C9] text-orange-600';
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
