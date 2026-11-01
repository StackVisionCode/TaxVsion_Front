import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Observable,
  Subject,
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  forkJoin,
  map,
  of,
  retry,
  switchMap,
  throwError,
  timer,
} from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { AuthService } from '@core/auth/auth.service';
import { MailService } from './mail.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { EmbeddedCustomer, injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import { MailSocketService, MailThreadStatePayload } from './mail-socket.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { MailUnreadStore } from './mail-unread.store';
import {
  AttachFileToDraftRequest,
  AttachmentSummary,
  ConnectManualAccountRequest,
  DraftAttachmentSummary,
  DraftDetail,
  DraftListItem,
  MailAccount,
  MailCustomerScope,
  MessageSummary,
  SentMessageListItem,
  TestManualConnectionResult,
  ThreadSummary,
  TrashItem,
  isUsableAccount,
  parseRecipients,
  plainTextToHtml,
} from './mail.model';
import { ProviderDetection, detectProvider } from './mail-provider-detect.util';
import { ConnectorsCapabilities } from './connectors-permissions';

/** Carpetas honestas: solo las que tienen respaldo real en Correspondence. */
export type MailFolderId = 'inbox' | 'sent' | 'archived' | 'drafts' | 'trash';

/** Carpetas de lo que uno manda o redacta: las únicas donde existe correo a quien no es cliente. */
export const OUTGOING_FOLDERS: ReadonlySet<MailFolderId> = new Set<MailFolderId>(['sent', 'drafts', 'trash']);

/** Lote de hilos/drafts por página del listado. */
const LIST_PAGE_SIZE = 50;
/** Mensajes por página del hilo (máx del backend = 100; un hilo real casi siempre entra entero). */
const THREAD_PAGE_SIZE = 100;
/** Reintentos del download-url mientras el adjunto sigue descargándose (409). */
const DOWNLOAD_URL_RETRIES = 5;
const DOWNLOAD_URL_RETRY_MS = 1500;

/** Estado de body de un mensaje expandido (inbound: en vivo desde Connectors; outbound: DraftDetail). */
export interface MessageBodyView {
  loading: boolean;
  error: string | null;
  html: string | null;
  text: string | null;
}

/** Adjunto de un mensaje inbound + estado transitorio de la descarga disparada desde la UI. */
export interface MessageAttachmentView extends AttachmentSummary {
  busy: boolean;
  error: string | null;
}

export interface MessageAttachmentsView {
  loading: boolean;
  error: string | null;
  items: MessageAttachmentView[];
}

/** Estado del reply inline (StartReply → autosave → send). */
export interface ReplyState {
  messageId: string;
  /** Vacío mientras StartReply no respondió — Send queda deshabilitado. */
  draftId: string;
  subject: string;
  toAddress: string;
  toDisplayName: string | null;
  starting: boolean;
  sending: boolean;
  error: string | null;
}

/** Estado del composer completo (mensaje nuevo o draft retomado). */
export interface ComposeState {
  open: boolean;
  /** Draft existente retomado desde la carpeta Drafts (null = redacción nueva). */
  draft: DraftDetail | null;
  loadingDraft: boolean;
  loadError: string | null;
  sending: boolean;
  error: string | null;
  /** Destinatario a precargar en "To" en una redacción NUEVA (deep link desde el perfil del cliente). */
  initialTo: string | null;
  /**
   * Cliente en cuya ficha se archivará el correo; null = a alguien que no es cliente. Se fija al ABRIR
   * el composer (y en un draft retomado, el del draft), no al enviar: cambiar de cliente en el rail
   * a mitad de redacción no debe re-archivar lo que se está escribiendo.
   */
  customerId: string | null;
  /**
   * Elegir como destinatario a un cliente archiva en él una redacción que aún no tiene cliente. Se
   * apaga si el usuario pidió explícitamente no archivarla en ninguno.
   */
  autoFile: boolean;
}

/**
 * Payload que el composer emite al presionar Send; el store corre la cadena real. El cliente NO viaja
 * acá: lo decide el estado del composer (`ComposeState.customerId`), fijado al abrirlo.
 */
export interface ComposeSendPayload {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  /** Cuerpo enriquecido tal cual lo dejó el editor: es lo que viaja como HtmlBody. */
  bodyHtml: string;
  /** Mismo cuerpo degradado a texto, para el TextBody del draft. */
  bodyText: string;
  files: File[];
  /** fileIds de adjuntos ya persistidos en el draft que el usuario quitó. */
  removedFileIds: string[];
}

const ATTACHMENT_OWNER_UNKNOWN = 'We could not identify your user to attach files. Sign in again and retry.';

const EMPTY_COMPOSE: ComposeState = {
  open: false,
  draft: null,
  loadingDraft: false,
  loadError: null,
  sending: false,
  error: null,
  initialTo: null,
  customerId: null,
  autoFile: true,
};

/**
 * Store del módulo Mail (Connectors + Correspondence vía Gateway). providedIn: 'root'.
 * /email abre en el Inbox de la oficina: los hilos de todos los clientes que el usuario puede ver. El
 * cliente es un filtro opcional (y "Not a client" otro, solo para Sent/Drafts/Trash, porque no entra
 * correo de quien no es cliente). Los componentes ui/ siguen dumb: solo mail-page consume este store.
 *
 * Modo embebido (perfil del cliente): `ClientMailWorkspaceComponent` provee una instancia PROPIA
 * de este store; el cliente queda fijado por `injectEmbeddedCustomer()` y no se carga el directorio.
 */
@Injectable({ providedIn: 'root' })
export class MailStore {
  private readonly service = inject(MailService);
  private readonly directory = inject(CustomerDirectoryStore);
  private readonly uploads = inject(CloudStorageUploadService);
  private readonly auth = inject(AuthService);
  private readonly mailSocket = inject(MailSocketService);
  private readonly unread = inject(MailUnreadStore);
  private readonly toast = inject(ToastService);
  private readonly caps = inject(ConnectorsCapabilities);
  /** Root: nunca se destruye. Instancia del wrapper embebido: corta las suscripciones al destruirse. */
  private readonly destroyRef = inject(DestroyRef);
  /** Cliente fijado por el perfil (`null` en /email). */
  private readonly embeddedCustomer = injectEmbeddedCustomer();
  readonly embedded = computed(() => this.embeddedCustomer() !== null);

  // ---------- Capacidades de conexión (Office vs Personal) ----------

  /** Conectar/administrar el buzón de oficina (compartido) — exige connectors.accounts.write. */
  readonly canManageOffice = this.caps.canManageOffice;
  /** Conectar/administrar el buzón personal propio — exige connect_own (o write). */
  readonly canConnectOwn = this.caps.canConnectOwn;

  // ---------- Identidad del usuario (guía la conexión de buzón) ----------

  /** Email de login del usuario — el buzón conectado DEBE ser este (guard de identidad del backend). */
  readonly loginEmail = computed(() => this.auth.currentUser()?.email ?? null);
  /** Proveedor inferido del dominio del email de login, para recomendar OAuth vs IMAP/SMTP manual. */
  readonly providerDetection = computed<ProviderDetection>(() => detectProvider(this.loginEmail()));

  // ---------- Bootstrap: cuentas de buzón + clientes ----------

  private readonly _bootLoading = signal(false);
  private readonly _bootError = signal<string | null>(null);
  private readonly _accounts = signal<MailAccount[]>([]);
  private initialized = false;

  readonly bootLoading = this._bootLoading.asReadonly();
  readonly bootError = this._bootError.asReadonly();
  readonly accounts = this._accounts.asReadonly();

  /** Cuentas con las que se puede leer/enviar. */
  readonly usableAccounts = computed(() => this._accounts().filter(isUsableAccount));
  /** Cuentas caídas (watch/OAuth roto) — se ofrecen para reautorizar. */
  readonly errorAccounts = computed(() => this._accounts().filter(account => account.status === 'Error'));
  /**
   * Cuentas que necesitan acción para sincronizar de verdad: `Error` (watch/OAuth roto) o `Connected`
   * (el connect llegó pero el watch NUNCA se armó — p. ej. el 403 del topic de Pub/Sub — así que se
   * puede leer/enviar pero NO llega correo entrante). `Active` = watch OK, no aparece acá.
   */
  readonly attentionAccounts = computed(() =>
    this._accounts().filter(account => account.status === 'Error' || account.status === 'Connected'),
  );
  readonly hasMailbox = computed(() => this.usableAccounts().length > 0);

  /**
   * ¿El email de login ya tiene un buzón utilizable? Como el guard de identidad obliga a que el buzón
   * sea el propio email de login, esto significa "no queda nada por conectar": la pantalla de gestión
   * debe ocultar el hero de conexión (Connect Gmail/M365) y mostrar solo el estado + desconectar.
   */
  readonly loginMailboxConnected = computed(() => {
    const email = this.loginEmail()?.trim().toLowerCase();
    if (!email) {
      return false;
    }
    return this.usableAccounts().some(account => account.emailAddress.trim().toLowerCase() === email);
  });

