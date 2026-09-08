import { Injectable, computed, inject, signal } from '@angular/core';
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
import { MailSocketService } from './mail-socket.service';
import {
  AttachFileToDraftRequest,
  AttachmentSummary,
  ConnectManualAccountRequest,
  DraftAttachmentSummary,
  DraftDetail,
  DraftListItem,
  MailAccount,
  MailCustomerSummary,
  MessageSummary,
  SentMessageListItem,
  ThreadSummary,
  TrashItem,
  isUsableAccount,
  parseRecipients,
  plainTextToHtml,
} from './mail.model';
import { ProviderDetection, detectProvider } from './mail-provider-detect.util';

/** Carpetas honestas: solo las que tienen respaldo real en Correspondence. */
export type MailFolderId = 'conversations' | 'sent' | 'archived' | 'drafts' | 'trash';

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
}

/** Payload que el composer emite al presionar Send; el store corre la cadena real. */
export interface ComposeSendPayload {
  customerId: string;
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  files: File[];
  /** fileIds de adjuntos ya persistidos en el draft que el usuario quitó. */
  removedFileIds: string[];
}

const EMPTY_COMPOSE: ComposeState = {
  open: false,
  draft: null,
  loadingDraft: false,
  loadError: null,
  sending: false,
  error: null,
};

/**
 * Store del módulo Mail (Connectors + Correspondence vía Gateway). providedIn: 'root'.
 * El inbox del backend es POR CUSTOMER (no existe bandeja global del tenant), así que el
 * estado pivota sobre el cliente seleccionado: sus hilos (activos/archivados) y sus drafts.
 * Los componentes ui/ siguen dumb: solo mail-page consume este store.
 */
@Injectable({ providedIn: 'root' })
export class MailStore {
  private readonly service = inject(MailService);
  private readonly uploads = inject(CloudStorageUploadService);
  private readonly auth = inject(AuthService);
  private readonly mailSocket = inject(MailSocketService);

  // ---------- Identidad del usuario (guía la conexión de buzón) ----------

  /** Email de login del usuario — el buzón conectado DEBE ser este (guard de identidad del backend). */
  readonly loginEmail = computed(() => this.auth.currentUser()?.email ?? null);
  /** Proveedor inferido del dominio del email de login, para recomendar OAuth vs IMAP/SMTP manual. */
  readonly providerDetection = computed<ProviderDetection>(() => detectProvider(this.loginEmail()));

  // ---------- Bootstrap: cuentas de buzón + clientes ----------

  private readonly _bootLoading = signal(false);
  private readonly _bootError = signal<string | null>(null);
  private readonly _accounts = signal<MailAccount[]>([]);
  private readonly _customers = signal<MailCustomerSummary[]>([]);
  private initialized = false;

  readonly bootLoading = this._bootLoading.asReadonly();
  readonly bootError = this._bootError.asReadonly();
  readonly accounts = this._accounts.asReadonly();
  readonly customers = this._customers.asReadonly();

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

  // ---------- Selección de cliente y carpeta ----------

  private readonly _selectedCustomerId = signal<string | null>(null);
  private readonly _activeFolderId = signal<MailFolderId>('conversations');

  readonly selectedCustomerId = this._selectedCustomerId.asReadonly();
  readonly activeFolderId = this._activeFolderId.asReadonly();

  // ---------- Typeahead de clientes (reemplaza el <select> que cargaba máx 200) ----------
  // El backend acepta `term`, así que la búsqueda es server-side: escala a cualquier cantidad de
  // clientes sin traerlos todos al DOM. `_customers` (boot) queda solo para el nombre por defecto.
  private readonly _customerQuery = signal('');
  private readonly _selectedCustomerName = signal<string | null>(null);
  private readonly _customerResults = signal<MailCustomerSummary[]>([]);
  private readonly _customerSearchLoading = signal(false);
  private readonly _customerSearch$ = new Subject<string>();

  readonly customerQuery = this._customerQuery.asReadonly();
  readonly selectedCustomerName = this._selectedCustomerName.asReadonly();
  readonly customerResults = this._customerResults.asReadonly();
  readonly customerSearchLoading = this._customerSearchLoading.asReadonly();

