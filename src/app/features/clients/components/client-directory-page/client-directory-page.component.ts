import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientItem, ClientTableComponent, ClientType } from '../../ui/client-table/client-table.component';
import { ClientFormPanelComponent } from '../../ui/client-form-panel/client-form-panel.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';

type TypeFilter = 'all' | ClientType;
type StatusFilter = 'all' | 'active' | 'inactive';
const PAGE_SIZE = 8;

/** Builds a YYYY-MM-DD date string relative to today so the mock clients always look alive. */
function dateAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const SEED_CLIENTS: ClientItem[] = [
  {
    id: 'client-1',
    type: 'individual',
    displayName: 'Maria Alvarez',
    email: 'maria.alvarez@example.com',
    phone: '(305) 555-0142',
    address: '128 Palm Ave, Miami, FL 33101',
    isActive: true,
    createdAt: dateAgo(410),
    individual: { ssnOrItin: '412-55-8821', dateOfBirth: '1985-03-14', occupation: 'Nurse', maritalStatus: 'Married' },
  },
  {
    id: 'client-2',
    type: 'individual',
    displayName: 'Robert Kim',
    email: 'robert.kim@example.com',
    phone: '(212) 555-0187',
    address: '45 Bedford St, New York, NY 10014',
    isActive: true,
    createdAt: dateAgo(365),
    individual: {
      ssnOrItin: '598-21-3340',
      dateOfBirth: '1978-11-02',
      occupation: 'Software Developer',
      maritalStatus: 'Single',
    },
  },
  {
    id: 'client-3',
    type: 'company',
    displayName: 'Sunrise Bakery Inc.',
    email: 'billing@sunrisebakery.com',
    phone: '(617) 555-0199',
    address: '900 Harbor St, Boston, MA 02110',
    isActive: true,
    createdAt: dateAgo(720),
    company: {
      ein: '82-1092334',
      formationDate: '2015-06-01',
      businessStructure: 'S-Corp',
      principalBusinessActivity: 'Retail bakery and wholesale pastry supply',
    },
  },
  {
    id: 'client-4',
    type: 'individual',
    displayName: 'Sarah Kim',
    email: 'sarah.kim@example.com',
    phone: '(415) 555-0163',
    address: '77 Market St, San Francisco, CA 94103',
    isActive: false,
    createdAt: dateAgo(540),
    individual: {
      ssnOrItin: '601-88-2245',
      dateOfBirth: '1990-07-22',
      occupation: 'Teacher',
      maritalStatus: 'Divorced',
    },
  },
  {
    id: 'client-5',
    type: 'individual',
    displayName: 'Marcus Webb',
    email: 'marcus.webb@example.com',
    phone: '(773) 555-0121',
    address: '210 Lakeshore Dr, Chicago, IL 60601',
    isActive: true,
    createdAt: dateAgo(120),
    individual: {
      ssnOrItin: '339-76-1190',
      dateOfBirth: '1982-01-09',
      occupation: 'Sales Representative',
      maritalStatus: 'Married',
    },
  },
  {
    id: 'client-6',
    type: 'company',
    displayName: 'Webb Holdings',
    email: 'accounts@webbholdings.com',
    phone: '(773) 555-0122',
    address: '210 Lakeshore Dr, Chicago, IL 60601',
    isActive: true,
    createdAt: dateAgo(120),
    company: {
      ein: '47-6633210',
      formationDate: '2019-02-18',
      businessStructure: 'LLC',
      principalBusinessActivity: 'Commercial real estate holding',
    },
  },
  {
    id: 'client-7',
    type: 'individual',
    displayName: 'James Cooper',
    email: 'james.cooper@example.com',
    phone: '(206) 555-0177',
    address: '318 Pine St, Seattle, WA 98101',
    isActive: true,
    createdAt: dateAgo(200),
    individual: {
      ssnOrItin: '512-44-9932',
      dateOfBirth: '1975-09-30',
      occupation: 'Business Owner',
      maritalStatus: 'Married',
    },
  },
  {
    id: 'client-8',
    type: 'company',
    displayName: 'Ferreira S-Corp',
    email: 'info@ferreiragroup.com',
    phone: '(305) 555-0155',
    address: '600 Brickell Ave, Miami, FL 33131',
    isActive: false,
    createdAt: dateAgo(900),
    company: {
      ein: '65-3321099',
      formationDate: '2012-04-10',
      businessStructure: 'C-Corp',
      principalBusinessActivity: 'Import and export of consumer electronics',
    },
  },
  {
    id: 'client-9',
    type: 'individual',
    displayName: 'Delgado Trust',
    email: 'delgado.trust@example.com',
    phone: '(602) 555-0133',
    address: '55 Camelback Rd, Phoenix, AZ 85012',
    isActive: true,
    createdAt: dateAgo(60),
    individual: {
      ssnOrItin: '229-10-7765',
      dateOfBirth: '1960-05-17',
      occupation: 'Retired',
      maritalStatus: 'Widowed',
    },
  },
  {
    id: 'client-10',
    type: 'individual',
    displayName: 'Aisha Thompson',
    email: 'aisha.thompson@example.com',
    phone: '(404) 555-0144',
    address: '812 Peachtree St, Atlanta, GA 30308',
    isActive: true,
    createdAt: dateAgo(30),
    individual: {
      ssnOrItin: '380-92-4471',
      dateOfBirth: '1993-12-05',
      occupation: 'Accountant',
      maritalStatus: 'Single',
    },
  },
  {
    id: 'client-11',
    type: 'company',
    displayName: 'Nguyen Enterprises',
    email: 'finance@nguyenent.com',
    phone: '(714) 555-0198',
    address: '1420 Bristol St, Costa Mesa, CA 92626',
    isActive: true,
    createdAt: dateAgo(310),
    company: {
      ein: '91-4482210',
      formationDate: '2017-08-23',
      businessStructure: 'Partnership',
      principalBusinessActivity: 'Restaurant management and catering services',
    },
  },
  {
    id: 'client-12',
    type: 'individual',
    displayName: 'Elena Vargas',
    email: 'elena.vargas@example.com',
    phone: '(512) 555-0109',
    address: '34 Congress Ave, Austin, TX 78701',
    isActive: false,
    createdAt: dateAgo(650),
    individual: {
      ssnOrItin: '447-63-8820',
      dateOfBirth: '1988-02-28',
      occupation: 'Engineer',
      maritalStatus: 'Married',
    },
  },
  {
    id: 'client-13',
    type: 'company',
    displayName: 'Summit Bakery Inc.',
    email: 'contact@summitbakery.com',
    phone: '(303) 555-0166',
    address: '77 16th St, Denver, CO 80202',
    isActive: true,
    createdAt: dateAgo(480),
    company: {
      ein: '33-9021145',
      formationDate: '2014-10-12',
      businessStructure: 'Sole Proprietorship',
      principalBusinessActivity: 'Neighborhood bakery and coffee shop',
    },
  },
  {
    id: 'client-14',
    type: 'individual',
    displayName: 'David Chen',
    email: 'david.chen@example.com',
    phone: '(646) 555-0175',
    address: '221 Bowery, New York, NY 10002',
    isActive: true,
    createdAt: dateAgo(15),
    individual: {
      ssnOrItin: '509-24-6631',
      dateOfBirth: '1997-06-19',
      occupation: 'Software Developer',
      maritalStatus: 'Single',
    },
  },
  {
    id: 'client-15',
    type: 'individual',
    displayName: 'Priya Natarajan',
    email: 'priya.natarajan@example.com',
    phone: '(858) 555-0188',
    address: '900 Prospect St, La Jolla, CA 92037',
    isActive: true,
    createdAt: dateAgo(95),
    individual: {
      ssnOrItin: '621-37-9012',
      dateOfBirth: '1983-10-11',
      occupation: 'Business Owner',
      maritalStatus: 'Married',
    },
  },
  {
    id: 'client-16',
    type: 'company',
    displayName: 'James Cooper Consulting',
    email: 'billing@jcconsulting.com',
    phone: '(206) 555-0178',
    address: '318 Pine St, Seattle, WA 98101',
    isActive: false,
    createdAt: dateAgo(700),
    company: {
      ein: '76-2210983',
      formationDate: '2011-01-05',
      businessStructure: 'LLC',
      principalBusinessActivity: 'Management consulting services',
    },
  },
];