  /**
   * Buzón de OFICINA (compartido) del tenant, si existe. El list del backend lo devuelve a todos
   * (OwnerUserId null es visible para cualquiera del tenant), así que esto se puebla también para
   * empleados sin permiso de administrarlo. Hay como mucho uno (el admin conecta un solo buzón).
   *
   * Excluimos `Disconnected`/`Draft`: un buzón desconectado NO debe bloquear la reconexión; el UI
   * tiene que ofrecer los proveedores (Gmail OAuth, Microsoft, IMAP) de nuevo. Error sí entra para
   * que el panel permita reautorizar.
   */
  readonly officeAccount = computed(
    () =>
      this._accounts().find(
        account =>
          account.isOffice &&
          (account.status === 'Connected' || account.status === 'Active' || account.status === 'Error'),
      ) ?? null,
  );
  /**
   * Buzón PERSONAL del usuario, si existe. El list del backend scopea a oficina + propios, así que
   * cualquier cuenta no-oficina de la lista es la del propio usuario. Misma regla de estado que
   * officeAccount: Disconnected/Draft no bloquea el flujo de conectar uno nuevo.
   */
  readonly myAccount = computed(
    () =>
      this._accounts().find(
        account =>
          !account.isOffice &&
          (account.status === 'Connected' || account.status === 'Active' || account.status === 'Error'),
      ) ?? null,
  );
  /** ¿El usuario ya conectó su buzón personal? (no queda nada personal por conectar). */
  readonly myMailboxConnected = computed(() => this.myAccount() !== null);

  /** ¿Puede administrar (reauth/desconectar) esta cuenta? Oficina → write; personal → propio con connect_own. */
  canManageAccount(account: MailAccount): boolean {
    return account.isOffice ? this.canManageOffice() : this.canConnectOwn();
  }

  private readonly _activeAccountId = signal<string | null>(null);
  readonly activeAccountId = this._activeAccountId.asReadonly();
  readonly activeAccount = computed(
    () => this.usableAccounts().find(account => account.id === this._activeAccountId()) ?? null,
  );

  // ---------- Conectar buzón (OAuth full-page redirect) ----------

  private readonly _connectBusy = signal<'Gmail' | 'Graph' | null>(null);
  private readonly _connectError = signal<string | null>(null);
  private readonly _reauthBusyId = signal<string | null>(null);
  private readonly _disconnectBusyId = signal<string | null>(null);

  readonly connectBusy = this._connectBusy.asReadonly();
  readonly connectError = this._connectError.asReadonly();
  readonly reauthBusyId = this._reauthBusyId.asReadonly();
  readonly disconnectBusyId = this._disconnectBusyId.asReadonly();

  // ---------- Conectar buzón manual (IMAP/SMTP, sin redirect) ----------

  private readonly _manualConnecting = signal(false);
  private readonly _manualError = signal<string | null>(null);

  readonly manualConnecting = this._manualConnecting.asReadonly();
  readonly manualError = this._manualError.asReadonly();

  // "Test connection" del alta manual: prueba IMAP y SMTP sin guardar nada.
  private readonly _manualTesting = signal(false);
  private readonly _manualTestResult = signal<TestManualConnectionResult | null>(null);
  private readonly _manualTestError = signal<string | null>(null);

  readonly manualTesting = this._manualTesting.asReadonly();
  readonly manualTestResult = this._manualTestResult.asReadonly();
  readonly manualTestError = this._manualTestError.asReadonly();

  // ---------- Selección de cliente y carpeta ----------

  private readonly _selectedCustomerId = signal<string | null>(null);
  private readonly _activeFolderId = signal<MailFolderId>('inbox');

  readonly selectedCustomerId = this._selectedCustomerId.asReadonly();
  readonly activeFolderId = this._activeFolderId.asReadonly();

  /**
   * Filtro "Not a client" de /email: Drafts/Sent/Trash solo del correo mandado a quien no es cliente.
   * Excluye al filtro de cliente y no aplica al Inbox. Nunca en el perfil (embebido).
   */
  private readonly _unlinkedView = signal(false);
  readonly unlinkedView = this._unlinkedView.asReadonly();

  /** Alcance de Drafts/Sent/Trash: el cliente filtrado, solo "Not a client", o todo. */
  private readonly listScope = computed<MailCustomerScope>(() => {
    const customerId = this._selectedCustomerId();
    if (customerId) {
      return { kind: 'customer', customerId };
    }
    return this._unlinkedView() ? { kind: 'unlinked' } : { kind: 'all' };
  });

  // ---------- Nombres de los clientes de las filas ----------
  // El Inbox mezcla clientes: cada fila trae solo el id, el nombre sale del directorio compartido.
  private readonly _customerIndex = signal<ReadonlyMap<string, CustomerSummary>>(new Map());
  readonly customerIndex = this._customerIndex.asReadonly();
  /** Ids ya pedidos (aunque no existan más): no se vuelven a pedir en cada página. */
  private readonly requestedCustomerIds = new Set<string>();

  // ---------- Filtro de cliente ----------
  // La búsqueda y los recientes viven en `app-customer-picker` + CustomerDirectoryStore (compartidos
  // con el resto de módulos).
  private readonly _selectedCustomer = signal<CustomerSummary | null>(null);

  /** Cliente filtrado completo (nombre + email + avatar), para el chip del selector; null = todos. */
  readonly selectedCustomer = this._selectedCustomer.asReadonly();
  /** Nombre del cliente activo (compat con lo existente). */
  readonly selectedCustomerName = computed(() => this._selectedCustomer()?.displayName ?? null);

  // ---------- Autocompletar destinatarios del composer (To/Cc) ----------
  // Stream aparte del anterior: el del rail fija el cliente DUEÑO del hilo, mientras que este
  // solo sugiere direcciones para escribir. Compartirlo haría que escribir en To cambiara la
  // bandeja que se está viendo.
  private readonly _recipientResults = signal<CustomerSummary[]>([]);
  private readonly _recipientSearchLoading = signal(false);
  private readonly _recipientSearch$ = new Subject<string>();

  readonly recipientResults = this._recipientResults.asReadonly();
  readonly recipientSearchLoading = this._recipientSearchLoading.asReadonly();

  // ---------- Hilos del Inbox (todos los clientes visibles o el filtrado) ----------

  private readonly _threads = signal<ThreadSummary[]>([]);
  private readonly _threadsLoading = signal(false);
  private readonly _threadsError = signal<string | null>(null);
  private readonly _threadsPage = signal(1);
  private readonly _threadsHasMore = signal(false);

  readonly threads = this._threads.asReadonly();
  readonly threadsLoading = this._threadsLoading.asReadonly();
  readonly threadsError = this._threadsError.asReadonly();
  readonly threadsHasMore = this._threadsHasMore.asReadonly();

  /** El listado del backend trae todos los estados: la UI separa activo/archivado por página cargada. */
  readonly activeThreads = computed(() => this._threads().filter(thread => thread.status === 'Active'));
  readonly archivedThreads = computed(() => this._threads().filter(thread => thread.status === 'Archived'));

  /** Búsqueda en el servidor (asunto, remitente y vista previa) del Inbox y Archived. */
  private readonly _threadSearch = signal('');
  readonly threadSearch = this._threadSearch.asReadonly();
  private readonly threadSearch$ = new Subject<string>();
  /** Solo la última carga de hilos pinta: una respuesta vieja (búsqueda anterior) no pisa a la nueva. */
  private threadsRequestSeq = 0;

  // ---------- Drafts del cliente seleccionado ----------

  private readonly _drafts = signal<DraftListItem[]>([]);
  private readonly _draftsLoading = signal(false);
  private readonly _draftsError = signal<string | null>(null);
  private readonly _draftsPage = signal(1);
  private readonly _draftsHasMore = signal(false);
  private readonly _draftsTotal = signal(0);

  readonly drafts = this._drafts.asReadonly();
  readonly draftsLoading = this._draftsLoading.asReadonly();
  readonly draftsError = this._draftsError.asReadonly();
  readonly draftsHasMore = this._draftsHasMore.asReadonly();
  readonly draftsTotal = this._draftsTotal.asReadonly();

  // ---------- Enviados (carpeta Sent) del cliente seleccionado ----------

  private readonly _sent = signal<SentMessageListItem[]>([]);
  private readonly _sentLoading = signal(false);
  private readonly _sentError = signal<string | null>(null);
  private readonly _sentPage = signal(1);
  private readonly _sentHasMore = signal(false);

  readonly sent = this._sent.asReadonly();
  readonly sentLoading = this._sentLoading.asReadonly();
  readonly sentError = this._sentError.asReadonly();
  readonly sentHasMore = this._sentHasMore.asReadonly();

  // ---------- Papelera del cliente ----------

  private readonly _trash = signal<TrashItem[]>([]);
  private readonly _trashLoading = signal(false);
  private readonly _trashError = signal<string | null>(null);
  private readonly _trashPage = signal(1);
  private readonly _trashHasMore = signal(false);

  readonly trash = this._trash.asReadonly();
  readonly trashLoading = this._trashLoading.asReadonly();
  readonly trashError = this._trashError.asReadonly();
  readonly trashHasMore = this._trashHasMore.asReadonly();

  /**
   * Vista de UN mensaje enviado SIN hilo (compose nuevo: `EmailThreadId` null en el backend). Se
   * inyecta como "hilo sintético" de un solo mensaje para reusar el reading-pane sin ensuciar la
   * lista real de hilos. Los replies (con hilo) NO usan esto: abren su hilo real.
   */
  private readonly _syntheticThread = signal<ThreadSummary | null>(null);

  // ---------- Hilo seleccionado + mensajes ----------

  private readonly _selectedThreadId = signal<string | null>(null);
  private readonly _messages = signal<MessageSummary[]>([]);
  private readonly _messagesLoading = signal(false);
  private readonly _messagesError = signal<string | null>(null);
  private readonly _messagesPage = signal(1);
  private readonly _messagesHasMore = signal(false);
  private readonly _expandedMessageId = signal<string | null>(null);
  private readonly _bodies = signal<ReadonlyMap<string, MessageBodyView>>(new Map());
  private readonly _attachments = signal<ReadonlyMap<string, MessageAttachmentsView>>(new Map());
  private readonly _archiving = signal(false);

