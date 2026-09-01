import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, concatMap, forkJoin, map, of, retry, throwError, timer } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { AuthService } from '@core/auth/auth.service';
import { MailService } from './mail.service';
import {
  AttachFileToDraftRequest,
  AttachmentSummary,
  ConnectManualAccountRequest,
  DraftDetail,
  DraftListItem,
  MailAccount,
  MailCustomerSummary,
  MessageSummary,
  ThreadSummary,
  isUsableAccount,
  parseRecipients,
  plainTextToHtml,
} from './mail.model';
import { ProviderDetection, detectProvider } from './mail-provider-detect.util';

/** Carpetas honestas: solo las que tienen respaldo real en Correspondence. */
export type MailFolderId = 'conversations' | 'archived' | 'drafts';

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
  readonly hasMailbox = computed(() => this.usableAccounts().length > 0);

  private readonly _activeAccountId = signal<string | null>(null);
  readonly activeAccountId = this._activeAccountId.asReadonly();
  readonly activeAccount = computed(
    () => this.usableAccounts().find(account => account.id === this._activeAccountId()) ?? null,
  );

  // ---------- Conectar buzón (OAuth full-page redirect) ----------

  private readonly _connectBusy = signal<'Gmail' | 'Graph' | null>(null);
  private readonly _connectError = signal<string | null>(null);
  private readonly _reauthBusyId = signal<string | null>(null);

  readonly connectBusy = this._connectBusy.asReadonly();
  readonly connectError = this._connectError.asReadonly();
  readonly reauthBusyId = this._reauthBusyId.asReadonly();

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
    () => this._threads().find(thread => thread.threadId === this._selectedThreadId()) ?? null,
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

  /** Carga inicial idempotente: cuentas de buzón + picker de clientes. */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.refreshBoot();
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

  /** Reintenta el watch de una cuenta en Error (POST /connectors/accounts/{id}/reauth). */
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

  // ---------- Selección ----------

  selectCustomer(customerId: string): void {
    if (customerId === this._selectedCustomerId()) {
      return;
    }
    this._selectedCustomerId.set(customerId);
    this.clearThreadSelection();
    this.closeComposeSilently();
    this._activeFolderId.set('conversations');
    this.loadThreads(true);
    this.loadDrafts(true);
  }

  selectFolder(folderId: MailFolderId): void {
    this._activeFolderId.set(folderId);
    this.clearThreadSelection();
    this.closeComposeSilently();
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

  /** "Load more" del listado central, según la carpeta activa. */
  loadMoreList(): void {
    if (this._activeFolderId() === 'drafts') {
      this.loadDrafts(false);
    } else {
      this.loadThreads(false);
    }
  }

  retryList(): void {
    if (this._activeFolderId() === 'drafts') {
      this.loadDrafts(true);
    } else {
      this.loadThreads(true);
    }
  }

  // ---------- Hilo seleccionado ----------

  selectThread(threadId: string): void {
    this.closeComposeSilently();
    if (threadId === this._selectedThreadId()) {
      return;
    }
    this._selectedThreadId.set(threadId);
    this.resetThreadDetail();
    this.loadMessages(true);
  }

  private clearThreadSelection(): void {
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
    if (!threadId) {
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
    const body$: Observable<{ html: string | null; text: string | null }> =
      message.direction === 'Inbound'
        ? this.service.getMessageBody(messageId).pipe(map(body => ({ html: body.htmlBody, text: body.textBody })))
        : this.service.getDraft(messageId).pipe(map(draft => ({ html: draft.htmlBody, text: draft.textBody })));
    body$.subscribe({
      next: body => {
        this.updateBody(messageId, { loading: false, error: null, html: body.html, text: body.text });
        // El backend marca BodyReady al servir el body: reflejarlo local (apaga el punto "nunca abierto").
        if (message.direction === 'Inbound' && message.bodyStatus === 'BodyPending') {
          this._messages.update(list =>
            list.map(item => (item.messageId === messageId ? { ...item, bodyStatus: 'BodyReady' } : item)),
          );
        }
      },
      error: err => {
        this.updateBody(messageId, { loading: false, error: toApiError(err).message, html: null, text: null });
      },
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
    const url$ =
      item.downloadStatus === 'Downloaded'
        ? this.service.getAttachmentDownloadUrl(messageId, attachmentId)
        : this.service
            .requestAttachmentDownload(messageId, attachmentId)
            .pipe(concatMap(() => this.waitForDownloadUrl(messageId, attachmentId)));
    url$.subscribe({
      next: result => {
        this.patchAttachment(messageId, attachmentId, { busy: false, downloadStatus: 'Downloaded' });
        window.open(result.downloadUrl, '_blank', 'noopener');
      },
      error: err => {
        this.patchAttachment(messageId, attachmentId, { busy: false, error: toApiError(err).message });
      },
    });
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
        this._threads.update(list =>
          list.map(thread => (thread.threadId === threadId ? { ...thread, status: 'Archived' } : thread)),
        );
        this.clearThreadSelection();
      },
      error: err => {
        this._archiving.set(false);
        this._messagesError.set(toApiError(err).message);
      },
    });
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
   * Cadena real de envío: (create draft si es nuevo) → quitar adjuntos removidos → subir cada
   * archivo a CloudStorage (initiate → POST presignado → complete) y referenciarlo en el draft →
   * autosave (subject/body/to/cc) → send síncrono vía Postmaster. Si algo falla, el draft queda
   * autoguardado en la carpeta Drafts y el error se muestra en el composer.
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
        concatMap(draftId => this.removeAttachmentsChain(draftId, payload.removedFileIds)),
        concatMap(draftId => this.uploadAndAttachChain(draftId, payload)),
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
        taxYear: null,
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
