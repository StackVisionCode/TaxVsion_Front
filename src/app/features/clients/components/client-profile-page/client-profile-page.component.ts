import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ClientProfileOverviewComponent } from '../../ui/client-profile-overview/client-profile-overview.component';
import { ClientProfileInfoComponent } from '../../ui/client-profile-info/client-profile-info.component';
import { ClientProfileDocumentsComponent } from '../../ui/client-profile-documents/client-profile-documents.component';
import { ClientProfileWorkComponent } from '../../ui/client-profile-work/client-profile-work.component';
import { ClientProfileRequestsComponent } from '../../ui/client-profile-requests/client-profile-requests.component';
import { ClientProfileInvoicesComponent } from '../../ui/client-profile-invoices/client-profile-invoices.component';
import { ClientProfileNotesComponent } from '../../ui/client-profile-notes/client-profile-notes.component';
import { ClientProfileCommunicationComponent } from '../../ui/client-profile-communication/client-profile-communication.component';
import { ClientChatCardComponent } from '../../ui/client-chat-card/client-chat-card.component';
import { ClientProfileCallsComponent } from '../../ui/client-profile-calls/client-profile-calls.component';
import { ClientProfileBankComponent } from '../../ui/client-profile-bank/client-profile-bank.component';
import { ClientProfileFamilyComponent } from '../../ui/client-profile-family/client-profile-family.component';
import { ClientProfileRemindersComponent } from '../../ui/client-profile-reminders/client-profile-reminders.component';
import { ClientProfileMileageComponent } from '../../ui/client-profile-mileage/client-profile-mileage.component';
import { ClientProfilePortalComponent } from '../../ui/client-profile-portal/client-profile-portal.component';
import { ClientProfile } from '../../models/client-profile.model';
import { ClientFormPanelComponent } from '../../ui/client-form-panel/client-form-panel.component';
import { ClientItem } from '../../ui/client-table/client-table.component';
import { ClientsStore } from '../../data-access/clients.store';
import { RelationResponse, customerToClientProfile } from '../../data-access/clients.model';
import { SaveRelationPayload } from '../../ui/client-profile-family/client-profile-family.component';
import {
  ClientProfileContactDetailsComponent,
  SaveAddressPayload,
  SaveContactPayload,
} from '../../ui/client-profile-contact-details/client-profile-contact-details.component';
import { ClientFiscalFormComponent } from '../../ui/client-fiscal-form/client-fiscal-form.component';
import { ClientPermissions } from '../../data-access/client-permissions';
import { SetCustomerFiscalProfileRequest } from '../../data-access/clients.model';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '@shared/ui/toast/toast.service';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

