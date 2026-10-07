import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { ClientProfileOverviewComponent } from '../../ui/client-profile-overview/client-profile-overview.component';
import { ClientProfileInfoComponent } from '../../ui/client-profile-info/client-profile-info.component';
// Excepción a "una feature no importa de otra": los módulos completos del CRM fijos a este cliente
// (patrón `@core/customers/embedded-customer`: mismo diseño que su página, su propio store). Se
// montan con @defer, así que cada uno viaja en su propio chunk.
import { ClientDocumentsWorkspaceComponent } from '../../../documents/components/client-documents-workspace/client-documents-workspace.component';
import { ClientSignatureWorkspaceComponent } from '../../../signature/components/client-signature-workspace/client-signature-workspace.component';
import { ClientTaskWorkspaceComponent } from '../../../task/components/client-task-workspace/client-task-workspace.component';
import { ClientBillingWorkspaceComponent } from '../../../billing/components/client-billing-workspace/client-billing-workspace.component';
import { ClientMailWorkspaceComponent } from '../../../mail/components/client-mail-workspace/client-mail-workspace.component';
import { ClientSmsWorkspaceComponent } from '../../../sms/components/client-sms-workspace/client-sms-workspace.component';
import { ClientMeetingsWorkspaceComponent } from '../../../meetings/components/client-meetings-workspace/client-meetings-workspace.component';
import { ClientProfileRequestsComponent } from '../../ui/client-profile-requests/client-profile-requests.component';
import { ClientProfileNotesComponent } from '../../ui/client-profile-notes/client-profile-notes.component';
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
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { ClientsService } from '../../data-access/clients.service';
import { ClientSmsService } from '../../data-access/client-sms.service';
import { clientSmsErrorMessage, clientSmsOutcome, clientSmsPhoneOptions } from '../../data-access/client-sms.model';
import { CustomerDetailResponse } from '../../data-access/clients.model';
import {
  ClientSectionEditDialogComponent,
  SectionCatalogOption,
} from '../../ui/client-section-edit-dialog/client-section-edit-dialog.component';
import { ClientSmsDialogComponent, ClientSmsDraft } from '../../ui/client-sms-dialog/client-sms-dialog.component';
import { ClientSectionId, ClientSectionPatch, buildSectionUpdateRequest } from '../../utils/client-section-update';
import {
  ClientDeepLink,
  composeEmailLink,
  scheduleMeetingLink,
  signatureRequestLink,
} from '../../utils/client-profile-links';

/** El SSN/EIN revelado se vuelve a enmascarar solo pasado este tiempo. */
export const TAX_ID_REVEAL_TTL_MS = 30_000;

/**
 * Acciones del header sobre OTROS módulos. Cada una se gatea con lo que exige su destino: poder
 * entrar a la pantalla (la feature del registro) Y poder hacer la acción concreta (el permiso de
 * crear/enviar). Son las mismas claves que usa cada módulo; acá solo se consultan.
 */
const ACTION_ACCESS = {
  signature: { feature: 'signature', action: { module: 'signatures', anyOf: ['signature.request.create'] } },
  sms: { feature: 'sms', action: { module: null, anyOf: ['sms.send'] } },
  meeting: { feature: 'meetings', action: { module: 'meetings', anyOf: ['communication.meeting.create'] } },
  email: { feature: 'email', action: { module: 'email', anyOf: ['correspondence.compose'] } },
} as const satisfies Record<string, { feature: string; action: AccessRequirement }>;

export type ClientProfileTabId =
  | 'overview'
  | 'info'
  | 'family'
  | 'documents'
  | 'signatures'
  | 'invoices'
  | 'work'
  | 'notes'
  | 'communication'
  | 'sms'
  | 'meetings'
  | 'calls'
  | 'bank'
  | 'reminders'
  | 'mileage'
  | 'portal';

interface ClientProfileTab {
  id: ClientProfileTabId;
  label: string;
  /** Icono de ionicons (registrado en src/main.ts). */
  icon: string;
}

/** Entrada del menú lateral: una pestaña suelta, o un grupo con título y sus pestañas debajo. */
type ClientProfileNavEntry =
  | ({ kind: 'tab' } & ClientProfileTab)
  | { kind: 'group'; label: string; tabs: ClientProfileTab[] };

/**
 * Menú lateral del perfil: Info, Finance y Activity son secciones con título
 * y sus pestañas debajo. Info agrupa los datos del cliente (Details) y su
 * hogar fiscal (Family: cónyuge y dependientes). Overview y Portal quedan
 * sueltas.
 */