  // ---------- Hilos del cliente seleccionado ----------

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
    this.wireCustomerSearch();
    this.refreshBoot();
  }

  /** Búsqueda de clientes server-side, debounced. Cancela la anterior (switchMap) y traga errores. */
  private wireCustomerSearch(): void {
    this._customerSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term => {
          this._customerSearchLoading.set(true);
          return this.service.searchCustomers(term).pipe(
            map(result => result.items),
            catchError(() => of<MailCustomerSummary[]>([])),
          );
        }),
      )
      .subscribe(items => {
        this._customerResults.set(items);
        this._customerSearchLoading.set(false);
      });
  }

  /** Cambió el texto del buscador de clientes (dispara la búsqueda debounced). */
  onCustomerQueryChange(term: string): void {
    this._customerQuery.set(term);
    this._customerSearch$.next(term.trim());
  }

  /** Al enfocar sin texto: muestra los primeros resultados (término vacío = top N del backend). */
  openCustomerSearch(): void {
    if (this._customerResults().length === 0) {
      this._customerSearch$.next('');
    }
  }

  /** Elige un cliente del typeahead: fija id + nombre, limpia el buscador y carga sus hilos. */
  pickCustomer(customer: MailCustomerSummary): void {
    this._selectedCustomerName.set(customer.displayName);
    this._customerQuery.set('');
    this._customerResults.set([]);
    this.selectCustomer(customer.id);
  }

  /** Cierra el socket realtime al salir del módulo Mail (lo llama el componente en ngOnDestroy). */
  teardown(): void {
    this.mailSocket.disconnect();
  }

  /**
   * Escucha `mail.incoming` de Communication (una sola suscripción, persiste con el store singleton):
   * si el correo entrante es del cliente seleccionado recarga sus hilos (el correo nuevo aparece SIN
   * recargar la página y sube el badge de no-leídos); si además está abierto ese mismo hilo, recarga
   * sus mensajes. Para otros clientes no hace nada: sus hilos se cargan frescos al seleccionarlos.
   */
  private subscribeIncomingMailRealtime(): void {
    this.mailSocket.incomingEmail$.subscribe(evt => {
      if (evt.customerId !== this._selectedCustomerId()) {
        return;
      }
      this.loadThreads(true);
      if (evt.emailThreadId === this._selectedThreadId()) {
        this.loadMessages(true);
      }
    });
  }

  refreshBoot(): void {
    this._bootLoading.set(true);
    this._bootError.set(null);
    forkJoin({
      accounts: this.service.listAccounts(),
      customers: this.service.searchCustomers(''),
    }).subscribe({
      next: ({ accounts, customers }) => {
        this._accounts.set(accounts);
        this._customers.set(customers.items);
        this._bootLoading.set(false);
        // Defaults: primera cuenta utilizable + primer cliente, para llegar al inbox sin fricción.
        const usable = accounts.filter(isUsableAccount);
        if (!this._activeAccountId() || !usable.some(account => account.id === this._activeAccountId())) {
          this._activeAccountId.set(usable[0]?.id ?? null);
        }
        if (!this._selectedCustomerId() && customers.items.length > 0) {
          this._selectedCustomerId.set(customers.items[0].id);
          this._selectedCustomerName.set(customers.items[0].displayName);
        }
        if (this._selectedCustomerId() && usable.length > 0) {
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

  /** Refresca solo las cuentas (ej. al volver del consentimiento OAuth). */
  reloadAccounts(): void {
    this.service.listAccounts().subscribe({
      next: accounts => {
        this._accounts.set(accounts);
        const usable = accounts.filter(isUsableAccount);
        if (!this._activeAccountId() || !usable.some(account => account.id === this._activeAccountId())) {
          this._activeAccountId.set(usable[0]?.id ?? null);
        }
        if (this._selectedCustomerId() && usable.length > 0 && this._threads().length === 0) {
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

  /** POST /connectors/accounts y redirección FULL-PAGE al consentimiento de Google/Microsoft. */
  connectMailbox(provider: 'Gmail' | 'Graph'): void {
    if (this._connectBusy()) {
      return;
    }
    this._connectBusy.set(provider);
    this._connectError.set(null);
    this.service.initiateOAuthConnect(provider).subscribe({
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

  /** Limpia el error del alta manual (al cerrar/reabrir el formulario). */
  clearManualError(): void {
    this._manualError.set(null);
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

  selectCustomer(customerId: string): void {
    if (customerId === this._selectedCustomerId()) {
      return;
    }
    this._selectedCustomerId.set(customerId);
    this.clearThreadSelection();
    this.closeComposeSilently();
    this._activeFolderId.set('conversations');
    // Sent/Trash son de otro cliente ahora: se vacían para recargarse perezoso.
    this._sent.set([]);
    this._trash.set([]);
    this.loadThreads(true);
    this.loadDrafts(true);
  }

  selectFolder(folderId: MailFolderId): void {
    this._activeFolderId.set(folderId);
    this.clearThreadSelection();
    this.closeComposeSilently();
    // Carga perezosa al entrar (una vez); las demás ya vienen del boot.
    if (folderId === 'sent' && this._sent().length === 0 && !this._sentLoading()) {
      this.loadSent(true);
    }
    if (folderId === 'trash' && this._trash().length === 0 && !this._trashLoading()) {
      this.loadTrash(true);
    }
  }

  // ---------- Hilos ----------

  loadThreads(reset: boolean): void {
    const customerId = this._selectedCustomerId();
    if (!customerId) {
      return;
    }
    const page = reset ? 1 : this._threadsPage() + 1;
    this._threadsLoading.set(true);
    this._threadsError.set(null);
    if (reset) {
      this._threads.set([]);
    }
    this.service.listThreads(customerId, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._threads.update(list => (reset ? result.items : [...list, ...result.items]));
        this._threadsPage.set(result.page);
        this._threadsHasMore.set(result.hasMore);
        this._threadsLoading.set(false);
      },
      error: err => {
        this._threadsError.set(toApiError(err).message);
        this._threadsLoading.set(false);
      },
    });
  }

  // ---------- Drafts ----------

  loadDrafts(reset: boolean): void {
    const customerId = this._selectedCustomerId();
    if (!customerId) {
      return;
    }
    const page = reset ? 1 : this._draftsPage() + 1;
    this._draftsLoading.set(true);
    this._draftsError.set(null);
    if (reset) {
      this._drafts.set([]);
    }
    this.service.listDrafts(customerId, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._drafts.update(list => (reset ? result.items : [...list, ...result.items]));
        this._draftsPage.set(result.page);
        this._draftsHasMore.set(result.hasMore);
        this._draftsTotal.set(result.totalCount);
        this._draftsLoading.set(false);
      },
      error: err => {
        this._draftsError.set(toApiError(err).message);
        this._draftsLoading.set(false);
      },
    });
  }

  // ---------- Enviados (Sent) ----------

  loadSent(reset: boolean): void {
    const customerId = this._selectedCustomerId();
    if (!customerId) {
      return;
    }
    const page = reset ? 1 : this._sentPage() + 1;
    this._sentLoading.set(true);
    this._sentError.set(null);
    if (reset) {
      this._sent.set([]);
    }
    this.service.listSent(customerId, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._sent.update(list => (reset ? result.items : [...list, ...result.items]));
        this._sentPage.set(result.page);
        this._sentHasMore.set(result.hasMore);
        this._sentLoading.set(false);
      },
      error: err => {
        this._sentError.set(toApiError(err).message);
        this._sentLoading.set(false);
      },
    });
  }

  // ---------- Papelera ----------

  loadTrash(reset: boolean): void {
    const customerId = this._selectedCustomerId();
    if (!customerId) {
      return;
    }
    const page = reset ? 1 : this._trashPage() + 1;
    this._trashLoading.set(true);
    this._trashError.set(null);
    if (reset) {
      this._trash.set([]);
    }
    this.service.listTrash(customerId, page, LIST_PAGE_SIZE).subscribe({
      next: result => {
        this._trash.update(list => (reset ? result.items : [...list, ...result.items]));
        this._trashPage.set(result.page);
        this._trashHasMore.set(result.hasMore);
        this._trashLoading.set(false);
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

  /** Manda un mensaje (abierto en el reading-pane) a la papelera. */
  trashOpenMessage(messageId: string): void {
    const message = this._messages().find(m => m.messageId === messageId);
    if (!message) {
      return;
    }
    const threadId = this._selectedThreadId();
    const req$ = message.direction === 'Outbound' ? this.service.trashSent(messageId) : this.service.trashMessage(messageId);
    req$.subscribe({
      next: () => {
        this._messages.update(list => list.filter(m => m.messageId !== messageId));
        if (this._messages().length === 0) {
          // Hilo sin mensajes visibles: sacarlo de la lista y cerrar.
          this._threads.update(list => list.filter(t => t.threadId !== threadId));
          this.clearThreadSelection();
        } else if (message.direction === 'Inbound') {
          // Reflejar el conteo del hilo abierto sin recargar la lista (evita el flicker).
          this._threads.update(list =>
            list.map(t => (t.threadId === threadId ? { ...t, messageCount: Math.max(0, t.messageCount - 1) } : t)),
          );
        }
        this._sent.set([]);
      },
      error: err => this._messagesError.set(toApiError(err).message),
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
    this.loadMessages(true);
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
        this._messages.update(list => (reset ? result.items : [...list, ...result.items]));
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
   * Al final se abre la URL presignada en otra pestaña.
   */
  downloadAttachment(messageId: string, attachmentId: string): void {
    const view = this._attachments().get(messageId);
    const item = view?.items.find(att => att.attachmentId === attachmentId);
    if (!view || !item || item.busy) {
      return;
    }
    this.patchAttachment(messageId, attachmentId, { busy: true, error: null });

    // Saliente: el binario ya está en CloudStorage (attachmentId == fileId) — URL presignada directa,
    // sin el flujo de descarga bajo demanda de los entrantes.
    const message = this._messages().find(m => m.messageId === messageId);
    if (message?.direction === 'Outbound') {
      this.uploads.getDownloadUrl(attachmentId).subscribe({
        next: result => {
          this.patchAttachment(messageId, attachmentId, { busy: false });
          this.triggerDownload(result.downloadUrl);
        },
        error: err => {
          this.patchAttachment(messageId, attachmentId, { busy: false, error: toApiError(err).message });
        },
      });
      return;
    }

    const url$ =
      item.downloadStatus === 'Downloaded'
        ? this.service.getAttachmentDownloadUrl(messageId, attachmentId)
        : this.service
            .requestAttachmentDownload(messageId, attachmentId)
            .pipe(concatMap(() => this.waitForDownloadUrl(messageId, attachmentId)));
    url$.subscribe({
      next: result => {
        this.patchAttachment(messageId, attachmentId, { busy: false, downloadStatus: 'Downloaded' });
        this.triggerDownload(result.downloadUrl);
      },
      error: err => {
        const apiError = toApiError(err);
        // El escaneo lo bloqueó: reflejar el estado, sin mensaje de error genérico.
        if (apiError.code === 'IncomingEmailAttachment.Blocked') {
          this.patchAttachment(messageId, attachmentId, { busy: false, downloadStatus: 'Blocked', error: null });
          return;
        }
        this.patchAttachment(messageId, attachmentId, { busy: false, error: apiError.message });
      },
    });
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
    if (!threadId || this._archiving()) {
      return;
    }
    this._archiving.set(true);
    this.service.archiveThread(threadId).subscribe({
      next: () => {
        this._archiving.set(false);
        // Archivar marca leído en el backend: reflejar unreadCount 0 local.
        this._threads.update(list =>
          list.map(thread =>
            thread.threadId === threadId ? { ...thread, status: 'Archived', unreadCount: 0 } : thread,
          ),
        );
        this.clearThreadSelection();
      },
      error: err => {
        this._archiving.set(false);
        this._messagesError.set(toApiError(err).message);
      },
    });
  }

  /** Desarchiva el hilo abierto (Archived → Active). */
  unarchiveSelectedThread(): void {
    const threadId = this._selectedThreadId();
    if (!threadId || this._archiving()) {
      return;
    }
    this._archiving.set(true);
    this.service.unarchiveThread(threadId).subscribe({
      next: () => {
        this._archiving.set(false);
        this._threads.update(list =>
          list.map(thread => (thread.threadId === threadId ? { ...thread, status: 'Active' } : thread)),
        );
        this.clearThreadSelection();
      },
      error: err => {
        this._archiving.set(false);
        this._messagesError.set(toApiError(err).message);
      },
    });
  }

  // ---------- Leído / no leído ----------

  /**
   * Marca UN mensaje inbound como leído/no-leído. Optimista: refleja local de inmediato (el
   * contador de no-leídos del hilo baja/sube al toque) y revierte si el backend falla.
   */
  setMessageRead(messageId: string, isRead: boolean): void {
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
    const previousMessages = this._messages();
    const previousThreads = this._threads();
    this._messages.update(list =>
      list.map(item => (item.direction === 'Inbound' ? { ...item, isRead } : item)),
    );
    this._threads.update(list =>
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
        this._threads.set(previousThreads);
        this._messagesError.set(toApiError(err).message);
      },
    });
  }

  /** No-leídos totales del cliente activo (para el badge de la carpeta Conversations). */
  readonly unreadTotal = computed(() =>
    this._threads()
      .filter(thread => thread.status === 'Active')
      .reduce((sum, thread) => sum + thread.unreadCount, 0),
  );

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
      this._threads.update(list =>
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

  openCompose(): void {
    this._reply.set(null);
    this._compose.set({ ...EMPTY_COMPOSE, open: true });
  }

  /** Retoma un draft existente desde la carpeta Drafts (GET /drafts/{id} para prellenar). */
  openDraft(draftId: string): void {
    this._reply.set(null);
    this._compose.set({ ...EMPTY_COMPOSE, open: true, loadingDraft: true });
    this.service.getDraft(draftId).subscribe({
      next: draft => {
        this._compose.update(state => (state.open ? { ...state, draft, loadingDraft: false } : state));
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
    this._compose.update(current => ({ ...current, sending: true, error: null }));

    const draftId$: Observable<string> = state.draft
      ? of(state.draft.draftId)
      : this.service.createDraft(payload.customerId, payload.accountId).pipe(map(result => result.draftId));

    draftId$
      .pipe(
        concatMap(draftId =>
          this.service
            .autoSaveDraft(draftId, {
              subject: payload.subject.trim(),
              htmlBody: plainTextToHtml(payload.body),
              textBody: payload.body,
              to: parseRecipients(payload.to),
              cc: parseRecipients(payload.cc),
            })
            .pipe(map(() => draftId)),
        ),
        concatMap(draftId => this.removeAttachmentsChain(draftId, payload.removedFileIds)),
        concatMap(draftId => this.uploadAndAttachChain(draftId, payload)),
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

  private uploadAndAttachChain(draftId: string, payload: ComposeSendPayload): Observable<string> {
    let chain: Observable<unknown> = of(null);
    for (const file of payload.files) {
      chain = chain.pipe(
        concatMap(() => this.uploadToCloudStorage(payload.customerId, file)),
        concatMap(ref => this.service.attachFileToDraft(draftId, ref)),
      );
    }
    return chain.pipe(map(() => draftId));
  }

  /** Flujo presigned-POST de CloudStorage (mismo cliente core que documents/chat), bucket EmailOutgoing. */
  private uploadToCloudStorage(customerId: string, file: File): Observable<AttachFileToDraftRequest> {
    const contentType = file.type || 'application/octet-stream';
    return this.uploads
      .initiateUpload({
        originalName: file.name,
        contentType,
        sizeBytes: file.size,
        ownerType: 'Customer',
        ownerId: customerId,
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