export type ClientProfileTabId =
  | 'overview'
  | 'info'
  | 'documents'
  | 'invoices'
  | 'work'
  | 'notes'
  | 'communication'
  | 'calls'
  | 'bank'
  | 'family'
  | 'reminders'
  | 'mileage'
  | 'portal';

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
      { id: 'work', label: 'Work' },
      { id: 'documents', label: 'Documents' },
      { id: 'notes', label: 'Notes' },
      { id: 'communication', label: 'Communication' },
      { id: 'calls', label: 'Calls' },
      { id: 'family', label: 'Family' },
      { id: 'reminders', label: 'Reminders' },
    ],
  },
  { kind: 'tab', id: 'portal', label: 'Portal' },
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
 *    Notes (`/notes?targetType=Customer&targetId=`), Communication
 *    (`/correspondence/customers/{id}/threads`), Work
 *    (`/tasks/by-customer/{id}` — cada tarea lleva `customerId`), Documents
 *    (`/storage/files?ownerType=Customer&ownerId=` — filtro de dueño de staff) y
 *    Portal (invitar en Customer + estado/gestión en Auth `/auth/invitations|users?customerId=`).
 *  - REAL pero NO filtrable por cliente: Reminders (el servicio Reminder no
 *    tiene categoría `Customer`); lo declara en pantalla.
 *  - VACÍAS A PROPÓSITO, sin backend que las respalde por cliente: Overview
 *    (parcial), Invoices, Bank, Mileage y Calls. Cada
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
    ClientProfileWorkComponent,
    ClientProfileRequestsComponent,
    ClientProfileInvoicesComponent,
    ClientProfileNotesComponent,
    ClientProfileCommunicationComponent,
    ClientChatCardComponent,
    ClientProfileCallsComponent,
    ClientProfileBankComponent,
    ClientProfileFamilyComponent,
    ClientProfileRemindersComponent,
    ClientProfileMileageComponent,
    ClientProfilePortalComponent,
    ClientProfileContactDetailsComponent,
    ClientFiscalFormComponent,
    ClientFormPanelComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-page.component.html',
})
export class ClientProfilePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(ClientsStore);
  private readonly toast = inject(ToastService);
  private readonly caps = inject(ClientPermissions);

  /** Puede crear/editar el perfil fiscal (customers.manage + actor admin). */
  readonly canEditFiscal = this.caps.canSetFiscalProfile;

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
  /** Tipo de fallo de carga, para elegir el estado (no encontrado/sin acceso · sin red · genérico). */
  readonly loadErrorKind = signal<'not-found' | 'network' | 'error'>('error');
  readonly client = signal<ClientProfile | null>(null);

  readonly isEditPanelOpen = signal(false);

  /**
   * `ClientFormPanelComponent` (compartido con el directorio) espera un
   * `ClientItem` — que trae `address: string`, campo que `ClientProfile` ya
   * no tiene (reemplazado por `addresses[]` real). Se adapta acá en vez de
   * tocar el form panel, que además lo usa el directorio con datos que sí
   * traen ese campo tal cual.
   */
  readonly editClientItem = computed(() => {
    const c = this.client();
    if (!c) {
      return null;
    }
    const primary = c.addresses.find(a => a.isPrimary) ?? c.addresses[0];
    return {
      id: c.id,
      type: c.type,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
      address: primary ? `${primary.line1}, ${primary.city}` : '',
      isActive: c.isActive,
      createdAt: c.createdAt,
      individual: c.individual,
      company: c.company,
    };
  });

  readonly revealedTaxId = signal<string | null>(null);
  readonly revealingTaxId = signal(false);

  readonly isFiscalFormOpen = signal(false);
  readonly savingFiscal = signal(false);

  readonly savingRelation = signal(false);
  readonly relationError = signal<string | null>(null);

  /** Guardando una dirección o punto de contacto (deshabilita los forms mientras dura). */
  readonly savingContactDetails = signal(false);

  /**
   * Relaciones creadas/editadas en ESTA sesión.
   *
   * El backend expone `POST/PATCH/DELETE /customers/{id}/relations` pero
   * **ningún GET**, y `GET /customers/{id}` devuelve `CustomerResponse` (solo
   * escalares, sin `relations`). Sin esto el usuario guardaba un dependiente y
   * lo veía desaparecer en el acto — `loadClient()` vuelve a pedir el detalle,
   * que llega sin relaciones — sin saber si se había guardado o no.
   *
   * Se mantienen en memoria para que el trabajo de la sesión siga a la vista.
   * La pestaña avisa explícitamente de que al recargar la página la lista se
   * vacía aunque los datos SÍ quedaron guardados en el servidor.
   */
  readonly sessionRelations = signal<RelationResponse[]>([]);

  /**
   * `client` + lo guardado en la sesión, que es lo que ve la pestaña Family.
   * Si el backend algún día devuelve `relations` en el detalle, lo del
   * servidor manda y esto se vuelve un no-op sin tocar nada más.
   */
  readonly familyClient = computed<ClientProfile | null>(() => {
    const client = this.client();
    if (!client) {
      return null;
    }
    const session = this.sessionRelations();
    if (session.length === 0) {
      return client;
    }
    const fromServer = new Set(client.relations.map(relation => relation.id));
    return {
      ...client,
      relations: [...client.relations, ...session.filter(relation => !fromServer.has(relation.id))],
    };
  });

  /** true = la lista de la pestaña Family solo existe en memoria (no hay GET de relaciones). */
  readonly relationsAreSessionOnly = computed(() => (this.client()?.relations.length ?? 0) === 0);

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
        // Otro cliente ⇒ lo acumulado en memoria no le pertenece.
        this.sessionRelations.set([]);
        this.loadClient(id);
      }
    });
  }

  private loadClient(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.revealedTaxId.set(null);
    this.relationError.set(null);
    this.store.getById(id).subscribe({
      next: customer => {
        this.client.set(customerToClientProfile(customer));
        this.loading.set(false);
      },
      error: err => {
        const apiError = toApiError(err);
        const status = err instanceof HttpErrorResponse ? err.status : -1;
        // 404/403 se tratan igual a propósito: el backend no revela si el cliente existe en otro
        // tenant (el filtro de tenant lo hace parecer un 404), así que el estado no distingue
        // "no existe" de "sin acceso" — cubre ambos sin filtrar la existencia.
        this.loadErrorKind.set(
          status === 404 || status === 403 ? 'not-found' : apiError.code === NETWORK_ERROR_CODE ? 'network' : 'error',
        );
        this.loadError.set(apiError.message);
        this.loading.set(false);
      },
    });
  }

  /** Reintenta la carga del cliente actual (botón del estado de error). */
  retryLoad(): void {
    const id = this.paramMap().get('id');
    if (id) {
      this.loadClient(id);
    }
  }

  /**
   * Alta/edición de una relación (dependiente o cónyuge).
   *
   * La respuesta del POST/PATCH **es** la fuente de verdad de lo que quedó
   * guardado: no hay GET de relaciones al que volver a preguntar, así que se
   * guarda en `sessionRelations` en vez de descartarla. Igual se recarga el
   * cliente porque el alta puede tocar campos escalares del detalle.
   */
  handleSaveRelation(payload: SaveRelationPayload): void {
    const client = this.client();
    if (!client || this.savingRelation()) {
      return;
    }
    this.savingRelation.set(true);
    this.relationError.set(null);
    const call = payload.id
      ? this.store.updateRelation(client.id, payload.id, payload.req)
      : this.store.addRelation(client.id, payload.req);
    call.subscribe({
      next: saved => {
        this.savingRelation.set(false);
        this.sessionRelations.update(list => [...list.filter(relation => relation.id !== saved.id), saved]);
        this.loadClient(client.id);
      },
      error: err => {
        this.savingRelation.set(false);
        this.relationError.set(toApiError(err).message);
      },
    });
  }

  handleDeleteRelation(relationId: string): void {
    const client = this.client();
    if (!client || this.savingRelation()) {
      return;
    }
    this.savingRelation.set(true);
    this.relationError.set(null);
    this.store.deleteRelation(client.id, relationId).subscribe({
      next: () => {
        this.savingRelation.set(false);
        this.sessionRelations.update(list => list.filter(relation => relation.id !== relationId));
        this.loadClient(client.id);
      },
      error: err => {
        this.savingRelation.set(false);
        this.relationError.set(toApiError(err).message);
      },
    });
  }

  // ---------- Direcciones y puntos de contacto (sub-recursos del detalle) ----------

  handleSaveAddress(payload: SaveAddressPayload): void {
    const client = this.client();
    if (!client || this.savingContactDetails()) {
      return;
    }
    this.savingContactDetails.set(true);
    const call = payload.id
      ? this.store.updateAddress(client.id, payload.id, payload.req)
      : this.store.addAddress(client.id, payload.req);
    call.subscribe({
      next: () => {
        this.savingContactDetails.set(false);
        this.loadClient(client.id);
        this.toast.success(payload.id ? 'Address updated' : 'Address added');
      },
      error: err => {
        this.savingContactDetails.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  handleDeleteAddress(addressId: string): void {
    const client = this.client();
    if (!client || this.savingContactDetails()) {
      return;
    }
    this.savingContactDetails.set(true);
    this.store.deleteAddress(client.id, addressId).subscribe({
      next: () => {
        this.savingContactDetails.set(false);
        this.loadClient(client.id);
        this.toast.success('Address removed');
      },
      error: err => {
        this.savingContactDetails.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  handleSaveContact(payload: SaveContactPayload): void {
    const client = this.client();
    if (!client || this.savingContactDetails()) {
      return;
    }
    this.savingContactDetails.set(true);
    const call = payload.id
      ? this.store.updateContactPoint(client.id, payload.id, payload.req)
      : this.store.addContactPoint(client.id, payload.req);
    call.subscribe({
      next: () => {
        this.savingContactDetails.set(false);
        this.loadClient(client.id);
        this.toast.success(payload.id ? 'Contact updated' : 'Contact added');
      },
      error: err => {
        this.savingContactDetails.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  handleDeleteContact(contactId: string): void {
    const client = this.client();
    if (!client || this.savingContactDetails()) {
      return;
    }
    this.savingContactDetails.set(true);
    this.store.deleteContactPoint(client.id, contactId).subscribe({
      next: () => {
        this.savingContactDetails.set(false);
        this.loadClient(client.id);
        this.toast.success('Contact removed');
      },
      error: err => {
        this.savingContactDetails.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  handleRevealTaxId(customerId: string): void {
    if (this.revealingTaxId()) {
      return;
    }
    this.revealingTaxId.set(true);
    this.store.revealTaxIdentifier(customerId).subscribe({
      next: response => {
        this.revealedTaxId.set(response.taxIdentifier);
        this.revealingTaxId.set(false);
      },
      error: err => {
        this.revealingTaxId.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  // ---------- Perfil fiscal ----------

  openFiscalForm(): void {
    this.isFiscalFormOpen.set(true);
  }

  closeFiscalForm(): void {
    this.isFiscalFormOpen.set(false);
  }

  handleSaveFiscal(req: SetCustomerFiscalProfileRequest): void {
    const client = this.client();
    if (!client || this.savingFiscal()) {
      return;
    }
    this.savingFiscal.set(true);
    this.store.setFiscalProfile(client.id, req).subscribe({
      next: () => {
        this.savingFiscal.set(false);
        this.isFiscalFormOpen.set(false);
        this.revealedTaxId.set(null); // el id cambió; no dejar un reveal viejo colgado
        this.loadClient(client.id);
        this.toast.success('Tax profile saved');
      },
      error: err => {
        this.savingFiscal.set(false);
        this.toast.error(toApiError(err).message);
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

  /**
   * El form panel ya hizo el PATCH real (y actualizó ClientsStore) — acá solo
   * se refleja en esta página. No se spreadea `updated` completo: `ClientItem`
   * (fila de listado) trae `address: string`, un campo que `ClientProfile` ya
   * no tiene (reemplazado por `addresses[]` real) — solo se copian los campos
   * que sí se solapan, las colecciones reales de este cliente se conservan.
   */
  handleClientSaved(updated: ClientItem): void {
    // Parche inmediato para feedback instantáneo…
    this.client.update(current =>
      current
        ? {
            ...current,
            displayName: updated.displayName,
            email: updated.email,
            phone: updated.phone,
            isActive: updated.isActive,
            individual: updated.individual,
            company: updated.company,
          }
        : current,
    );
    this.closeEditPanel();
    // …y recarga del detalle: los campos derivados del detalle (occupation, DOB) no vienen en el
    // ClientItem del evento; sin esto se veían "—" hasta recargar la página (misma política que el
    // resto de mutaciones del perfil).
    const id = this.client()?.id;
    if (id) {
      this.loadClient(id);
    }
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
    return client.type === 'individual' ? 'border-indigo-100 text-indigo-600' : 'border-indigo-50 text-orange-600';
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