/**
 * Página del directorio de clientes (estilo "Aether", mismo patrón que
 * invoices-page): stats pastel + filtros de tipo/estado + búsqueda + tabla
 * de clientes + panel de creación/edición. Todo el estado vive en signals
 * dentro de esta página, sin servicios ni backend. Reemplaza al sistema
 * completo de "cuentas" del CRM original (detección de duplicados,
 * validación de zip/dirección, importación masiva) por una versión
 * simplificada de directorio + formulario dual Individual/Company.
 */
@Component({
  selector: 'app-client-directory-page',
  imports: [
    CommonModule,
    FormsModule,
    ClientTableComponent,
    ClientFormPanelComponent,
    PaginationComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-directory-page.component.html',
})
export class ClientDirectoryPageComponent {
  readonly clients = signal<ClientItem[]>(SEED_CLIENTS);

  readonly typeFilter = signal<TypeFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingClient = signal<ClientItem | null>(null);
  readonly pendingDelete = signal<ClientItem | null>(null);

  readonly deleteMessage = computed(() => {
    const client = this.pendingDelete();
    return client ? `You're about to delete client ${client.displayName}. This can't be undone.` : '';
  });

  readonly totalClients = computed(() => this.clients().length);
  readonly activeClients = computed(() => this.clients().filter(client => client.isActive).length);
  readonly individualClients = computed(() => this.clients().filter(client => client.type === 'individual').length);
  readonly companyClients = computed(() => this.clients().filter(client => client.type === 'company').length);

  readonly visibleClients = computed<ClientItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.statusFilter();
    return this.clients()
      .filter(client => type === 'all' || client.type === type)
      .filter(
        client => status === 'all' || (status === 'active' ? client.isActive : !client.isActive),
      )
      .filter(
        client =>
          !query ||
          client.displayName.toLowerCase().includes(query) ||
          client.email.toLowerCase().includes(query),
      );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedClients = computed<ClientItem[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleClients().slice(start, start + PAGE_SIZE);
  });

  setTypeFilter(filter: TypeFilter): void {
    this.typeFilter.set(filter);
    this.currentPage.set(1);
  }

  setStatusFilter(filter: StatusFilter): void {
    this.statusFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  openCreatePanel(): void {
    this.editingClient.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(client: ClientItem): void {
    this.editingClient.set(client);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingClient.set(null);
  }

  handleSaved(client: ClientItem): void {
    this.clients.update(list => {
      const exists = list.some(item => item.id === client.id);
      return exists ? list.map(item => (item.id === client.id ? client : item)) : [...list, client];
    });
    this.closePanel();
  }

  toggleActive(client: ClientItem): void {
    this.clients.update(list =>
      list.map(item => (item.id === client.id ? { ...item, isActive: !item.isActive } : item)),
    );
  }

  deleteClient(client: ClientItem): void {
    this.pendingDelete.set(client);
  }

  confirmDelete(): void {
    const client = this.pendingDelete();
    if (!client) {
      return;
    }
    this.clients.update(list => list.filter(item => item.id !== client.id));
    this.pendingDelete.set(null);
  }
}
