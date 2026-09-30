import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { ClientProfileOverviewComponent } from '../../ui/client-profile-overview/client-profile-overview.component';
import { ClientProfileInfoComponent } from '../../ui/client-profile-info/client-profile-info.component';
import { ClientDocumentsPanelComponent } from '../client-documents-panel/client-documents-panel.component';
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
import { customerToClientProfile } from '../../data-access/clients.model';
import { SaveRelationPayload } from '../../ui/client-profile-family/client-profile-family.component';
import {
  ClientProfileContactDetailsComponent,
  SaveAddressPayload,
  SaveContactPayload,
} from '../../ui/client-profile-contact-details/client-profile-contact-details.component';
import {
  ClientFiscalFormComponent,
  FiscalSpouseDraft,
  SaveFiscalPayload,
} from '../../ui/client-fiscal-form/client-fiscal-form.component';
import { ClientPermissions } from '../../data-access/client-permissions';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, finalize, map, of, switchMap } from 'rxjs';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import { ClientsService } from '../../data-access/clients.service';
import { CatalogOption } from '../../ui/catalog-picker/catalog-picker.component';
import {
  ClientEditSection,
  ClientSectionDraft,
  buildSectionUpdate,
  sectionDraftFromDetail,
} from '../../data-access/client-section-edit.model';
import { ClientSectionEditDialogComponent } from '../../ui/client-section-edit-dialog/client-section-edit-dialog.component';
import { ClientSmsStore } from '../../data-access/client-sms.store';
import { smsPhoneOptions } from '../../data-access/client-sms.model';
import { ClientSmsComposeComponent, ClientSmsDraft } from '../../ui/client-sms-compose/client-sms-compose.component';
import {
  WORKSPACE_ACCESS,
  WorkspaceLink,
  composeEmailLink,
  newSignatureRequestLink,
  scheduleMeetingLink,
} from '../../data-access/client-workspace-links';
import { ClientProfileActionsComponent } from '../../ui/client-profile-actions/client-profile-actions.component';
import { ClientProfileSignaturesComponent } from '../../ui/client-profile-signatures/client-profile-signatures.component';

/** El SSN/EIN revelado se vuelve a enmascarar solo pasado este tiempo. */
const REVEAL_TTL_MS = 30_000;

export type ClientProfileTabId =
  | 'overview'
  | 'info'
  | 'family'
  | 'documents'
  | 'invoices'
  | 'work'
  | 'notes'
  | 'communication'
  | 'signatures'
  | 'calls'
  | 'bank'
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
 * Se agrupan las tabs de Info, Finance y Activity para no alargar la fila de
 * píldoras (12 tabs individuales no cabían sin scroll horizontal). Info agrupa
 * los datos del cliente (Details) y su hogar fiscal (Family: cónyuge y
 * dependientes). Overview y Portal quedan sueltas.
 */
const PROFILE_NAV: ClientProfileNavEntry[] = [
  { kind: 'tab', id: 'overview', label: 'Overview' },
  {
    kind: 'group',
    label: 'Info',
    tabs: [
      { id: 'info', label: 'Details' },
      { id: 'family', label: 'Family' },
    ],
  },
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
      { id: 'signatures', label: 'Signatures' },
      { id: 'calls', label: 'Calls' },
      { id: 'reminders', label: 'Reminders' },
    ],
  },
  { kind: 'tab', id: 'portal', label: 'Portal' },
];

/**
 * B5 — qué hace falta para que una pestaña tenga contenido. Lo que no está acá no depende de
 * nada: Overview, Details y Family son el propio cliente, y quien llegó a esta pantalla ya pasó
 * por `customers.view`; Invoices, Bank y Mileage son estados vacíos declarados, sin backend
 * todavía. Lo que se gatea es lo que llama a OTRO servicio y hoy contesta 403 en silencio.
 */