const PROFILE_NAV: ClientProfileNavEntry[] = [
  { kind: 'tab', id: 'overview', label: 'Overview', icon: 'grid-outline' },
  {
    kind: 'group',
    label: 'Info',
    tabs: [
      { id: 'info', label: 'Details', icon: 'person-outline' },
      { id: 'family', label: 'Family', icon: 'people-outline' },
    ],
  },
  {
    kind: 'group',
    label: 'Finance',
    tabs: [
      { id: 'invoices', label: 'Invoices', icon: 'receipt-outline' },
      { id: 'bank', label: 'Bank', icon: 'wallet-outline' },
      { id: 'mileage', label: 'Mileage', icon: 'car-outline' },
    ],
  },
  {
    kind: 'group',
    label: 'Activity',
    tabs: [
      { id: 'work', label: 'Work', icon: 'checkbox-outline' },
      { id: 'documents', label: 'Documents', icon: 'document-text-outline' },
      { id: 'signatures', label: 'Signatures', icon: 'create-outline' },
      { id: 'notes', label: 'Notes', icon: 'reader-outline' },
      { id: 'communication', label: 'Email', icon: 'mail-outline' },
      { id: 'sms', label: 'SMS', icon: 'chatbox-ellipses-outline' },
      { id: 'meetings', label: 'Meetings', icon: 'videocam-outline' },
      { id: 'calls', label: 'Calls', icon: 'call-outline' },
      { id: 'reminders', label: 'Reminders', icon: 'alarm-outline' },
    ],
  },
  { kind: 'tab', id: 'portal', label: 'Portal', icon: 'globe-outline' },
];

/**
 * B5 — qué hace falta para que una pestaña tenga contenido. Lo que no está acá no depende de
 * nada: Overview, Details y Family son el propio cliente, y quien llegó a esta pantalla ya pasó
 * por `customers.view`; Bank y Mileage son estados vacíos declarados, sin backend todavía. Lo que se gatea es lo que llama a OTRO servicio y hoy contesta 403 en silencio.
 */
const TAB_ACCESS: Partial<Record<ClientProfileTabId, AccessRequirement>> = {
  documents: { module: 'documents', anyOf: ['cloudstorage.file.view'] },
  signatures: { module: 'signatures', anyOf: ['signature.request.read'] },
  work: { module: 'planner', anyOf: ['tasks.read'] },
  notes: { module: 'planner', anyOf: ['notes.read'] },
  reminders: { module: 'planner', anyOf: ['reminders.read'] },
  communication: { module: 'email', anyOf: ['correspondence.read'] },
  sms: { module: null, anyOf: ['sms.read'] },
  meetings: { module: 'meetings', anyOf: ['communication.meeting.create', 'communication.meeting.join'] },
  invoices: { module: null, anyOf: ['invoicing.view'] },
  calls: { module: 'comms', anyOf: ['communication.call.start', 'communication.videocall.start'] },
};

/**
 * Shell del perfil de cliente: barra superior con botón de volver y las
 * acciones (Actions y "Edit", que abre el mismo `app-client-form-panel` del
 * directorio, precargado con este cliente); columna izquierda con
 * avatar/nombre/chips de tipo y estado, contacto y menú vertical de
 * pestañas; contenido a la derecha. El contenido de cada tab se resuelve
 * por *ngSwitch sobre activeTab().
 *
 * `client` viene de GET /customers/{id} (ClientsStore) — no de una seed
 * local. Solo Overview/Info/Family reciben el objeto completo; el resto
 * recibe el `clientId`.
 *
 * Estado de los datos por tab (auditoría ago-2026, ver el comentario de clase
 * de cada componente para el detalle del contrato):
 *  - MÓDULOS EMBEBIDOS (página completa del módulo fija a este cliente, patrón
 *    `@core/customers/embedded-customer`): Work (Task + solicitudes del cliente), Documents,
 *    Signatures (`?customerId=` — firmante mapeado al cliente), Invoices (Billing,
 *    `?customerId=`), Email (Mail + tarjeta de chat), SMS (`?customerId=`) y Meetings
 *    (`?customerId=` — vía la cuenta de portal del cliente).
 *  - REALES y filtradas por este cliente: Info, Family (del propio Customer),
 *    Notes (`/notes?targetType=Customer&targetId=`) y
 *    Portal (invitar en Customer + estado/gestión en Auth `/auth/invitations|users?customerId=`).
 *  - REAL pero NO filtrable por cliente: Reminders (el servicio Reminder no
 *    tiene categoría `Customer`); lo declara en pantalla.
 *  - VACÍAS A PROPÓSITO, sin backend que las respalde por cliente: Overview
 *    (parcial), Bank, Mileage y Calls. Cada
 *    una muestra un estado vacío que explica qué falta. NO son un olvido:
 *    antes pintaban mocks estáticos bajo el nombre de un cliente real, que es
 *    justo lo que había que quitar antes de producción.
 */