  readonly selectedThreadId = this._selectedThreadId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly messagesLoading = this._messagesLoading.asReadonly();
  readonly messagesError = this._messagesError.asReadonly();
  readonly messagesHasMore = this._messagesHasMore.asReadonly();
  readonly expandedMessageId = this._expandedMessageId.asReadonly();
  readonly bodies = this._bodies.asReadonly();
  readonly attachments = this._attachments.asReadonly();
  readonly archiving = this._archiving.asReadonly();

  readonly selectedThread = computed(
    () =>
      this._syntheticThread() ??
      this._threads().find(thread => thread.threadId === this._selectedThreadId()) ??
      null,
  );

  // ---------- Reply / compose / toast ----------

  private readonly _reply = signal<ReplyState | null>(null);
  private readonly _compose = signal<ComposeState>(EMPTY_COMPOSE);
  private readonly _sentToast = signal(false);
  private sentToastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly reply = this._reply.asReadonly();
  readonly compose = this._compose.asReadonly();
  readonly sentToast = this._sentToast.asReadonly();

  // ---------- Bootstrap ----------

  /**
   * Carga inicial idempotente: cuentas de buzón + picker de clientes. El store es singleton (root),
   * así que la SUSCRIPCIÓN a `mail.incoming` se hace una sola vez; el socket sí se (re)conecta en cada
   * entrada al módulo (el componente lo cierra en ngOnDestroy), por eso `connect()` corre siempre.
   */
  init(): void {
    this.mailSocket.connect();
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.subscribeIncomingMailRealtime();
    this.subscribeThreadStateRealtime();
    this.wireRecipientSearch();
    this.wireThreadSearch();
    this.refreshBoot();
  }