const TAB_ACCESS: Partial<Record<ClientProfileTabId, AccessRequirement>> = {
  documents: { module: 'documents', anyOf: ['cloudstorage.file.view'] },
  work: { module: 'planner', anyOf: ['tasks.read'] },
  notes: { module: 'planner', anyOf: ['notes.read'] },
  reminders: { module: 'planner', anyOf: ['reminders.read'] },
  communication: { module: 'email', anyOf: ['correspondence.read'] },
  signatures: WORKSPACE_ACCESS.signatureRead,
  calls: { module: 'comms', anyOf: ['communication.call.start', 'communication.videocall.start'] },
};

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
 *    (carpetas del cliente: `/storage/folders?ownerType=Customer&ownerId=`) y
 *    Portal (invitar en Customer + estado/gestión en Auth `/auth/invitations|users?customerId=`).
 *  - Signatures: crear con el cliente precargado (deep link) — el LISTADO por cliente está
 *    bloqueado por el backend (sin filtro `customerId` en `/signature/requests`).
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
    ClientDocumentsPanelComponent,
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
    ClientSectionEditDialogComponent,
    ClientSmsComposeComponent,
    ClientProfileActionsComponent,
    ClientProfileSignaturesComponent,
    SkeletonComponent,
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
  /** Editar el cliente, sus direcciones, contactos y el hogar fiscal. */
  readonly canManage = this.caps.canManage;
  /** Destapar SSN/EIN. Permiso propio: poder editar al cliente NO alcanza. */
  readonly canReveal = this.caps.canRevealFiscal;

  private readonly access = inject(AccessStore);

  /**
   * La fila de pestañas, ya filtrada. Un grupo cuyas pestañas se fueron todas desaparece con
   * ellas: un desplegable vacío es peor que no tener el desplegable.
   */
  readonly navItems = computed<ClientProfileNavEntry[]>(() =>
    PROFILE_NAV.map(entry =>
      entry.kind === 'tab' ? entry : { ...entry, tabs: entry.tabs.filter(tab => this.canOpen(tab.id)) },
    ).filter(entry => (entry.kind === 'tab' ? this.canOpen(entry.id) : entry.tabs.length > 0)),
  );

  private canOpen(id: ClientProfileTabId): boolean {
    const requirement = TAB_ACCESS[id];
    return requirement === undefined || this.access.canUse(requirement);
  }

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
  /** Timer del re-enmascarado automático del SSN/EIN revelado. */
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- Workspace del cliente (acciones del header) ----------
  private readonly clientsService = inject(ClientsService);
  private readonly smsStore = inject(ClientSmsStore);

  readonly canSendSms = computed(() => this.access.canUse(WORKSPACE_ACCESS.sms));
  readonly canOpenBilling = computed(() => this.access.canUse(WORKSPACE_ACCESS.billing));
  readonly canOpenSignatures = computed(() => this.access.canUse(WORKSPACE_ACCESS.signatureRead));
  readonly canViewDocuments = computed(() => this.canOpen('documents'));

  readonly emailLink = computed<WorkspaceLink | null>(() => {
    const c = this.client();
    return c && c.email && this.access.canUse(WORKSPACE_ACCESS.email) ? composeEmailLink(c.id, c.email) : null;
  });
  readonly meetingLink = computed<WorkspaceLink | null>(() => {
    const c = this.client();
    return c && this.access.canUse(WORKSPACE_ACCESS.meeting) ? scheduleMeetingLink(c.id, c.displayName) : null;
  });
  readonly signatureLink = computed<WorkspaceLink | null>(() => {
    const c = this.client();
    return c && this.access.canUse(WORKSPACE_ACCESS.signature) ? newSignatureRequestLink(c.id, c.displayName) : null;
  });

  // SMS directo
  readonly isSmsOpen = signal(false);
  readonly smsError = signal<string | null>(null);
  readonly smsSending = this.smsStore.sending;
  readonly smsPhoneOptions = computed(() => {
    const c = this.client();
    return c ? smsPhoneOptions(c) : [];
  });

  // Edición por sección (Info)
  readonly editSection = signal<ClientEditSection | null>(null);
  readonly sectionInitial = signal<ClientSectionDraft | null>(null);
  readonly sectionLoading = signal(false);
  readonly sectionSaving = signal(false);
  readonly sectionError = signal<string | null>(null);

  /** Buscadores de catálogo para los pickers del modal de sección (arrow = `this` estable). */
  readonly searchOccupations = (q: string): Observable<CatalogOption[]> =>
    this.clientsService.listOccupations(q).pipe(map(list => list.map(o => ({ id: o.id, label: o.name }))));
  readonly searchBusinessActivities = (q: string): Observable<CatalogOption[]> =>
    this.clientsService
      .listBusinessActivities(q)
      .pipe(map(list => list.map(a => ({ id: a.id, label: a.description, hint: a.naicsCode }))));

  readonly isFiscalFormOpen = signal(false);
  readonly savingFiscal = signal(false);

  /** Cónyuge en ficha: el formulario fiscal lo precarga con "Married filing jointly". */
  readonly spouseRelation = computed(
    () => this.client()?.relations.find(relation => relation.relationshipKind === 'Spouse') ?? null,
  );

  readonly savingRelation = signal(false);
  readonly relationError = signal<string | null>(null);

  /** Guardando una dirección o punto de contacto (deshabilita los forms mientras dura). */
  readonly savingContactDetails = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="profile-tab-group"]')) {
      this.openGroupLabel.set(null);
    }
  }

  constructor() {
    // Salir del perfil (o destruirlo) nunca deja un SSN/EIN en claro ni un timer vivo.
    inject(DestroyRef).onDestroy(() => this.clearRevealTimer());
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
    this.hideTaxId();
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
   * No se lee la respuesta: el PATCH responde 204 sin body (Angular emite `null`),
   * y leer `saved.id` de ahí tumbaba la detección de cambios y dejaba el modal en
   * "Saving…". El detalle (`GET /customers/{id}`) ya trae `relations`, así que
   * basta con recargar el cliente.
   */
  handleSaveRelation(payload: SaveRelationPayload): void {
    const client = this.client();
    if (!client || this.savingRelation()) {
      return;
    }
    this.savingRelation.set(true);
    this.relationError.set(null);
    const call: Observable<unknown> = payload.id
      ? this.store.updateRelation(client.id, payload.id, payload.req)
      : this.store.addRelation(client.id, payload.req);
    call.subscribe({
      next: () => {
        this.savingRelation.set(false);
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
        // Re-enmascarado automático: el dato en claro no se queda en pantalla indefinidamente.
        this.clearRevealTimer();
        this.revealTimer = setTimeout(() => this.hideTaxId(), REVEAL_TTL_MS);
      },
      error: err => {
        this.revealingTaxId.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  /** Vuelve a enmascarar el identificador (botón Hide, timer, cambio de pestaña o de cliente). */
  hideTaxId(): void {
    this.clearRevealTimer();
    this.revealedTaxId.set(null);
  }

  private clearRevealTimer(): void {
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  // ---------- Edición por sección (Contact / Personal / Business) ----------

  /**
   * Abre el modal de UNA sección. El borrador se precarga del detalle fresco (partes del nombre,
   * ocupación, actividad — el `ClientProfile` de la vista no las trae).
   */
  openSectionEdit(section: ClientEditSection): void {
    const client = this.client();
    if (!client) {
      return;
    }
    this.editSection.set(section);
    this.sectionInitial.set(null);
    this.sectionError.set(null);
    this.sectionLoading.set(true);
    this.store.getById(client.id).subscribe({
      next: detail => {
        this.sectionInitial.set(sectionDraftFromDetail(detail, section));
        this.sectionLoading.set(false);
      },
      error: err => {
        this.sectionLoading.set(false);
        this.sectionError.set(toApiError(err).message);
      },
    });
  }

  closeSectionEdit(): void {
    this.editSection.set(null);
    this.sectionInitial.set(null);
    this.sectionError.set(null);
  }

  /**
   * Guarda una sección. El PATCH aplica siempre email/teléfono/idioma/canal/ocupación, así que se
   * relee el detalle y se le superpone la sección (`buildSectionUpdate`) — editar el nombre no
   * borra el teléfono. Estado y SSN no se tocan (isActive = el actual, sin tax id).
   */
  handleSaveSection(draft: ClientSectionDraft): void {
    const client = this.client();
    if (!client || this.sectionSaving()) {
      return;
    }
    this.sectionSaving.set(true);
    this.sectionError.set(null);
    this.store
      .getById(client.id)
      .pipe(
        switchMap(detail =>
          this.store.updateClient(client.id, buildSectionUpdate(detail, draft), {
            taxIdentifier: '',
            subjectKind: detail.kind,
            isActive: detail.status === 'Active',
          }),
        ),
        finalize(() => this.sectionSaving.set(false)),
      )
      .subscribe({
        next: () => {
          this.closeSectionEdit();
          this.loadClient(client.id);
          this.toast.success('Changes saved');
        },
        error: err => {
          const apiError = toApiError(err);
          this.sectionError.set(
            apiError.code === 'Customer.EmailAlreadyInUse' ? 'This email already belongs to another client.' : apiError.message,
          );
        },
      });
  }

  // ---------- SMS directo ----------

  openSms(): void {
    this.smsError.set(null);
    this.isSmsOpen.set(true);
  }

  closeSms(): void {
    this.isSmsOpen.set(false);
  }

  handleSendSms(draft: ClientSmsDraft): void {
    const client = this.client();
    if (!client || this.smsSending()) {
      return;
    }
    this.smsError.set(null);
    this.smsStore.send(client.id, draft.to, client.displayName, draft.body).subscribe(outcome => {
      if (outcome.ok) {
        this.isSmsOpen.set(false);
        this.toast.success(outcome.message);
      } else {
        this.smsError.set(outcome.message);
      }
    });
  }

  /** Desde el modal de SMS sin número: abre la edición del contacto. */
  smsToContactEdit(): void {
    this.isSmsOpen.set(false);
    this.openSectionEdit('contact');
  }

  // ---------- Perfil fiscal ----------

  openFiscalForm(): void {
    this.isFiscalFormOpen.set(true);
  }

  closeFiscalForm(): void {
    this.isFiscalFormOpen.set(false);
  }

  /**
   * Perfil fiscal y, con "Married filing jointly", el cónyuge: PUT fiscal-profile →
   * POST/PATCH de la relación → PUT de su SSN (si se escribió). Si algo falla a mitad,
   * se recarga igual el cliente: así el formulario adopta el cónyuge ya creado y el
   * reintento hace PATCH en vez de duplicarlo.
   */
  handleSaveFiscal(payload: SaveFiscalPayload): void {
    const client = this.client();
    if (!client || this.savingFiscal()) {
      return;
    }
    this.savingFiscal.set(true);
    this.store
      .setFiscalProfile(client.id, payload.profile)
      .pipe(
        switchMap(() => this.saveFiscalSpouse(client.id, payload.spouse)),
        finalize(() => this.savingFiscal.set(false)),
      )
      .subscribe({
        next: () => {
          this.isFiscalFormOpen.set(false);
          this.hideTaxId(); // el id cambió; no dejar un reveal viejo colgado
          this.loadClient(client.id);
          this.toast.success('Tax profile saved');
        },
        error: err => {
          this.loadClient(client.id);
          this.toast.error(toApiError(err).message);
        },
      });
  }

  private saveFiscalSpouse(customerId: string, spouse: FiscalSpouseDraft | null): Observable<unknown> {
    if (!spouse) {
      return of(null);
    }
    const { req, taxIdentifier } = spouse;
    const relationId$: Observable<string | null> = !req
      ? of(spouse.id)
      : spouse.id
        ? this.store.updateRelation(customerId, spouse.id, req).pipe(map(() => spouse.id))
        : this.store.addRelation(customerId, req).pipe(map(created => created.id));
    return relationId$.pipe(
      switchMap(relationId =>
        relationId && taxIdentifier
          ? this.store.setRelationFiscalProfile(customerId, relationId, {
              role: 'Spouse',
              taxIdentifier,
              // Se declara el año fiscal anterior al calendario (en 2026 se presenta el 2025).
              taxYear: new Date().getFullYear() - 1,
              qualifiesAsDependent: false,
              livedWithTaxpayer: true,
            })
          : of(null),
      ),
    );
  }

  selectTab(id: ClientProfileTabId): void {
    // Nunca se abre lo que la fila no muestra: el deep link `?tab=notes` de mañana, o un estado
    // viejo cuando el plan cambia en vivo, entrarían por acá.
    if (!this.canOpen(id)) {
      return;
    }
    if (id !== this.activeTab()) {
      // Cambiar de pestaña re-enmascara: el dato en claro no viaja a otra vista.
      this.hideTaxId();
    }
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