@Component({
  selector: 'app-client-profile-page',
  imports: [
    AvatarComponent,
    StatusPillComponent,
    CommonModule,
    RouterModule,
    ClientProfileOverviewComponent,
    ClientProfileInfoComponent,
    ClientDocumentsWorkspaceComponent,
    ClientSignatureWorkspaceComponent,
    ClientTaskWorkspaceComponent,
    ClientBillingWorkspaceComponent,
    ClientMailWorkspaceComponent,
    ClientSmsWorkspaceComponent,
    ClientMeetingsWorkspaceComponent,
    ClientProfileRequestsComponent,
    ClientProfileNotesComponent,
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
    SkeletonComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    ClientSectionEditDialogComponent,
    ClientSmsDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-page.component.html',
})
export class ClientProfilePageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(ClientsStore);
  private readonly toast = inject(ToastService);
  private readonly caps = inject(ClientPermissions);
  private readonly router = inject(Router);
  private readonly clientsService = inject(ClientsService);
  private readonly smsService = inject(ClientSmsService);

  /** Puede crear/editar el perfil fiscal (customers.manage + actor admin). */
  readonly canEditFiscal = this.caps.canSetFiscalProfile;
  /** Editar el cliente, sus direcciones, contactos y el hogar fiscal. */
  readonly canManage = this.caps.canManage;
  /** Destapar SSN/EIN. Permiso propio: poder editar al cliente NO alcanza. */
  readonly canReveal = this.caps.canRevealFiscal;

  private readonly access = inject(AccessStore);

  /**
   * El menú de pestañas, ya filtrado. Un grupo cuyas pestañas se fueron todas desaparece con
   * ellas: una sección vacía es peor que no tener la sección.
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

  private canDo(key: keyof typeof ACTION_ACCESS): boolean {
    const { feature, action } = ACTION_ACCESS[key];
    return this.access.canUseId(feature) && this.access.canUse(action);
  }

  readonly canRequestSignature = computed(() => this.canDo('signature'));
  readonly canSendSms = computed(() => this.canDo('sms'));
  readonly canScheduleMeeting = computed(() => this.canDo('meeting'));
  readonly canComposeEmail = computed(() => this.canDo('email'));
  readonly hasActions = computed(
    () => this.canRequestSignature() || this.canSendSms() || this.canScheduleMeeting() || this.canComposeEmail(),
  );

  readonly activeTab = signal<ClientProfileTabId>('overview');

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
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- Edición por sección (Info) ----------
  /** Sección abierta en su modal, o null. */
  readonly editingSection = signal<ClientSectionId | null>(null);
  /** Detalle fresco para precargar el modal (null = cargando). */
  readonly sectionDetail = signal<CustomerDetailResponse | null>(null);
  readonly savingSection = signal(false);
  readonly sectionError = signal<string | null>(null);

  /** Catálogos para los typeahead del modal (arrow = `this` estable). */
  readonly searchOccupations = (q: string): Observable<SectionCatalogOption[]> =>
    this.clientsService.listOccupations(q).pipe(map(list => list.map(o => ({ id: o.id, label: o.name }))));
  readonly searchBusinessActivities = (q: string): Observable<SectionCatalogOption[]> =>
    this.clientsService
      .listBusinessActivities(q)
      .pipe(map(list => list.map(a => ({ id: a.id, label: a.description, hint: a.naicsCode }))));

  // ---------- SMS directo ----------
  readonly isSmsOpen = signal(false);
  readonly sendingSms = signal(false);
  readonly smsError = signal<string | null>(null);
  /** Teléfonos válidos del cliente (principal + contactos de tipo Phone), en E.164. */
  readonly smsPhones = computed(() => {
    const c = this.client();
    return c ? clientSmsPhoneOptions(c.phone, c.contactPoints) : [];
  });

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

  constructor() {
    effect(() => {
      const id = this.paramMap().get('id');
      if (id) {
        this.loadClient(id);
      }
    });
  }

  private loadClient(id: string): void {
    // Cambio de cliente sin salir de la ruta: volver a Overview desmonta los módulos embebidos
    // (cada uno con su store fijado al cliente anterior) y se montan limpios con el nuevo.
    const current = untracked(this.client);
    if (current && current.id !== id) {
      this.activeTab.set('overview');
    }
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
        this.revealingTaxId.set(false);
        this.showTaxId(response.taxIdentifier);
      },
      error: err => {
        this.revealingTaxId.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  /** Muestra el identificador y programa el re-enmascarado (30 s). */
  private showTaxId(value: string): void {
    this.clearRevealTimer();
    this.revealedTaxId.set(value);
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      this.revealedTaxId.set(null);
    }, TAX_ID_REVEAL_TTL_MS);
  }

  /** Vuelve a enmascarar (botón Hide, cambio de pestaña o de cliente, salir de la página). */
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

  ngOnDestroy(): void {
    this.hideTaxId();
  }

  // ---------- Edición por sección (Info: Contact / Personal / Business) ----------

  /** Abre el modal de la sección y precarga con el detalle FRESCO (trae las partes del nombre). */
  openSectionEdit(section: ClientSectionId): void {
    const client = this.client();
    if (!client || !this.canManage()) {
      return;
    }
    this.editingSection.set(section);
    this.sectionDetail.set(null);
    this.sectionError.set(null);
    this.store.getById(client.id).subscribe({
      next: detail => {
        if (this.editingSection() === section) {
          this.sectionDetail.set(detail);
        }
      },
      error: err => this.sectionError.set(toApiError(err).message),
    });
  }

  closeSectionEdit(): void {
    if (this.savingSection()) {
      return;
    }
    this.editingSection.set(null);
    this.sectionDetail.set(null);
    this.sectionError.set(null);
  }

  /**
   * El PATCH de /customers aplica SIEMPRE teléfono, ocupación, idioma y canal: mandar solo los
   * campos de la sección los borraría. Por eso se re-lee el cliente justo antes y se fusiona la
   * sección sobre él (`buildSectionUpdateRequest`); lo demás viaja con su valor vigente.
   */
  handleSaveSection(patch: ClientSectionPatch): void {
    const client = this.client();
    if (!client || this.savingSection()) {
      return;
    }
    this.savingSection.set(true);
    this.sectionError.set(null);
    this.store
      .getById(client.id)
      .pipe(
        switchMap(current =>
          this.store.updateClient(client.id, buildSectionUpdateRequest(current, patch), {
            taxIdentifier: '', // nunca se toca el perfil fiscal desde acá
            subjectKind: current.kind === 'Individual' ? 'Individual' : 'Business',
            isActive: current.status === 'Active', // sin cambio de estado
          }),
        ),
        finalize(() => this.savingSection.set(false)),
      )
      .subscribe({
        next: () => {
          this.editingSection.set(null);
          this.sectionDetail.set(null);
          this.loadClient(client.id);
          this.toast.success('Client updated');
        },
        error: err => {
          const e = toApiError(err);
          this.sectionError.set(
            e.code === 'Customer.EmailAlreadyInUse' ? 'This email already belongs to another client.' : e.message,
          );
        },
      });
  }

  // ---------- Acciones del header (otros módulos por deep link) ----------

  private go(link: ClientDeepLink): void {
    void this.router.navigate(link.commands, { queryParams: link.queryParams });
  }

  requestSignature(c: ClientProfile): void {
    this.go(signatureRequestLink(c));
  }

  scheduleMeeting(c: ClientProfile): void {
    this.go(scheduleMeetingLink(c));
  }

  composeEmail(c: ClientProfile): void {
    this.go(composeEmailLink(c));
  }

  openSms(): void {
    this.smsError.set(null);
    this.isSmsOpen.set(true);
  }

  closeSms(): void {
    if (this.sendingSms()) {
      return;
    }
    this.isSmsOpen.set(false);
    this.smsError.set(null);
  }

  handleSendSms(draft: ClientSmsDraft): void {
    const client = this.client();
    if (!client || this.sendingSms()) {
      return;
    }
    this.sendingSms.set(true);
    this.smsError.set(null);
    this.smsService
      .send(client.id, draft.to, draft.message, client.displayName)
      .pipe(finalize(() => this.sendingSms.set(false)))
      .subscribe({
        next: response => {
          const outcome = clientSmsOutcome(response);
          if (outcome.ok) {
            this.isSmsOpen.set(false);
            this.toast.success(outcome.message);
          } else {
            this.smsError.set(outcome.message);
          }
        },
        error: err => this.smsError.set(clientSmsErrorMessage(err)),
      });
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
      // El identificador revelado no sobrevive a un cambio de pestaña.
      this.hideTaxId();
    }
    this.activeTab.set(id);
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

  typeLabel(client: ClientProfile): string {
    return client.type === 'individual' ? 'Individual' : 'Company';
  }

  typeBadgeClass(client: ClientProfile): string {
    return client.type === 'individual' ? 'border-indigo-100 text-indigo-600' : 'border-indigo-50 text-orange-600';
  }

  statusLabel(client: ClientProfile): string {
    return client.isActive ? 'Active' : 'Inactive';
  }
}