  /** Búsqueda server-side debounced (cancela la anterior y traga errores) del autocompletar de To/Cc. */
  private wireRecipientSearch(): void {
    this._recipientSearch$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term => {
          this._recipientSearchLoading.set(true);
          return this.directory.search({ term, status: 'NotArchived', size: 200 }).pipe(
            map(result => result.items),
            catchError(() => of<CustomerSummary[]>([])),
          );
        }),
      )
      .subscribe(items => {
        this._recipientResults.set(items);
        this._recipientSearchLoading.set(false);
      });
  }

  /** Búsqueda debounced del Inbox/Archived contra el servidor; vacía = vuelve al listado normal. */
  private wireThreadSearch(): void {
    this.threadSearch$
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(300), distinctUntilChanged())
      .subscribe(term => {
        // Ya aplicada (p. ej. la vació un cambio de carpeta al instante): no se recarga dos veces.
        if (term === this._threadSearch()) return;
        this._threadSearch.set(term);
        this.clearThreadSelection();
        this.loadThreads(true);
      });
  }

  /** La lista pide buscar en el servidor lo tecleado (Inbox y Archived). */
  searchThreads(term: string): void {
    this.threadSearch$.next(term.trim());
  }

  /** El composer pide sugerencias para el destinatario que se está tecleando. */
  searchRecipients(term: string): void {
    this._recipientSearch$.next(term.trim());
  }

  /** Filtra el correo por un cliente (elegido en el picker, que ya lo sube a recientes). */
  pickCustomer(customer: CustomerSummary): void {
    if (this.embedded()) {
      return;
    }
    this._selectedCustomer.set(customer);
    this.rememberCustomers([customer]);
    this.selectCustomer(customer.id);
  }

  /** Quita el filtro de cliente: vuelve al correo de todos los clientes visibles. */
  clearCustomer(): void {
    if (this.embedded() || !this._selectedCustomerId()) {
      return;
    }
    this._selectedCustomerId.set(null);
    this._selectedCustomer.set(null);
    this.reloadForScope(true);
  }

  /**
   * Filtro "Not a client" de Sent/Drafts/Trash. Quita el de cliente (son excluyentes) y, si se estaba en
   * el Inbox o Archived, pasa a Sent: allí no hay correo de quien no es cliente.
   */
  showUnlinkedMail(): void {
    if (this.embedded() || this._unlinkedView()) {
      return;
    }
    const hadCustomer = this._selectedCustomerId() !== null;
    this._unlinkedView.set(true);
    this._selectedCustomerId.set(null);
    this._selectedCustomer.set(null);
    if (!OUTGOING_FOLDERS.has(this._activeFolderId())) {
      this._activeFolderId.set('sent');
    }
    this.reloadForScope(hadCustomer);
  }

  /** Quita el filtro "Not a client": Sent/Drafts/Trash vuelven a mostrar todo. */
  showAllMail(): void {
    if (!this._unlinkedView()) {
      return;
    }
    this._unlinkedView.set(false);
    this.reloadForScope(false);
  }

  /** Cierra el socket realtime al salir del módulo Mail (lo llama el componente en ngOnDestroy). */
  teardown(): void {
    this.mailSocket.disconnect();
  }

  /**
   * Escucha `mail.incoming` de Communication (una sola suscripción, persiste con el store singleton):
   * recarga el Inbox sin vaciarlo (el correo nuevo aparece SIN recargar la página) y, si está abierto
   * ese mismo hilo, sus mensajes. Con un cliente filtrado, el correo de otros no toca la lista. El
   * badge lo refresca `MailUnreadStore` con el mismo evento.
   */
  private subscribeIncomingMailRealtime(): void {
    this.mailSocket.incomingEmail$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(evt => {
      // Embebido: el cliente filtrado ES el fijado, así que esto ya ignora a los demás.
      const filter = this._selectedCustomerId();
      if (filter && evt.customerId !== filter) {
        return;
      }
      this.loadThreads(true, true);
      if (evt.emailThreadId === this._selectedThreadId()) {
        this.loadMessages(true);
      }
    });
  }

  /**
   * Escucha `mail.thread_state` (otra pestaña u otro empleado leyó, archivó o movió a la papelera algo):
   * si el hilo está en la lista se actualiza en el sitio, sin recargar; si no está (p. ej. alguien lo
   * desarchivó) se recarga la lista en segundo plano. El badge lo refresca `MailUnreadStore`.
   */
  private subscribeThreadStateRealtime(): void {
    this.mailSocket.threadState$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(evt => this.applyThreadState(evt));
  }

  private applyThreadState(evt: MailThreadStatePayload): void {
    const filter = this._selectedCustomerId();
    if (filter && evt.customerId !== filter) {
      return;
    }
    const status = evt.status === 'Archived' ? 'Archived' : 'Active';
    if (!this._threads().some(thread => thread.threadId === evt.emailThreadId)) {
      this.loadThreads(true, true);
      return;
    }
    this._threads.update(list =>
      list.map(thread =>
        thread.threadId === evt.emailThreadId
          ? { ...thread, status, unreadCount: evt.unreadCount, messageCount: evt.messageCount }
          : thread,
      ),
    );
    // Hilo abierto que alguien dejó todo leído: sus mensajes tampoco se pintan sin leer.
    if (evt.emailThreadId === this._selectedThreadId() && evt.unreadCount === 0) {
      this._messages.update(items => items.map(item => (item.direction === 'Inbound' ? { ...item, isRead: true } : item)));
    }
  }

  refreshBoot(): void {
    const embedded = this.embeddedCustomer();
    if (embedded) {
      this.refreshBootEmbedded(embedded);
      return;
    }
    this._bootLoading.set(true);
    this._bootError.set(null);
    this.unread.refresh();
    this.service.listAccounts().subscribe({
      next: accounts => {
        this._accounts.set(accounts);
        this._bootLoading.set(false);
        // Default: primera cuenta utilizable. Sin cliente elegido: el Inbox es de todos los clientes.
        const usable = accounts.filter(isUsableAccount);
        if (!this._activeAccountId() || !usable.some(account => account.id === this._activeAccountId())) {
          this._activeAccountId.set(usable[0]?.id ?? null);
        }
        if (usable.length > 0) {
          this.loadThreads(true);
          this.loadDrafts(true);
        }
      },
      error: err => {
        this._bootError.set(toApiError(err).message);
        this._bootLoading.set(false);
      },
    });
  }

  /**
   * Boot embebido: fija el cliente ANTES de cargar (sin la búsqueda de 200 clientes ni el auto-select)
   * y resuelve su CustomerSummary por id (email para precargar "To"). Hilos/drafts se listan aunque no
   * haya buzón: el backend los filtra por cliente y la UI los muestra en solo lectura.
   */
  private refreshBootEmbedded(embedded: EmbeddedCustomer): void {
    this._selectedCustomerId.set(embedded.id);
    if (this._selectedCustomer()?.id !== embedded.id) {
      this._selectedCustomer.set(this.fallbackSummary(embedded));
    }
    this._bootLoading.set(true);
    this._bootError.set(null);
    forkJoin({
      accounts: this.service.listAccounts(),
      customer: this.directory.byId([embedded.id]).pipe(
        map(found => found.get(embedded.id) ?? null),
        catchError(() => of<CustomerSummary | null>(null)),
      ),
    }).subscribe({
      next: ({ accounts, customer }) => {
        this._accounts.set(accounts);
        if (customer) {
          this._selectedCustomer.set(customer);
          this.rememberCustomers([customer]);
        }
        this._bootLoading.set(false);
        const usable = accounts.filter(isUsableAccount);
        if (!this._activeAccountId() || !usable.some(account => account.id === this._activeAccountId())) {
          this._activeAccountId.set(usable[0]?.id ?? null);
        }
        this.loadThreads(true);
        this.loadDrafts(true);
      },
      error: err => {
        this._bootError.set(toApiError(err).message);
        this._bootLoading.set(false);
      },
    });
  }

  /** Resumen mínimo con lo que trae el perfil, mientras el directorio no responde. */
  private fallbackSummary(embedded: EmbeddedCustomer): CustomerSummary {
    return {
      id: embedded.id,
      kind: 'Individual',
      status: 'Active',
      displayName: embedded.name,
      primaryEmail: '',
      primaryPhone: null,
      createdAtUtc: '',
    };
  }

  /** Refresca solo las cuentas (ej. al volver del consentimiento OAuth). */
  reloadAccounts(): void {
    this.service.listAccounts().subscribe({
      next: accounts => {
        this._accounts.set(accounts);
        const usable = accounts.filter(isUsableAccount);
        if (!this._activeAccountId() || !usable.some(account => account.id === this._activeAccountId())) {
          this._activeAccountId.set(usable[0]?.id ?? null);
        }
        if (usable.length > 0 && this._threads().length === 0) {
          this.loadThreads(true);
          this.loadDrafts(true);
        }
      },
      error: err => this._bootError.set(toApiError(err).message),
    });
  }

  setActiveAccount(accountId: string): void {
    if (this.usableAccounts().some(account => account.id === accountId)) {
      this._activeAccountId.set(accountId);
    }
  }

  // ---------- Conectar buzón ----------

  /**
   * POST /connectors/accounts y redirección FULL-PAGE al consentimiento de Google/Microsoft.
   * `asOffice` = conectar el buzón de oficina (compartido); false = el buzón personal del usuario.
   */
  connectMailbox(provider: 'Gmail' | 'Graph', asOffice = false): void {
    if (this._connectBusy()) {
      return;
    }
    this._connectBusy.set(provider);
    this._connectError.set(null);
    this.service.initiateOAuthConnect(provider, asOffice).subscribe({
      next: result => {
        // No se limpia el busy: el navegador abandona la app hacia el proveedor.
        window.location.assign(result.authorizationUrl);
      },
      error: err => {
        this._connectError.set(toApiError(err).message);
        this._connectBusy.set(null);
      },
    });
  }

  /**
   * Alta de buzón por IMAP/SMTP (POST /connectors/accounts/manual). Síncrono: al 200 la cuenta ya
   * existe y quedó validada contra ambos servidores. Recarga cuentas (flip a hasMailbox) y avisa al
   * caller para cerrar el formulario. Los errores de conectividad / identidad vienen legibles del backend.
   */
  connectManualAccount(body: ConnectManualAccountRequest, onSuccess?: () => void): void {
    if (this._manualConnecting()) {
      return;
    }
    this._manualConnecting.set(true);
    this._manualError.set(null);
    this.service.connectManualAccount(body).subscribe({
      next: () => {
        this._manualConnecting.set(false);
        this.reloadAccounts();
        onSuccess?.();
      },
      error: err => {
        this._manualError.set(toApiError(err).message);
        this._manualConnecting.set(false);
      },
    });
  }

  /** Limpia el error y la última prueba del alta manual (al cerrar/reabrir el formulario). */
  clearManualError(): void {
    this._manualError.set(null);
    this._manualTestResult.set(null);
    this._manualTestError.set(null);
  }

  /** "Test connection": el resultado de cada servidor queda en `manualTestResult`; un 4xx, en `manualTestError`. */
  testManualConnection(body: ConnectManualAccountRequest): void {
    if (this._manualTesting()) {
      return;
    }
    this._manualTesting.set(true);
    this._manualTestResult.set(null);
    this._manualTestError.set(null);
    this.service.testManualConnection(body).subscribe({
      next: result => {
        this._manualTestResult.set(result);
        this._manualTesting.set(false);
      },
      error: err => {
        this._manualTestError.set(toApiError(err).message);
        this._manualTesting.set(false);
      },
    });
  }

  /** Reintenta el watch/subscription de una cuenta (POST /connectors/accounts/{id}/reauth). */
  reauthAccount(accountId: string): void {
    if (this._reauthBusyId()) {
      return;
    }
    this._reauthBusyId.set(accountId);
    this._connectError.set(null);
    this.service.reauthAccount(accountId).subscribe({
      next: () => {
        this._reauthBusyId.set(null);
        this.reloadAccounts();
      },
      error: err => {
        this._connectError.set(toApiError(err).message);
        this._reauthBusyId.set(null);
      },
    });
  }

  /** Desconecta una cuenta (DELETE /connectors/accounts/{id}) y recarga la lista. */
  disconnectAccount(accountId: string): void {
    if (this._disconnectBusyId()) {
      return;
    }
    this._disconnectBusyId.set(accountId);
    this._connectError.set(null);
    this.service.disconnectAccount(accountId).subscribe({
      next: () => {
        this._disconnectBusyId.set(null);
        // Si era la cuenta activa, reloadAccounts reasigna a otra usable (o null → pantalla de conectar).
        this.reloadAccounts();
      },
      error: err => {
        this._connectError.set(toApiError(err).message);
        this._disconnectBusyId.set(null);
      },
    });
  }

  // ---------- Selección ----------

  /** Filtra por cliente sin cambiar de carpeta (en Sent, p. ej., quedan los enviados a ese cliente). */
  selectCustomer(customerId: string): void {
    // Embebido: el cliente está fijado por el perfil, no se cambia.
    if (this.embedded()) {
      return;
    }
    if (customerId === this._selectedCustomerId() && !this._unlinkedView()) {
      return;
    }
    this._selectedCustomerId.set(customerId);
    this._unlinkedView.set(false);
    this.reloadForScope(true);
  }

  /**
   * Cambio de filtro: lo cargado y lo seleccionado era del anterior. Se queda en la carpeta y recarga lo
   * que esa carpeta muestra; Sent/Trash de otras carpetas se recargan perezosos al entrar.
   * `threadsToo` = false cuando el cambio solo toca a Sent/Drafts/Trash ("Not a client").
   */
  private reloadForScope(threadsToo: boolean): void {
    this.clearThreadSelection();
    this.closeComposeSilently();
    this._drafts.set([]);
    this._draftsTotal.set(0);
    this._sent.set([]);
    this._trash.set([]);
    if (threadsToo) {
      this._threads.set([]);
      this.loadThreads(true);
    }
    this.loadDrafts(true);
    const folder = this._activeFolderId();
    if (folder === 'sent') this.loadSent(true);
    if (folder === 'trash') this.loadTrash(true);
  }

  selectFolder(folderId: MailFolderId): void {
    this._activeFolderId.set(folderId);
    this.clearThreadSelection();
    this.closeComposeSilently();
    // Cambiar de carpeta vacía el buscador de la lista: la búsqueda en el servidor deja de filtrar.
    if (this._threadSearch()) {
      this._threadSearch.set('');
      this.threadSearch$.next('');
      this.loadThreads(true);
    }
    // "Not a client" no existe en el Inbox ni en Archived: al volver ahí, Sent/Drafts/Trash vuelven a todo.
    if (!OUTGOING_FOLDERS.has(folderId) && this._unlinkedView()) {
      this._unlinkedView.set(false);
      this._sent.set([]);
      this._trash.set([]);
      this.loadDrafts(true);
    }
    // Carga perezosa al entrar (una vez); las demás ya vienen del boot.
    if (folderId === 'sent' && this._sent().length === 0 && !this._sentLoading()) {
      this.loadSent(true);
    }
    if (folderId === 'trash' && this._trash().length === 0 && !this._trashLoading()) {
      this.loadTrash(true);
    }
  }

  // ---------- Hilos ----------

  /**
   * Hilos del Inbox (activos y archivados en una sola lista). `silent` = refresco en segundo plano
   * (correo entrante): no vacía la lista ni muestra el loader, solo la reemplaza al llegar.
   */
  loadThreads(reset: boolean, silent = false): void {
    const customerId = this._selectedCustomerId();
    const page = reset ? 1 : this._threadsPage() + 1;
    const seq = ++this.threadsRequestSeq;
    if (!silent) {
      this._threadsLoading.set(true);
      this._threadsError.set(null);
      if (reset) {
        this._threads.set([]);
      }
    }
    this.service.listInboxThreads({ customerId, search: this._threadSearch() }, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        if (seq !== this.threadsRequestSeq) return;
        this._threads.update(list => (reset ? result.items : [...list, ...result.items]));
        this._threadsPage.set(result.page);
        this._threadsHasMore.set(result.hasMore);
        this._threadsLoading.set(false);
        this.resolveCustomers(result.items.map(item => item.customerId));
      },
      error: err => {
        if (seq !== this.threadsRequestSeq) return;
        this._threadsLoading.set(false);
        if (!silent) this._threadsError.set(toApiError(err).message);
      },
    });
  }

  /** Pide al directorio los clientes de las filas que aún no tienen nombre. */
  private resolveCustomers(ids: readonly (string | null | undefined)[]): void {
    const missing = [...new Set(ids)].filter(
      (id): id is string => !!id && !this._customerIndex().has(id) && !this.requestedCustomerIds.has(id),
    );
    if (missing.length === 0) {
      return;
    }
    missing.forEach(id => this.requestedCustomerIds.add(id));
    this.directory
      .byId(missing)
      .pipe(catchError(() => of(new Map<string, CustomerSummary>())))
      .subscribe(found => this.rememberCustomers([...found.values()]));
  }

  private rememberCustomers(customers: readonly CustomerSummary[]): void {
    if (customers.length === 0) {
      return;
    }
    this._customerIndex.update(current => {
      const next = new Map(current);
      customers.forEach(customer => next.set(customer.id, customer));
      return next;
    });
  }

  // ---------- Drafts ----------

  loadDrafts(reset: boolean): void {
    const scope = this.listScope();
    const page = reset ? 1 : this._draftsPage() + 1;
    this._draftsLoading.set(true);
    this._draftsError.set(null);
    if (reset) {
      this._drafts.set([]);
    }
    this.service.listDrafts(scope, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._drafts.update(list => (reset ? result.items : [...list, ...result.items]));
        this._draftsPage.set(result.page);
        this._draftsHasMore.set(result.hasMore);
        this._draftsTotal.set(result.totalCount);
        this._draftsLoading.set(false);
        this.resolveCustomers(result.items.map(item => item.customerId));
      },
      error: err => {
        this._draftsError.set(toApiError(err).message);
        this._draftsLoading.set(false);
      },
    });
  }

  // ---------- Enviados (Sent) ----------

  loadSent(reset: boolean): void {
    const scope = this.listScope();
    const page = reset ? 1 : this._sentPage() + 1;
    this._sentLoading.set(true);
    this._sentError.set(null);
    if (reset) {
      this._sent.set([]);
    }
    this.service.listSent(scope, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._sent.update(list => (reset ? result.items : [...list, ...result.items]));
        this._sentPage.set(result.page);
        this._sentHasMore.set(result.hasMore);
        this._sentLoading.set(false);
        this.resolveCustomers(result.items.map(item => item.customerId));
      },
      error: err => {
        this._sentError.set(toApiError(err).message);
        this._sentLoading.set(false);
      },
    });
  }

  // ---------- Papelera ----------

  loadTrash(reset: boolean): void {
    const scope = this.listScope();
    const page = reset ? 1 : this._trashPage() + 1;
    this._trashLoading.set(true);
    this._trashError.set(null);
    if (reset) {
      this._trash.set([]);
    }
    this.service.listTrash(scope, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._trash.update(list => (reset ? result.items : [...list, ...result.items]));
        this._trashPage.set(result.page);
        this._trashHasMore.set(result.hasMore);
        this._trashLoading.set(false);
        this.resolveCustomers(result.items.map(item => item.customerId));
      },
      error: err => {
        this._trashError.set(toApiError(err).message);
        this._trashLoading.set(false);
      },
    });
  }

  /** Restaura un ítem de la papelera a su carpeta original. */
  restoreTrashItem(item: TrashItem): void {
    const req$ = item.kind === 'Incoming' ? this.service.restoreMessage(item.messageId) : this.service.restoreSent(item.messageId);
    req$.subscribe({
      next: () => {
        this._trash.update(list => list.filter(t => t.messageId !== item.messageId));
        this.loadThreads(true);
        this._sent.set([]);
      },
      error: err => this._trashError.set(toApiError(err).message),
    });
  }

  /** Borra permanentemente un ítem de la papelera. */
  purgeTrashItem(item: TrashItem): void {
    const req$ = item.kind === 'Incoming' ? this.service.purgeMessage(item.messageId) : this.service.purgeSent(item.messageId);
    req$.subscribe({
      next: () => this._trash.update(list => list.filter(t => t.messageId !== item.messageId)),
      error: err => this._trashError.set(toApiError(err).message),
    });
  }

  /**
   * Manda un mensaje (abierto en el reading-pane) a la papelera. Optimista: desaparece en el acto y un
   * toast dice adónde fue, con "Undo"; si el backend falla, vuelve a su sitio.
   */
  trashOpenMessage(messageId: string): void {
    const message = this._messages().find(m => m.messageId === messageId);
    const threadId = this._selectedThreadId();
    if (!message || !threadId) {
      return;
    }
    const previousMessages = this._messages();
    const previousThreads = this._threads();
    const outbound = message.direction === 'Outbound';

    this._messages.update(list => list.filter(m => m.messageId !== messageId));
    if (this._messages().length === 0) {
      // Hilo sin mensajes visibles: sacarlo de la lista y cerrar.
      this.patchThreads(list => list.filter(t => t.threadId !== threadId));
      this.clearThreadSelection();
    } else if (!outbound) {
      this.patchThreads(list =>
        list.map(t =>
          t.threadId === threadId
            ? {
                ...t,
                messageCount: Math.max(0, t.messageCount - 1),
                unreadCount: message.isRead ? t.unreadCount : Math.max(0, t.unreadCount - 1),
              }
            : t,
        ),
      );
    }
    this._sent.set([]);
    this._trash.set([]);

    const req$ = outbound ? this.service.trashSent(messageId) : this.service.trashMessage(messageId);
    req$.subscribe({
      next: () =>
        this.toast.info('Message moved to Trash', {
          action: { label: 'Undo', run: () => this.undoTrash(messageId, outbound, threadId) },
        }),
      error: err => {
        this.patchThreads(() => previousThreads);
        if (this._selectedThreadId() === threadId || this._selectedThreadId() === null) {
          this._selectedThreadId.set(threadId);
          this._messages.set(previousMessages);
        }
        this.toast.error(toApiError(err).message);
      },
    });
  }

  /** "Undo" del toast de papelera: restaura el mensaje y vuelve a pedir lo que lo muestra. */
  private undoTrash(messageId: string, outbound: boolean, threadId: string): void {
    const req$ = outbound ? this.service.restoreSent(messageId) : this.service.restoreMessage(messageId);
    req$.subscribe({
      next: () => {
        this._sent.set([]);
        this._trash.set([]);
        this.loadThreads(true, true);
        if (this._selectedThreadId() === threadId) this.loadMessages(true);
      },
      error: err => this.toast.error(toApiError(err).message),
    });
  }

  /**
   * Abre un mensaje enviado desde la carpeta Sent. Reply (con hilo) → abre el hilo real. Compose
   * nuevo (sin hilo) → hilo sintético de un solo mensaje saliente para reusar el reading-pane; se
   * auto-expande para pedir el body (GET /drafts/{id}) y sus adjuntos.
   */
  openSentMessage(item: SentMessageListItem): void {
    if (item.emailThreadId) {
      this.selectThread(item.emailThreadId);
      return;
    }
    this._syntheticThread.set({
      threadId: `sent:${item.messageId}`,
      subject: item.subject,
      status: 'Active',
      messageCount: 1,
      firstMessageAtUtc: item.sentAtUtc,
      lastMessageAtUtc: item.sentAtUtc,
      unreadCount: 0,
      customerId: item.customerId ?? undefined,
    });
    this._selectedThreadId.set(`sent:${item.messageId}`);
    this._messages.set([this.sentItemToMessage(item)]);
    this._messagesError.set(null);
    this._messagesHasMore.set(false);
    this._bodies.set(new Map());
    this._attachments.set(new Map());
    this.expandMessage(item.messageId);
  }

  private sentItemToMessage(item: SentMessageListItem): MessageSummary {
    return {
      messageId: item.messageId,
      direction: 'Outbound',
      from: null,
      fromDisplayName: null,
      subject: item.subject,
      snippet: null,
      toAddresses: item.toAddresses,
      occurredAtUtc: item.sentAtUtc,
      hasAttachments: item.hasAttachments,
      attachmentCount: item.attachmentCount,
      bodyStatus: null,
      isRead: true,
      senderTrust: null,
    };
  }

  /** "Load more" del listado central, según la carpeta activa. */
  loadMoreList(): void {
    switch (this._activeFolderId()) {
      case 'drafts':
        this.loadDrafts(false);
        break;
      case 'sent':
        this.loadSent(false);
        break;
      case 'trash':
        this.loadTrash(false);
        break;
      default:
        this.loadThreads(false);
    }
  }

  retryList(): void {
    switch (this._activeFolderId()) {
      case 'drafts':
        this.loadDrafts(true);
        break;
      case 'sent':
        this.loadSent(true);
        break;
      case 'trash':
        this.loadTrash(true);
        break;
      default:
        this.loadThreads(true);
    }
  }

  // ---------- Hilo seleccionado ----------

  selectThread(threadId: string): void {
    this.closeComposeSilently();
    if (threadId === this._selectedThreadId() && !this._syntheticThread()) {
      return;
    }
    this._syntheticThread.set(null); // abrir un hilo real descarta la vista suelta de un enviado
    this._selectedThreadId.set(threadId);
    this.resetThreadDetail();
    this.markReadOnOpen(threadId);
    this.loadMessages(true);
  }

  /** Hilo marcado leído al abrirlo: sus mensajes llegan después y no deben volver a pintarse sin leer. */
  private readOnOpenThreadId: string | null = null;

  /**
   * Abrir un hilo lo marca leído en el acto (como Gmail), sin esperar a que el cuerpo baje del buzón
   * externo: antes el contador y la fila seguían "sin leer" varios segundos, o para siempre si el cuerpo
   * fallaba o el mensaje sin leer no era el que se expandía.
   */
  private markReadOnOpen(threadId: string): void {
    const thread = this._threads().find(item => item.threadId === threadId);
    if (!thread || thread.unreadCount === 0) {
      this.readOnOpenThreadId = null;
      return;
    }
    const unread = thread.unreadCount;
    this.readOnOpenThreadId = threadId;
    this.patchThreads(list => list.map(item => (item.threadId === threadId ? { ...item, unreadCount: 0 } : item)));
    this.service.markThreadRead(threadId).subscribe({
      error: () => {
        // El backend no lo guardó: se devuelve el estado real para no mentir en el contador.
        if (this.readOnOpenThreadId === threadId) this.readOnOpenThreadId = null;
        this.patchThreads(list =>
          list.map(item => (item.threadId === threadId ? { ...item, unreadCount: unread } : item)),
        );
        if (this._selectedThreadId() === threadId) {
          this._messages.update(items => items.map(item => (item.direction === 'Inbound' ? { ...item, isRead: false } : item)));
        }
      },
    });
  }

  /** Cierra la conversación abierta (el "Back" de pantallas chicas). */
  closeThread(): void {
    this.clearThreadSelection();
  }

  private clearThreadSelection(): void {
    this._syntheticThread.set(null);
    this._selectedThreadId.set(null);
    this.resetThreadDetail();
  }

  private resetThreadDetail(): void {
    this._messages.set([]);
    this._messagesError.set(null);
    this._messagesHasMore.set(false);
    this._messagesPage.set(1);
    this._expandedMessageId.set(null);
    this._bodies.set(new Map());
    this._attachments.set(new Map());
    this._reply.set(null);
  }

  loadMessages(reset: boolean): void {
    const threadId = this._selectedThreadId();
    // El hilo sintético de un enviado suelto (`sent:{id}`) no existe en el backend: sus mensajes se
    // inyectaron en openSentMessage, no se piden por HTTP.
    if (!threadId || threadId.startsWith('sent:')) {
      return;
    }
    const page = reset ? 1 : this._messagesPage() + 1;
    this._messagesLoading.set(true);
    this._messagesError.set(null);
    this.service.listThreadMessages(threadId, page, THREAD_PAGE_SIZE).subscribe({
      next: result => {
        // Cronológico ascendente: páginas siguientes agregan mensajes MÁS NUEVOS al final.
        const items =
          this.readOnOpenThreadId === threadId
            ? result.items.map(item => (item.direction === 'Inbound' ? { ...item, isRead: true } : item))
            : result.items;
        this._messages.update(list => (reset ? items : [...list, ...items]));
        this._messagesPage.set(result.page);
        this._messagesHasMore.set(result.hasMore);
        this._messagesLoading.set(false);
        // Al abrir el hilo se expande el último mensaje (el más reciente), como un cliente de correo.
        if (reset && result.items.length > 0 && !result.hasMore) {
          this.expandMessage(result.items[result.items.length - 1].messageId);
        }
      },
      error: err => {
        this._messagesError.set(toApiError(err).message);
        this._messagesLoading.set(false);
      },
    });
  }

  /** Expande/colapsa un mensaje del hilo; expandir dispara body (+ adjuntos si tiene). */
  toggleMessage(messageId: string): void {
    if (this._expandedMessageId() === messageId) {
      this._expandedMessageId.set(null);
      return;
    }
    this.expandMessage(messageId);
  }

  /** Expande un mensaje concreto sin alternarlo; false indica que el hilo aun no lo cargo. */
  openMessage(messageId: string): boolean {
    if (!this._messages().some(message => message.messageId === messageId)) {
      return false;
    }
    if (this._expandedMessageId() !== messageId) {
      this.expandMessage(messageId);
    }
    return true;
  }

  private expandMessage(messageId: string): void {
    this._expandedMessageId.set(messageId);
    this.ensureBody(messageId);
    const message = this._messages().find(item => item.messageId === messageId);
    if (message?.hasAttachments && message.direction === 'Inbound') {
      this.ensureAttachments(messageId);
    }
  }

  retryBody(messageId: string): void {
    this.updateBody(messageId, null);
    this.ensureBody(messageId);
  }

  /**
   * Body bajo demanda. Inbound: GET /messages/{id}/body (en vivo desde el buzón externo).
   * Outbound: el "mensaje" es un Draft enviado — su body vive en GET /drafts/{id}.
   */
  private ensureBody(messageId: string): void {
    const existing = this._bodies().get(messageId);
    if (existing && !existing.error) {
      return;
    }
    const message = this._messages().find(item => item.messageId === messageId);
    if (!message) {
      return;
    }
    this.updateBody(messageId, { loading: true, error: null, html: null, text: null });

    // Outbound: el "mensaje" es un Draft enviado — body Y adjuntos vienen de GET /drafts/{id}.
    if (message.direction === 'Outbound') {
      this.service.getDraft(messageId).subscribe({
        next: draft => {
          this.updateBody(messageId, { loading: false, error: null, html: draft.htmlBody, text: draft.textBody });
          this.setOutboundAttachments(messageId, draft.attachments);
        },
        error: err => {
          this.updateBody(messageId, { loading: false, error: toApiError(err).message, html: null, text: null });
        },
      });
      return;
    }

    // Inbound: GET /messages/{id}/body (en vivo desde el buzón externo).
    this.service.getMessageBody(messageId).subscribe({
      next: body => {
        this.updateBody(messageId, { loading: false, error: null, html: body.htmlBody, text: body.textBody });
        // El backend marca BodyReady al servir el body: reflejarlo local (apaga el punto "nunca abierto").
        if (message.bodyStatus === 'BodyPending') {
          this._messages.update(list =>
            list.map(item => (item.messageId === messageId ? { ...item, bodyStatus: 'BodyReady' } : item)),
          );
        }
        // Abrir el cuerpo marca el correo como leído en el backend (GetMessageBodyHandler): reflejar
        // local para que baje el contador de no-leídos del hilo sin recargar el listado.
        if (!message.isRead) {
          this.applyMessageReadLocal(messageId, true);
        }
      },
      error: err => {
        this.updateBody(messageId, { loading: false, error: toApiError(err).message, html: null, text: null });
      },
    });
  }

  /**
   * Adjuntos de un mensaje SALIENTE (draft enviado): ya viven en CloudStorage, así que se pintan con
   * estado `Downloaded` y la key = fileId. La descarga usa la URL presignada de CloudStorage
   * (ver downloadAttachment), no el flujo de descarga bajo demanda de los entrantes.
   */
  private setOutboundAttachments(messageId: string, attachments: DraftAttachmentSummary[]): void {
    if (attachments.length === 0) {
      return;
    }
    this._attachments.update(current => {
      const next = new Map(current);
      next.set(messageId, {
        loading: false,
        error: null,
        items: attachments.map(a => ({
          attachmentId: a.fileId,
          filename: a.filename,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          isInline: false,
          downloadStatus: 'Downloaded' as const,
          cloudStorageFileId: a.fileId,
          busy: false,
          error: null,
        })),
      });
      return next;
    });
  }

  private updateBody(messageId: string, body: MessageBodyView | null): void {
    this._bodies.update(current => {
      const next = new Map(current);
      if (body === null) {
        next.delete(messageId);
      } else {
        next.set(messageId, body);
      }
      return next;
    });
  }

  // ---------- Adjuntos (inbound) ----------

  private ensureAttachments(messageId: string): void {
    const existing = this._attachments().get(messageId);
    if (existing && !existing.error) {
      return;
    }
    this.setAttachments(messageId, { loading: true, error: null, items: [] });
    this.service.listMessageAttachments(messageId).subscribe({
      next: items => {
        this.setAttachments(messageId, {
          loading: false,
          error: null,
          items: items.map(item => ({ ...item, busy: false, error: null })),
        });
      },
      error: err => {
        this.setAttachments(messageId, { loading: false, error: toApiError(err).message, items: [] });
      },
    });
  }

  retryAttachments(messageId: string): void {
    this._attachments.update(current => {
      const next = new Map(current);
      next.delete(messageId);
      return next;
    });
    this.ensureAttachments(messageId);
  }

  /**
   * Descarga de un adjunto: si nunca se pidió, POST /download dispara la copia a CloudStorage;
   * el GET /download-url devuelve 409 mientras no termina, así que se reintenta con espera.
   * Al final se baja con un ancla oculta (sin abrir pestaña).
   */
  downloadAttachment(messageId: string, attachmentId: string): void {
    const view = this._attachments().get(messageId);
    const item = view?.items.find(att => att.attachmentId === attachmentId);
    if (!view || !item || item.busy) {
      return;
    }
    this.patchAttachment(messageId, attachmentId, { busy: true, error: null });
    this.attachmentUrl(messageId, attachmentId).subscribe({
      next: url => {
        this.patchAttachment(messageId, attachmentId, { busy: false });
        this.triggerDownload(url);
      },
      error: err => {
        const apiError = toApiError(err);
        // Bloqueado o en revisión de contenido: `attachmentUrl` ya reflejó el estado; sin error genérico.
        if (apiError.code === 'IncomingEmailAttachment.Blocked' || apiError.code === 'IncomingEmailAttachment.UnderReview') {
          this.patchAttachment(messageId, attachmentId, { busy: false, error: null });
          return;
        }
        this.patchAttachment(messageId, attachmentId, { busy: false, error: apiError.message });
      },
    });
  }

  /**
   * URL presignada de un adjunto, para la descarga y para el visor global de archivos.
   * - Saliente: el binario ya está en CloudStorage (attachmentId == fileId) — URL directa.
   * - Entrante: si nunca se pidió, POST /download dispara la copia a CloudStorage y se espera
   *   (GET /download-url da 409 mientras no termina). Marca el adjunto como Downloaded/Blocked.
   *
   * Lazy-download race: `downloadStatus=Downloaded` significa que Correspondence bajó el blob de
   * Gmail, pero el `SaveFileRequestedIntegrationEvent` que lo copia a CloudStorage puede estar en
   * vuelo o haber fallado en un intento previo — el GET /download-url devuelve 404 hasta que el
   * file aterrice. En vez de propagar el 404 al user, caemos a la ruta lenta (POST /download +
   * wait) para re-disparar la copia y transparentar el retry.
   */
  attachmentUrl(messageId: string, attachmentId: string): Observable<string> {
    const message = this._messages().find(m => m.messageId === messageId);
    if (message?.direction === 'Outbound') {
      return this.uploads.getDownloadUrl(attachmentId).pipe(map(result => result.downloadUrl));
    }
    const item = this._attachments().get(messageId)?.items.find(att => att.attachmentId === attachmentId);
    const slowPath$ = this.service
      .requestAttachmentDownload(messageId, attachmentId)
      .pipe(concatMap(() => this.waitForDownloadUrl(messageId, attachmentId)));
    const url$ =
      item?.downloadStatus === 'Downloaded'
        ? this.service.getAttachmentDownloadUrl(messageId, attachmentId).pipe(
            catchError(err =>
              err instanceof HttpErrorResponse && err.status === 404
                ? slowPath$
                : throwError(() => err),
            ),
          )
        : slowPath$;
    return url$.pipe(
      map(result => {
        this.patchAttachment(messageId, attachmentId, { downloadStatus: 'Downloaded' });
        return result.downloadUrl;
      }),
      catchError(err => {
        const code = toApiError(err).code;
        if (code === 'IncomingEmailAttachment.Blocked') {
          this.patchAttachment(messageId, attachmentId, { downloadStatus: 'Blocked' });
        } else if (code === 'IncomingEmailAttachment.UnderReview') {
          this.patchAttachment(messageId, attachmentId, { downloadStatus: 'UnderReview' });
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Dispara la descarga directa de la URL presignada sin abrir una pestaña (que expondría la URL).
   * CloudStorage sirve el archivo con `content-disposition: attachment`, así que el click en un anchor
   * oculto baja el archivo con su nombre real y NO navega ni deja una pestaña en blanco.
   */
  private triggerDownload(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    anchor.download = ''; // hint local; el download real lo fuerza el content-disposition del server
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  private waitForDownloadUrl(messageId: string, attachmentId: string) {
    return this.service.getAttachmentDownloadUrl(messageId, attachmentId).pipe(
      retry({
        count: DOWNLOAD_URL_RETRIES,
        delay: error =>
          error instanceof HttpErrorResponse && error.status === 409
            ? timer(DOWNLOAD_URL_RETRY_MS)
            : throwError(() => error),
      }),
    );
  }

  private setAttachments(messageId: string, view: MessageAttachmentsView): void {
    this._attachments.update(current => {
      const next = new Map(current);
      next.set(messageId, view);
      return next;
    });
  }

  private patchAttachment(
    messageId: string,
    attachmentId: string,
    patch: Partial<MessageAttachmentView>,
  ): void {
    this._attachments.update(current => {
      const view = current.get(messageId);
      if (!view) {
        return current;
      }
      const next = new Map(current);
      next.set(messageId, {
        ...view,
        items: view.items.map(item => (item.attachmentId === attachmentId ? { ...item, ...patch } : item)),
      });
      return next;
    });
  }

  // ---------- Archivar hilo ----------

  archiveSelectedThread(): void {
    const threadId = this._selectedThreadId();
    if (threadId) this.moveThread(threadId, 'Archived', true);
  }

  /** Desarchiva el hilo abierto (Archived → Active). */
  unarchiveSelectedThread(): void {
    const threadId = this._selectedThreadId();
    if (threadId) this.moveThread(threadId, 'Active', true);
  }

  /**
   * Archiva o desarchiva optimista: el hilo cambia de carpeta en el acto y un toast dice adónde fue, con
   * "Undo" (que es el movimiento contrario, sin otro Undo). Archivar también lo deja leído, como el backend.
   * Si el backend falla, el hilo vuelve a como estaba.
   */
  private moveThread(threadId: string, status: 'Active' | 'Archived', undoable: boolean): void {
    const previous = this._threads().find(thread => thread.threadId === threadId);
    if (!previous || previous.status === status) {
      return;
    }
    this.patchThreads(list =>
      list.map(thread =>
        thread.threadId === threadId
          ? { ...thread, status, unreadCount: status === 'Archived' ? 0 : thread.unreadCount }
          : thread,
      ),
    );
    if (this._selectedThreadId() === threadId) {
      this.clearThreadSelection();
    }
    this._archiving.set(true);
    const req$ = status === 'Archived' ? this.service.archiveThread(threadId) : this.service.unarchiveThread(threadId);
    req$.subscribe({
      next: () => {
        this._archiving.set(false);
        if (!undoable) return;
        this.toast.info(status === 'Archived' ? 'Conversation archived' : 'Conversation moved to Inbox', {
          action: { label: 'Undo', run: () => this.moveThread(threadId, previous.status, false) },
        });
      },
      error: err => {
        this._archiving.set(false);
        this.patchThreads(list => list.map(thread => (thread.threadId === threadId ? previous : thread)));
        this.toast.error(toApiError(err).message);
      },
    });
  }

  // ---------- Leído / no leído ----------

  /**
   * Marca UN mensaje inbound como leído/no-leído. Optimista: refleja local de inmediato (el
   * contador de no-leídos del hilo baja/sube al toque) y revierte si el backend falla.
   */
  setMessageRead(messageId: string, isRead: boolean): void {
    if (!isRead) this.readOnOpenThreadId = null;
    const message = this._messages().find(item => item.messageId === messageId);
    if (!message || message.direction !== 'Inbound' || message.isRead === isRead) {
      return;
    }
    this.applyMessageReadLocal(messageId, isRead);
    const request$ = isRead ? this.service.markMessageRead(messageId) : this.service.markMessageUnread(messageId);
    request$.subscribe({
      error: err => {
        this.applyMessageReadLocal(messageId, !isRead); // revertir
        this._messagesError.set(toApiError(err).message);
      },
    });
  }

  /** Marca TODO el hilo abierto como leído/no-leído. Optimista con reversión ante fallo. */
  setThreadRead(isRead: boolean): void {
    const threadId = this._selectedThreadId();
    if (!threadId) {
      return;
    }
    if (!isRead) this.readOnOpenThreadId = null;
    const previousMessages = this._messages();
    const previousThreads = this._threads();
    this._messages.update(list =>
      list.map(item => (item.direction === 'Inbound' ? { ...item, isRead } : item)),
    );
    this.patchThreads(list =>
      list.map(thread =>
        thread.threadId === threadId
          ? { ...thread, unreadCount: isRead ? 0 : this.inboundCountOf(threadId) }
          : thread,
      ),
    );
    const request$ = isRead ? this.service.markThreadRead(threadId) : this.service.markThreadUnread(threadId);
    request$.subscribe({
      error: err => {
        this._messages.set(previousMessages);
        this.patchThreads(() => previousThreads);
        this._messagesError.set(toApiError(err).message);
      },
    });
  }

  /**
   * Conversaciones sin leer del Inbox (badge de la carpeta). Sin filtro de cliente es el conteo del
   * servidor (la lista solo tiene la primera página); con cliente, lo cargado de ese cliente.
   */
  readonly inboxUnread = computed(() =>
    !this.embedded() && !this._selectedCustomerId() ? this.unread.threads() : countUnreadActive(this.activeThreads()),
  );

  /**
   * Cambio optimista de la lista de hilos que mueve el badge global en el mismo paso (sin esperar al
   * próximo conteo del servidor). Las cargas no pasan por acá: reemplazan la lista, no la editan.
   */
  private patchThreads(update: (list: ThreadSummary[]) => ThreadSummary[]): void {
    const before = countUnreadActive(this._threads());
    this._threads.update(update);
    const delta = countUnreadActive(this._threads()) - before;
    if (delta !== 0) this.unread.adjustThreads(delta);
  }

  /** Actualiza isRead de un mensaje en memoria y ajusta el unreadCount del hilo abierto por el delta. */
  private applyMessageReadLocal(messageId: string, isRead: boolean): void {
    const threadId = this._selectedThreadId();
    let delta = 0;
    this._messages.update(list =>
      list.map(item => {
        if (item.messageId !== messageId || item.isRead === isRead) {
          return item;
        }
        delta = isRead ? -1 : 1;
        return { ...item, isRead };
      }),
    );
    if (delta !== 0 && threadId) {
      this.patchThreads(list =>
        list.map(thread =>
          thread.threadId === threadId
            ? { ...thread, unreadCount: Math.max(0, thread.unreadCount + delta) }
            : thread,
        ),
      );
    }
  }

  /** Mensajes inbound cargados del hilo — mejor esfuerzo para el optimista de "marcar todo no-leído". */
  private inboundCountOf(threadId: string): number {
    if (this._selectedThreadId() !== threadId) {
      return 0;
    }
    return this._messages().filter(item => item.direction === 'Inbound').length;
  }

  // ---------- Reply inline ----------

  /** Abre el reply sobre un mensaje inbound: get-or-create del draft en el backend. */
  startReply(messageId: string): void {
    const account = this.activeAccount();
    const message = this._messages().find(item => item.messageId === messageId);
    if (!account || !message || message.direction !== 'Inbound' || !message.from) {
      return;
    }
    this._reply.set({
      messageId,
      draftId: '',
      subject: '',
      toAddress: message.from,
      toDisplayName: message.fromDisplayName,
      starting: true,
      sending: false,
      error: null,
    });
    this.service.startReply(messageId, account.id).subscribe({
      next: result => {
        this._reply.update(current =>
          current?.messageId === messageId
            ? { ...current, draftId: result.draftId, subject: result.subject, starting: false }
            : current,
        );
      },
      error: err => {
        this._reply.update(current =>
          current?.messageId === messageId
            ? { ...current, starting: false, error: toApiError(err).message }
            : current,
        );
      },
    });
  }

  /** Discard del reply: descarta el draft en el backend (best-effort) y cierra el editor. */
  cancelReply(): void {
    const reply = this._reply();
    this._reply.set(null);
    if (reply?.draftId) {
      this.service.discardDraft(reply.draftId).subscribe({
        next: () => this.loadDrafts(true),
        error: () => undefined,
      });
    }
  }

  /** Autosave (To = remitente original + body) y envío síncrono del reply. */
  sendReply(text: string): void {
    const reply = this._reply();
    const trimmed = text.trim();
    if (!reply || !reply.draftId || reply.sending || trimmed.length === 0) {
      return;
    }
    this._reply.update(current => (current ? { ...current, sending: true, error: null } : current));
    this.service
      .autoSaveDraft(reply.draftId, {
        htmlBody: plainTextToHtml(trimmed),
        textBody: trimmed,
        to: [{ address: reply.toAddress, displayName: reply.toDisplayName }],
      })
      .pipe(concatMap(() => this.service.sendDraft(reply.draftId)))
      .subscribe({
        next: () => {
          this._reply.set(null);
          this.showSentToast();
          // El mensaje enviado entra al hilo como outbound: recargar la conversación.
          this.loadMessages(true);
          this.loadThreads(true);
          this.loadDrafts(true);
        },
        error: err => {
          this._reply.update(current =>
            current ? { ...current, sending: false, error: toApiError(err).message } : current,
          );
        },
      });
  }

  // ---------- Composer completo ----------

  /**
   * Redacción nueva; `initialTo` precarga el destinatario (p. ej. el email del cliente). Se archiva en
   * el cliente filtrado (en el perfil, siempre el del perfil); sin filtro, en el cliente que se elija
   * como destinatario (`fileComposeUnder`) o en ninguno.
   */
  openCompose(initialTo: string | null = null): void {
    this._reply.set(null);
    this._compose.set({
      ...EMPTY_COMPOSE,
      open: true,
      initialTo: initialTo?.trim() || null,
      customerId: this._selectedCustomerId(),
    });
  }

  /** Elegir a un cliente como destinatario archiva en él la redacción nueva que aún no tiene cliente. */
  fileComposeUnder(customer: CustomerSummary): void {
    const compose = this._compose();
    if (
      this.embedded() ||
      !compose.open ||
      compose.draft ||
      compose.loadingDraft ||
      compose.customerId !== null ||
      !compose.autoFile
    ) {
      return;
    }
    this.rememberCustomers([customer]);
    this._compose.update(state => ({ ...state, customerId: customer.id }));
  }

  /** En una redacción nueva de /email aún se puede no archivarla en el cliente; nunca en el perfil. */
  readonly canUnlinkComposeCustomer = computed(() => {
    const compose = this._compose();
    return !this.embedded() && compose.open && !compose.draft && !compose.loadingDraft && compose.customerId !== null;
  });

  /** "No archivar en este cliente": el correo sale igual, pero a la vista "Not a client". */
  unlinkComposeCustomer(): void {
    if (!this.canUnlinkComposeCustomer()) {
      return;
    }
    this._compose.update(state => ({ ...state, customerId: null, autoFile: false }));
  }

  /** Retoma un draft existente desde la carpeta Drafts (GET /drafts/{id} para prellenar). */
  openDraft(draftId: string): void {
    this._reply.set(null);
    this._compose.set({ ...EMPTY_COMPOSE, open: true, loadingDraft: true });
    this.service.getDraft(draftId).subscribe({
      next: draft => {
        // Un draft retomado ya tiene su cliente (o ninguno) desde que se creó.
        this._compose.update(state =>
          state.open ? { ...state, draft, loadingDraft: false, customerId: draft.customerId } : state,
        );
      },
      error: err => {
        this._compose.update(state =>
          state.open ? { ...state, loadingDraft: false, loadError: toApiError(err).message } : state,
        );
      },
    });
  }

  /** Cierra el composer sin tocar el backend (el draft creado, si existe, queda en Drafts). */
  closeCompose(): void {
    this.closeComposeSilently();
  }

  /** Descarta el draft retomado (DELETE) y cierra. Para redacciones nuevas solo cierra. */
  discardCompose(): void {
    const state = this._compose();
    this.closeComposeSilently();
    if (state.draft) {
      this.service.discardDraft(state.draft.draftId).subscribe({
        next: () => this.loadDrafts(true),
        error: () => undefined,
      });
    }
  }

  private closeComposeSilently(): void {
    this._compose.set(EMPTY_COMPOSE);
  }

  /**
   * Cadena real de envío: (create draft si es nuevo) → autosave (subject/body/to/cc) → quitar
   * adjuntos removidos → subir cada archivo a CloudStorage (initiate → POST presignado → complete)
   * y referenciarlo en el draft → send síncrono vía Postmaster. El autosave del contenido va PRIMERO
   * a propósito: si la subida de un adjunto falla, el draft queda en Drafts con su asunto/cuerpo/
   * destinatarios intactos (no vacío) para retomarlo, y el error se muestra en el composer.
   */
  sendCompose(payload: ComposeSendPayload): void {
    const state = this._compose();
    if (state.sending) {
      return;
    }
    // El cliente del draft retomado manda sobre el del estado: es con el que ya se creó en el backend.
    const customerId = state.draft ? state.draft.customerId : state.customerId;
    // Sin cliente, los adjuntos van a la carpeta del autor: sin su id no hay dónde subirlos. Se corta
    // antes de crear nada, con un mensaje que diga qué hacer.
    if (payload.files.length > 0 && !this.attachmentOwner(customerId)) {
      this._compose.update(current => ({ ...current, error: ATTACHMENT_OWNER_UNKNOWN }));
      return;
    }
    this._compose.update(current => ({ ...current, sending: true, error: null }));
    const draftId$: Observable<string> = state.draft
      ? of(state.draft.draftId)
      : this.service.createDraft(customerId, payload.accountId).pipe(map(result => result.draftId));

    draftId$
      .pipe(
        concatMap(draftId =>
          this.service
            .autoSaveDraft(draftId, {
              subject: payload.subject.trim(),
              htmlBody: payload.bodyHtml,
              textBody: payload.bodyText,
              to: parseRecipients(payload.to),
              cc: parseRecipients(payload.cc),
            })
            .pipe(map(() => draftId)),
        ),
        concatMap(draftId => this.removeAttachmentsChain(draftId, payload.removedFileIds)),
        concatMap(draftId => this.uploadAndAttachChain(draftId, customerId, payload.files)),
        concatMap(draftId => this.service.sendDraft(draftId)),
      )
      .subscribe({
        next: () => {
          this.closeComposeSilently();
          this.showSentToast();
          this.loadDrafts(true);
          this.loadThreads(true);
        },
        error: err => {
          this._compose.update(current => ({ ...current, sending: false, error: toApiError(err).message }));
          // El draft (creado o retomado) sigue vivo con lo autoguardado hasta acá.
          this.loadDrafts(true);
        },
      });
  }

  private removeAttachmentsChain(draftId: string, fileIds: string[]): Observable<string> {
    let chain: Observable<unknown> = of(null);
    for (const fileId of fileIds) {
      chain = chain.pipe(concatMap(() => this.service.removeDraftAttachment(draftId, fileId)));
    }
    return chain.pipe(map(() => draftId));
  }

  private uploadAndAttachChain(draftId: string, customerId: string | null, files: File[]): Observable<string> {
    let chain: Observable<unknown> = of(null);
    for (const file of files) {
      chain = chain.pipe(
        concatMap(() => this.uploadToCloudStorage(customerId, file)),
        concatMap(ref => this.service.attachFileToDraft(draftId, ref)),
      );
    }
    return chain.pipe(map(() => draftId));
  }

  /**
   * Flujo presigned-POST de CloudStorage (mismo cliente core que documents/chat), bucket EmailOutgoing.
   * Con cliente, el adjunto va a su carpeta; sin cliente, a la del autor: no puede caer en la ficha de
   * un cliente que no tiene nada que ver con el correo.
   */
  private uploadToCloudStorage(customerId: string | null, file: File): Observable<AttachFileToDraftRequest> {
    const owner = this.attachmentOwner(customerId);
    if (!owner) {
      return throwError(() => new Error(ATTACHMENT_OWNER_UNKNOWN));
    }
    const contentType = file.type || 'application/octet-stream';
    return this.uploads
      .initiateUpload({
        originalName: file.name,
        contentType,
        sizeBytes: file.size,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        folderType: 'EmailOutgoing',
        // EmailOutgoing particiona por año (RequiresYear en CloudStorage), igual que EmailIncoming
        // usa el año de recepción — acá el saliente se sube al enviar, así que va el año actual.
        taxYear: new Date().getFullYear(),
      })
      .pipe(
        concatMap(init =>
          this.uploads.uploadToPresignedUrl(init.uploadUrl, init.formData, file).pipe(map(() => init.fileId)),
        ),
        concatMap(fileId => this.uploads.completeUpload(fileId).pipe(map(() => fileId))),
        map(fileId => ({ fileId, filename: file.name, contentType, sizeBytes: file.size })),
      );
  }

  private attachmentOwner(customerId: string | null): { ownerType: 'Customer' | 'User'; ownerId: string } | null {
    if (customerId) {
      return { ownerType: 'Customer', ownerId: customerId };
    }
    const userId = this.auth.currentUser()?.id;
    return userId ? { ownerType: 'User', ownerId: userId } : null;
  }

  // ---------- Toast ----------

  private showSentToast(): void {
    this._sentToast.set(true);
    if (this.sentToastTimer !== null) {
      clearTimeout(this.sentToastTimer);
    }
    this.sentToastTimer = setTimeout(() => {
      this.sentToastTimer = null;
      this._sentToast.set(false);
    }, 2500);
  }
}

/** Conversaciones activas con algo sin leer. */
function countUnreadActive(threads: readonly ThreadSummary[]): number {
  return threads.filter(thread => thread.status === 'Active' && thread.unreadCount > 0).length;
}
