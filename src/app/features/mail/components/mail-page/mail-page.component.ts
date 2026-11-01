import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MailFolder, MailFolderListComponent } from '../../ui/mail-folder-list/mail-folder-list.component';
import { MailListComponent, MailListRow, MailRowTag } from '../../ui/mail-list/mail-list.component';
import { MailReadingPaneComponent } from '../../ui/mail-reading-pane/mail-reading-pane.component';
import { ComposeDraftPayload, MailComposeComponent } from '../../ui/mail-compose/mail-compose.component';
import { MailConnectManualComponent } from '../../ui/mail-connect-manual/mail-connect-manual.component';
import { MailFolderId, MailStore, OUTGOING_FOLDERS } from '../../data-access/mail.store';
import {
  ConnectManualAccountRequest,
  MailAccount,
  MailAccountStatus,
  formatMailTime,
} from '../../data-access/mail.model';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { ComposeMailDeepLink, hasComposeMailParams, parseComposeMailDeepLink } from '../../utils/compose-deep-link';
import { CorrespondenceCapabilities } from '../../data-access/correspondence-permissions';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerDownload, FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { MAIL_SHORTCUTS, MailShortcut, shortcutFor } from '../../utils/mail-shortcuts';

interface NotificationMailDeepLink {
  accountId: string | null;
  customerId: string;
  threadId: string;
  messageId: string | null;
}

/** Filtro de Sent/Drafts/Trash en /email: todo, o solo lo mandado a quien no es cliente. */
type OutgoingFilter = 'all' | 'unlinked';

/**
 * Página del módulo Mail conectada a los dos servicios reales del Gateway:
 * - Connectors.Api (`/connectors`): cuentas de buzón externas del tenant. SIN una
 *   cuenta utilizable no hay correo, así que la página muestra el flujo de
 *   "conectar buzón" (OAuth Gmail/Microsoft) en vez de una bandeja falsa.
 * - Correspondence.Api (`/correspondence`): el Inbox de la oficina con los hilos de
 *   todos los clientes que el usuario puede ver; cada fila dice de qué cliente es.
 *   El cliente es un filtro opcional del rail, no un paso previo obligatorio.
 *
 * Layout de 3 paneles (rail | listado | lectura) con las carpetas que el backend
 * respalda: Inbox, Sent, Archived, Trash y Drafts. Toda la lógica (paginación,
 * cuerpos en vivo, adjuntos bajo demanda, reply y compose) vive en MailStore;
 * este componente sólo traduce estado a la UI y despacha intenciones.
 *
 * Modo embebido (`injectEmbeddedCustomer()`): lo monta `ClientMailWorkspaceComponent` en el perfil
 * del cliente. Cliente fijo (sin picker), sin consumir query params (OAuth / deep link) y sin el
 * gestor de buzones: si no hay buzón se enlaza a /email y los hilos se ven en solo lectura.
 */
@Component({
  selector: 'app-mail-page',
  imports: [InfinityLoaderComponent, 
    CommonModule,
    MailFolderListComponent,
    MailListComponent,
    MailReadingPaneComponent,
    MailComposeComponent,
    MailConnectManualComponent,
    CustomerPickerComponent,
    SegmentedComponent,
    FileViewerComponent,
    ModalComponent,
    RouterLink,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-page.component.html',
  styleUrl: './mail-page.component.css',
})
export class MailPageComponent implements OnInit, OnDestroy {
  /** B6 — "Delete forever" se ofrecía a todos; es `correspondence.manage`. */
  protected readonly can = inject(CorrespondenceCapabilities);

  readonly store = inject(MailStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly directory = inject(CustomerDirectoryStore);
  private readonly toast = inject(ToastService);

  /** Cliente fijado por el perfil; `null` en /email. */
  private readonly embeddedCustomer = injectEmbeddedCustomer();
  readonly embedded = computed(() => this.embeddedCustomer() !== null);

  /**
   * Deep link `/email?compose=1&customerId=&to=` en espera: el composer se abre cuando el cliente
   * ya es el activo y hay una cuenta de buzón utilizable (el boot de cuentas es asíncrono).
   */
  private readonly pendingCompose = signal<ComposeMailDeepLink | null>(null);
  private readonly composeDeepLinkEffect = effect(() => {
    const pending = this.pendingCompose();
    if (!pending || !this.store.activeAccountId() || this.store.selectedCustomerId() !== pending.customerId) {
      return;
    }
    untracked(() => {
      this.pendingCompose.set(null);
      this.selectedDraftId.set(null);
      this.store.openCompose(pending.to);
    });
  });

  private readonly pendingNotificationLink = signal<NotificationMailDeepLink | null>(null);
  private readonly notificationDeepLinkEffect = effect(() => {
    const pending = this.pendingNotificationLink();
    if (!pending) {
      return;
    }

    if (pending.accountId && this.store.activeAccountId() !== pending.accountId) {
      if (!this.store.usableAccounts().some(account => account.id === pending.accountId)) {
        return;
      }
      untracked(() => this.store.setActiveAccount(pending.accountId!));
      return;
    }
    if (this.store.selectedCustomerId() !== pending.customerId || this.store.threadsLoading()) {
      return;
    }
    if (!this.store.threads().some(thread => thread.threadId === pending.threadId)) {
      return;
    }
    if (this.store.selectedThreadId() !== pending.threadId) {
      untracked(() => this.store.selectThread(pending.threadId));
      return;
    }
    if (pending.messageId) {
      if (this.store.messagesLoading() || !this.store.openMessage(pending.messageId)) {
        return;
      }
    }

    untracked(() => {
      this.pendingNotificationLink.set(null);
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { accountId: null, customerId: null, threadId: null, messageId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  });

  /** Draft resaltado en el listado mientras el composer lo carga (GET /drafts/{id} es async). */
  readonly selectedDraftId = signal<string | null>(null);

  /** Enviado resaltado en la carpeta Sent (un reply abre el hilo real, cuyo id != messageId). */
  readonly selectedSentId = signal<string | null>(null);

  /**
   * Resultado del callback OAuth de Connectors. El backend no vuelve a una ruta propia:
   * redirige a la raíz del portal con `?connectors_connected=true` (o `connectors_error`),
   * y `app.routes.ts` desvía esa raíz hasta acá conservando los query params.
   */
  readonly connectResult = signal<{ ok: boolean; text: string } | null>(null);

  /**
   * Buzón recién conectado (manual o vuelta del OAuth): muestra la pantalla final "You're all set" en vez
   * de saltar al Inbox sin decir nada. Se identifica por id (callback OAuth) o por email (alta manual).
   */
  readonly connectedNotice = signal<{ accountId: string | null; email: string | null } | null>(null);
  readonly connectedAccount = computed(() => {
    const notice = this.connectedNotice();
    if (!notice) {
      return null;
    }
    const email = notice.email?.trim().toLowerCase();
    return (
      this.store
        .accounts()
        .find(account => account.id === notice.accountId || (!!email && account.emailAddress.toLowerCase() === email)) ??
      null
    );
  });

  /** "Go to Inbox" de la pantalla final. */
  goToInbox(): void {
    this.connectedNotice.set(null);
    this.showMailboxManager.set(false);
  }

  ngOnInit(): void {
    // Idempotente: cuentas de buzón + clientes + realtime; si ya hay ambos, dispara hilos y drafts.
    this.store.init();
  }

  /**
   * Reactivo: si el usuario ya esta en /email y abre otra notificacion de correo, los
   * queryParams cambian pero ngOnInit no vuelve a disparar; los efectos siguen a la URL.
   * Cada handler limpia los params que consume para no reactivar el mismo deep link.
   */
  private readonly routeParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  private consumedNotificationLink: string | null = null;
  private consumedComposeLink: string | null = null;
  private consumedOAuthCallback: string | null = null;

  private readonly notificationLinkEffect = effect(() => {
    if (this.embedded()) return;
    const params = this.routeParams();
    const customerId = params.get('customerId');
    const threadId = params.get('threadId');
    if (!customerId || !threadId) return;
    const key = `${customerId}|${threadId}|${params.get('messageId') ?? ''}|${params.get('accountId') ?? ''}`;
    if (this.consumedNotificationLink === key) return;
    this.consumedNotificationLink = key;
    untracked(() => {
      const pending: NotificationMailDeepLink = {
        accountId: params.get('accountId'),
        customerId,
        threadId,
        messageId: params.get('messageId'),
      };
      this.directory.byId([customerId]).subscribe({
        next: found => {
          const customer = found.get(customerId);
          if (!customer) {
            this.toast.info('This client is no longer available.');
            return;
          }
          this.directory.addRecent(customer);
          this.pickCustomer(customer);
          this.pendingNotificationLink.set(pending);
        },
        error: () => this.toast.error('We could not open this email conversation.'),
      });
    });
  });

  /**
   * `/email?compose=1&customerId=<id>&to=<email>` (acción "Send email" del perfil del cliente):
   * elige ese cliente (leído del directorio) y abre el composer con el destinatario precargado.
   * Limpia la URL. Solo con permiso de redactar (`correspondence.compose`).
   */
  private readonly composeLinkEffect = effect(() => {
    if (this.embedded()) return;
    const params = this.routeParams();
    if (!hasComposeMailParams(params)) return;
    const link = parseComposeMailDeepLink(params);
    const key = `${params.get('compose') ?? ''}|${params.get('customerId') ?? ''}|${params.get('to') ?? ''}`;
    if (this.consumedComposeLink === key) return;
    this.consumedComposeLink = key;
    untracked(() => {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      if (!link || !this.can.canCompose()) return;
      this.directory.byId([link.customerId]).subscribe({
        next: found => {
          const customer = found.get(link.customerId);
          if (!customer) return;
          this.directory.addRecent(customer);
          this.pickCustomer(customer);
          this.pendingCompose.set(link);
        },
        error: () => undefined,
      });
    });
  });

  ngOnDestroy(): void {
    this.pendingCompose.set(null);
    this.pendingNotificationLink.set(null);
    // Cierra el socket realtime de correo entrante al salir del módulo.
    this.store.teardown();
  }

  dismissConnectResult(): void {
    this.connectResult.set(null);
  }

  /** Traduce el slug de error del callback (query `connectors_error`) a un mensaje claro en inglés. */
  private mailboxErrorMessage(code: string | null): string {
    switch (code) {
      case 'identity_mismatch':
        return 'You can only connect your own mailbox. Sign in to the provider with the same email you use here, then try again.';
      case 'identity_unknown':
        return "We couldn't verify your account email. Please sign in again and retry.";
      case 'already_connected':
        return 'This mailbox is already connected. Disconnect it first to reconnect.';
      case 'consent_incomplete':
        return 'The provider did not grant offline access. Try again and approve all the requested permissions.';
      case 'invalid_state':
        return 'The connection link expired. Please start the connection again.';
      default:
        return 'Could not connect the mailbox. Please try again.';
    }
  }

  /**
   * Lee el resultado del callback una sola vez y limpia la URL (los params traen el
   * `accountId` recién conectado y no deben quedar en el historial). Tras un connect
   * exitoso se re-listan las cuentas para que la bandeja aparezca sin recargar.
   */
  private readonly oauthCallbackEffect = effect(() => {
    if (this.embedded()) return;
    const params = this.routeParams();
    const connected = params.get('connectors_connected');
    const error = params.get('connectors_error');
    const adminConsent = params.get('connectors_admin_consent');
    if (!connected && !error && !adminConsent) return;
    const key = `${connected ?? ''}|${error ?? ''}|${adminConsent ?? ''}`;
    if (this.consumedOAuthCallback === key) return;
    this.consumedOAuthCallback = key;
    untracked(() => {
      if (connected === 'true') {
        this.connectedNotice.set({ accountId: params.get('accountId'), email: null });
        this.store.reloadAccounts();
      } else if (adminConsent) {
        this.connectResult.set(
          adminConsent === 'true'
            ? { ok: true, text: 'Admin consent granted — you can connect the mailbox now.' }
            : { ok: false, text: 'Admin consent was denied.' },
        );
      } else {
        this.connectResult.set({ ok: false, text: this.mailboxErrorMessage(error) });
      }
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    });
  });

  // ---------- Carpetas (sólo las que el backend respalda) ----------

  readonly folders = computed<MailFolder[]>(() => [
    {
      id: 'inbox',
      // El badge cuenta conversaciones CON no-leídos (baja al abrir/marcar leído, desaparece en 0),
      // no el total de hilos — así refleja "cuántas te faltan por leer", estilo cliente de correo.
      label: 'Inbox',
      icon: 'file-tray-outline',
      count: this.store.inboxUnread(),
      countLabel: 'unread',
    },
    {
      // Enviados del cliente. Sin badge: no hay "no-leídos" en lo que uno mismo envió.
      id: 'sent',
      label: 'Sent',
      icon: 'paper-plane-outline',
      count: 0,
    },
    {
      // Sin badge: lo cargado es solo la primera página del Inbox, un total sería inventado.
      id: 'archived',
      label: 'Archived',
      icon: 'archive-outline',
      count: 0,
    },
    {
      id: 'trash',
      label: 'Trash',
      icon: 'trash-outline',
      count: 0,
    },
    {
      // Drafts sí trae totalCount del servidor; los hilos se cuentan sobre lo cargado.
      id: 'drafts',
      label: 'Drafts',
      icon: 'document-text-outline',
      count: this.store.draftsTotal(),
      countLabel: 'drafts',
    },
  ]);

  // ---------- Listado central ----------

  readonly rows = computed<MailListRow[]>(() => {
    if (this.store.activeFolderId() === 'drafts') {
      return this.store.drafts().map(draft => ({
        id: draft.draftId,
        avatarName: draft.subject || 'Draft',
        avatarColor: avatarColorFor(draft.subject || draft.draftId),
        title: draft.subject || '(No subject)',
        subtitle: draft.isReply ? 'Reply draft' : 'New message',
        time: formatMailTime(draft.updatedAtUtc),
        // El estado sólo se muestra cuando NO es el normal (Sending/Failed/Sent).
        badge: draft.status === 'Draft' ? null : draft.status,
        unreadCount: 0,
        tag: this.clientTag(draft.customerId),
      }));
    }

    if (this.store.activeFolderId() === 'trash') {
      return this.store.trash().map(item => ({
        id: item.messageId,
        avatarName: item.counterparty || item.subject || 'Trash',
        avatarColor: avatarColorFor(item.counterparty || item.messageId),
        title: `${item.kind === 'Sent' ? 'To' : 'From'} ${item.counterparty}`,
        subtitle: item.subject || '(No subject)',
        time: formatMailTime(item.deletedAtUtc),
        badge: item.kind,
        unreadCount: 0,
        attachmentCount: item.hasAttachments ? item.attachmentCount : 0,
        tag: this.clientTag(item.customerId),
      }));
    }

    if (this.store.activeFolderId() === 'sent') {
      return this.store.sent().map(item => ({
        id: item.messageId,
        avatarName: item.toAddresses[0] || item.subject || 'Sent',
        avatarColor: avatarColorFor(item.toAddresses[0] || item.messageId),
        // Destinatario primero, como en un cliente de correo; el clip lo pinta la lista con attachmentCount.
        title: item.toAddresses.length > 0 ? `To ${item.toAddresses.join(', ')}` : 'Sent message',
        subtitle: item.subject || '(No subject)',
        time: formatMailTime(item.sentAtUtc),
        badge: item.isReply ? 'Reply' : null,
        unreadCount: 0,
        attachmentCount: item.hasAttachments ? item.attachmentCount : 0,
        tag: this.clientTag(item.customerId),
      }));
    }

    const threads =
      this.store.activeFolderId() === 'archived' ? this.store.archivedThreads() : this.store.activeThreads();
    const index = this.store.customerIndex();

    return threads.map(thread => {
      const client = thread.customerId ? index.get(thread.customerId) : undefined;
      // Quién escribió por última vez; un hilo de solo enviados cae al nombre del cliente.
      const sender = thread.lastSenderName || thread.lastSenderAddress || client?.displayName || null;
      const subject = thread.subject || '(No subject)';
      return {
        id: thread.threadId,
        avatarName: sender || subject,
        avatarColor: avatarColorFor(thread.lastSenderAddress || thread.customerId || thread.threadId),
        title: sender ? (thread.messageCount > 1 ? `${sender} (${thread.messageCount})` : sender) : subject,
        subtitle: sender ? subject : `${thread.messageCount} ${thread.messageCount === 1 ? 'message' : 'messages'}`,
        preview: thread.snippet ?? null,
        time: formatMailTime(thread.lastMessageAtUtc),
        badge: null,
        unreadCount: thread.unreadCount,
        hasAttachments: thread.hasAttachments ?? false,
        tag: this.clientTag(thread.customerId),
      };
    });
  });

  /**
   * Etiqueta de cliente de una fila: su nombre, o "Not a client". Con un filtro activo (o en el perfil)
   * todas las filas son del mismo lado y la etiqueta no aporta nada.
   */
  private clientTag(customerId: string | null | undefined): MailRowTag | null {
    if (this.embedded() || this.store.selectedCustomerId() || this.store.unlinkedView()) {
      return null;
    }
    if (!customerId) {
      return { label: 'Not a client', muted: true };
    }
    return { label: this.store.customerIndex().get(customerId)?.displayName ?? 'Client', muted: false };
  }

  readonly listLoading = computed(() => {
    switch (this.store.activeFolderId()) {
      case 'drafts':
        return this.store.draftsLoading();
      case 'sent':
        return this.store.sentLoading();
      case 'trash':
        return this.store.trashLoading();
      default:
        return this.store.threadsLoading();
    }
  });

  readonly listError = computed(() => {
    switch (this.store.activeFolderId()) {
      case 'drafts':
        return this.store.draftsError();
      case 'sent':
        return this.store.sentError();
      case 'trash':
        return this.store.trashError();
      default:
        return this.store.threadsError();
    }
  });

  readonly listHasMore = computed(() => {
    switch (this.store.activeFolderId()) {
      case 'drafts':
        return this.store.draftsHasMore();
      case 'sent':
        return this.store.sentHasMore();
      case 'trash':
        return this.store.trashHasMore();
      default:
        return this.store.threadsHasMore();
    }
  });

  readonly selectedRowId = computed(() => {
    switch (this.store.activeFolderId()) {
      case 'drafts':
        return this.selectedDraftId();
      case 'sent':
        return this.selectedSentId();
      default:
        return this.store.selectedThreadId();
    }
  });

  /** Inbox y Archived buscan en el servidor; Sent/Drafts/Trash filtran lo cargado. */
  readonly threadFolder = computed(() => !OUTGOING_FOLDERS.has(this.store.activeFolderId()));

  /** Estados vacíos honestos: dicen qué falta según carpeta y filtro, sin inventar un siguiente paso. */
  readonly listEmptyText = computed(() => {
    const folder = this.store.activeFolderId();
    const search = this.store.threadSearch();
    if (search && this.threadFolder()) {
      return `No conversations match "${search}"`;
    }
    if (folder === 'trash') {
      return 'Trash is empty';
    }
    if (this.store.unlinkedView()) {
      return folder === 'drafts'
        ? "No drafts to people who aren't clients"
        : "No messages sent to people who aren't clients yet";
    }
    // Perfil o filtro de cliente: el texto habla de ese cliente.
    if (this.embedded() || this.store.selectedCustomerId()) {
      switch (folder) {
        case 'drafts':
          return 'No drafts for this client';
        case 'sent':
          return 'No sent messages for this client yet';
        case 'archived':
          return 'No archived conversations for this client';
        default:
          return 'No conversations with this client yet';
      }
    }
    switch (folder) {
      case 'drafts':
        return 'No drafts';
      case 'sent':
        return 'Nothing sent yet';
      case 'archived':
        return 'No archived conversations';
      default:
        return "You're all caught up — new client mail lands here";
    }
  });

  /**
   * Cliente en cuya ficha se archiva lo que se está redactando (null = ninguno). Sale del composer, no
   * del rail: es el que quedó fijado al abrirlo o el elegido como destinatario.
   */
  readonly composeCustomerName = computed(() => {
    const customerId = this.store.compose().customerId;
    if (!customerId) {
      return null;
    }
    return this.store.customerIndex().get(customerId)?.displayName || 'this client';
  });

  /** Cliente del hilo abierto (sale del índice de nombres: el Inbox mezcla clientes). */
  readonly threadCustomer = computed(() => {
    const customerId = this.store.selectedThread()?.customerId;
    if (!customerId) {
      return null;
    }
    const selected = this.store.selectedCustomer();
    return this.store.customerIndex().get(customerId) ?? (selected?.id === customerId ? selected : null);
  });

  // ---------- Filtro "Not a client" (solo Sent/Drafts/Trash) ----------

  readonly outgoingFilterOptions: readonly SegmentedOption<OutgoingFilter>[] = [
    { id: 'all', label: 'Everyone' },
    { id: 'unlinked', label: 'Not a client' },
  ];

  readonly outgoingFilter = computed<OutgoingFilter>(() => (this.store.unlinkedView() ? 'unlinked' : 'all'));

  /** El filtro existe donde hay correo a quien no es cliente: lo que uno manda o redacta. */
  readonly showOutgoingFilter = computed(
    () => !this.embedded() && OUTGOING_FOLDERS.has(this.store.activeFolderId()),
  );

  setOutgoingFilter(filter: OutgoingFilter): void {
    this.selectedDraftId.set(null);
    this.selectedSentId.set(null);
    if (filter === 'unlinked') {
      this.store.showUnlinkedMail();
    } else {
      this.store.showAllMail();
    }
  }

  // ---------- Filtro de cliente ----------
  // Opcional: sin cliente, el Inbox es el de toda la oficina. Lo resuelve `app-customer-picker`
  // (búsqueda server-side, recientes compartidos del CustomerDirectoryStore y teclado).

  /** `null` = el usuario quitó el cliente (la X del chip): vuelve al correo de todos los clientes. */
  onCustomerChange(customer: CustomerSummary | null): void {
    if (customer) {
      this.pickCustomer(customer);
      return;
    }
    this.selectedDraftId.set(null);
    this.selectedSentId.set(null);
    this.store.clearCustomer();
  }

  /** Cambiar de cliente cambia el listado entero: las filas resaltadas del anterior ya no aplican. */
  pickCustomer(customer: CustomerSummary): void {
    this.selectedDraftId.set(null);
    this.selectedSentId.set(null);
    this.store.pickCustomer(customer);
  }

  /** Sugerencias para el destinatario que se está tecleando en el composer (To/Cc). */
  searchRecipients(term: string): void {
    this.store.searchRecipients(term);
  }

  /**
   * Redactar exige un buzón utilizable. Dónde se archiva lo decide el composer: el cliente filtrado, el
   * elegido como destinatario o ninguno.
   */
  readonly canCompose = computed(() => !!this.store.activeAccountId());

  // ---------- Cuentas de buzón ----------

  selectAccount(accountId: string): void {
    this.store.setActiveAccount(accountId);
  }

  /** Picker del buzón activo (reemplaza el <select> nativo): dropdown con avatar + chip Office/My email. */
  readonly mailboxPickerOpen = signal(false);

  toggleMailboxPicker(): void {
    this.mailboxPickerOpen.update(open => !open);
  }

  /** Cierra con delay para que el click en una opción se registre antes del blur. */
  closeMailboxPickerSoon(): void {
    setTimeout(() => this.mailboxPickerOpen.set(false), 150);
  }

  pickMailbox(accountId: string): void {
    this.store.setActiveAccount(accountId);
    this.mailboxPickerOpen.set(false);
  }

  /** Muestra/oculta el formulario de alta manual IMAP/SMTP en la pantalla de conexión. */
  readonly showManualForm = signal(false);

  // ---------- Office vs Personal: qué buzón conectar ----------

  /**
   * La vía de conexión la decide el PERMISO, no una preferencia: admin (write) conecta el buzón de
   * OFICINA (compartido, uno solo); empleado (connect_own) conecta su PERSONAL (== su login, uno
   * solo). Son mutuamente excluyentes — un mismo usuario nunca ve ambas — así que no hay selector.
   */
  readonly connectingOffice = computed(() => this.store.canManageOffice());

  /** ¿Puede conectar el buzón de oficina ahora? Admin (write) y aún no hay oficina conectada. */
  readonly canConnectOffice = computed(() => this.store.canManageOffice() && !this.store.officeAccount());
  /**
   * ¿Puede conectar su buzón personal ahora? Empleado con connect_own (NO admin: el admin gestiona la
   * oficina, no un personal propio) y sin personal propio conectado.
   */
  readonly canConnectPersonal = computed(
    () => !this.store.canManageOffice() && this.store.canConnectOwn() && !this.store.myMailboxConnected(),
  );
  /** No queda nada por conectar (ya está el de su ámbito, o no tiene permiso para ninguna vía). */
  readonly nothingToConnect = computed(() => !this.canConnectOffice() && !this.canConnectPersonal());
  /** El usuario no puede conectar ningún buzón por falta de permisos (para el empty-state honesto). */
  readonly noConnectPermission = computed(() => !this.store.canManageOffice() && !this.store.canConnectOwn());

  /**
   * Qué proveedores OAuth ofrecer. Oficina: ambos (Gmail y Microsoft 365) porque el admin elige el
   * del buzón compartido. Personal: solo el del dominio del email de login (el guard obliga a que el
   * buzón sea ese mismo email) — gmail.com → Gmail; outlook/hotmail → Microsoft; dominio propio
   * (Unknown) → ambos; yahoo/icloud/zoho (Imap) → ninguno OAuth, solo manual.
   */
  readonly showGmailOption = computed(() => {
    if (this.connectingOffice()) {
      return true;
    }
    const p = this.store.providerDetection().provider;
    return p === 'Gmail' || p === 'Unknown';
  });
  readonly showGraphOption = computed(() => {
    if (this.connectingOffice()) {
      return true;
    }
    const p = this.store.providerDetection().provider;
    return p === 'Graph' || p === 'Unknown';
  });
  readonly showOAuthOptions = computed(() => this.showGmailOption() || this.showGraphOption());

  /** Preset del formulario manual: personal usa el proveedor detectado del login; oficina lo elige el admin. */
  readonly manualPreset = computed(() =>
    this.connectingOffice() ? null : this.store.providerDetection().imapPreset,
  );

  connectMailbox(provider: 'Gmail' | 'Graph'): void {
    // El store redirige la pestaña completa al consentimiento del proveedor.
    this.store.connectMailbox(provider, this.connectingOffice());
  }

  /** Etiqueta de un buzón en la lista de gestión: Office (compartido) vs My email (personal). */
  mailboxKindLabel(account: MailAccount): string {
    return account.isOffice ? 'Office' : 'My email';
  }

  /** ¿El usuario puede administrar (reauth/desconectar) este buzón? (revoke UX). */
  canManageAccount(account: MailAccount): boolean {
    return this.store.canManageAccount(account);
  }

  toggleManualForm(): void {
    this.store.clearManualError();
    this.showManualForm.update(open => !open);
  }

  submitManualConnect(body: ConnectManualAccountRequest): void {
    this.store.connectManualAccount(body, () => {
      // Éxito: la cuenta ya existe; antes de la bandeja, la pantalla final dice qué quedó conectado.
      this.showManualForm.set(false);
      this.connectedNotice.set({ accountId: null, email: body.emailAddress });
    });
  }

  /** "Test connection" del alta manual: prueba IMAP y SMTP sin guardar nada. */
  testManualConnect(body: ConnectManualAccountRequest): void {
    this.store.testManualConnection(body);
  }

  reauthAccount(accountId: string): void {
    this.store.reauthAccount(accountId);
  }

  disconnectAccount(accountId: string): void {
    this.store.disconnectAccount(accountId);
  }

  reloadAccounts(): void {
    this.store.reloadAccounts();
  }

  /** El proveedor recomendado (tarjeta destacada): el detectado por el dominio del login; oficina no sugiere. */
  readonly recommendedProvider = computed<'Gmail' | 'Graph' | 'Other' | null>(() => {
    if (this.connectingOffice()) {
      return null;
    }
    const provider = this.store.providerDetection().provider;
    if (provider === 'Gmail' || provider === 'Graph') {
      return provider;
    }
    return provider === 'Imap' ? 'Other' : null;
  });

  /** Panel de gestión de buzones (reauth / desconectar / agregar) accesible desde la bandeja. */
  readonly showMailboxManager = signal(false);

  toggleMailboxManager(): void {
    this.store.clearManualError();
    this.showManualForm.set(false);
    this.showMailboxManager.update(open => !open);
  }

  /** Reauth sirve para cuentas con token pero sin watch activo (Draft/Connected/Error), no para Active/Disconnected. */
  canReauth(status: MailAccountStatus): boolean {
    return status === 'Draft' || status === 'Connected' || status === 'Error';
  }

  /** Se puede desconectar cualquier cuenta que no esté ya desconectada. */
  canDisconnect(status: MailAccountStatus): boolean {
    return status !== 'Disconnected';
  }

  retryBoot(): void {
    this.store.refreshBoot();
  }

  // ---------- Navegación del listado ----------

  selectFolder(folderId: string): void {
    this.selectedDraftId.set(null);
    this.selectedSentId.set(null);
    this.store.selectFolder(folderId as MailFolderId);
  }

  selectRow(id: string): void {
    // La papelera no abre lectura: cada fila tiene sus botones Restore / Delete.
    if (this.store.activeFolderId() === 'trash') {
      return;
    }
    if (this.store.activeFolderId() === 'drafts') {
      // Un draft no se "lee": se retoma en el composer (GET /drafts/{id}).
      this.selectedDraftId.set(id);
      this.selectedSentId.set(null);
      this.store.openDraft(id);
      return;
    }
    if (this.store.activeFolderId() === 'sent') {
      const item = this.store.sent().find(row => row.messageId === id);
      if (!item) {
        return;
      }
      this.selectedDraftId.set(null);
      this.selectedSentId.set(id);
      this.store.openSentMessage(item);
      return;
    }
    this.selectedDraftId.set(null);
    this.selectedSentId.set(null);
    this.store.selectThread(id);
  }

  retryList(): void {
    this.store.retryList();
  }

  loadMoreList(): void {
    this.store.loadMoreList();
  }

  // ---------- Hilo abierto ----------

  toggleMessage(messageId: string): void {
    this.store.toggleMessage(messageId);
  }

  retryBody(messageId: string): void {
    this.store.retryBody(messageId);
  }

  retryAttachments(messageId: string): void {
    this.store.retryAttachments(messageId);
  }

  downloadAttachment(event: { messageId: string; attachmentId: string }): void {
    this.store.downloadAttachment(event.messageId, event.attachmentId);
  }

  // ---------- Visor global de adjuntos ----------

  readonly viewerOpen = signal(false);

  // ---------- Teclado (estilo Gmail) ----------

  readonly shortcuts = MAIL_SHORTCUTS;
  readonly shortcutsOpen = signal(false);
  private readonly mailList = viewChild(MailListComponent);

  /**
   * Atajos de una tecla sobre la bandeja. Solo en /email con buzón, sin el composer, el visor ni la ayuda
   * abiertos; `shortcutFor` ya ignora lo que se teclea en campos y las combinaciones con Ctrl/Cmd/Alt.
   */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (
      this.embedded() ||
      !this.store.hasMailbox() ||
      this.showMailboxManager() ||
      this.connectedNotice() ||
      this.store.compose().open ||
      this.viewerOpen() ||
      this.shortcutsOpen()
    ) {
      return;
    }
    const action = shortcutFor(event);
    if (!action) {
      return;
    }
    event.preventDefault();
    this.runShortcut(action);
  }

  private runShortcut(action: MailShortcut): void {
    switch (action) {
      case 'next':
      case 'previous':
        this.moveSelection(action === 'next' ? 1 : -1);
        break;
      case 'archive': {
        const thread = this.store.selectedThread();
        if (!thread || thread.threadId.startsWith('sent:')) return;
        if (thread.status === 'Active') this.archiveThread();
        else this.unarchiveThread();
        break;
      }
      case 'markUnread':
        if (this.store.selectedThreadId() && !this.store.selectedThreadId()!.startsWith('sent:')) this.setThreadRead(false);
        break;
      case 'reply': {
        const latest = [...this.store.messages()].reverse().find(message => message.direction === 'Inbound' && !!message.from);
        if (latest && this.store.activeAccountId()) this.startReply(latest.messageId);
        break;
      }
      case 'compose':
        if (this.canCompose() && this.can.canCompose()) this.openCompose();
        break;
      case 'search':
        this.mailList()?.focusSearch();
        break;
      case 'help':
        this.shortcutsOpen.set(true);
        break;
    }
  }

  /** j/k: abre la conversación siguiente/anterior de la lista (la papelera no abre lectura). */
  private moveSelection(step: 1 | -1): void {
    if (this.store.activeFolderId() === 'trash') {
      return;
    }
    const rows = this.rows();
    if (rows.length === 0) {
      return;
    }
    const current = rows.findIndex(row => row.id === this.selectedRowId());
    const target = current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + step));
    if (target !== current) {
      this.selectRow(rows[target].id);
    }
  }

  // ---------- Móvil: lista o lectura, una a la vez ----------

  /** Hay algo abierto en el panel derecho (conversación, enviado o composer). */
  readonly detailOpen = computed(() => !!this.store.selectedThread() || this.store.compose().open);

  /** "Back" del panel de lectura en pantallas chicas: vuelve a la lista. */
  backToList(): void {
    this.selectedDraftId.set(null);
    this.selectedSentId.set(null);
    if (this.store.compose().open) {
      this.store.closeCompose();
    }
    this.store.closeThread();
  }
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

  /** Abre el visor con los adjuntos (no bloqueados) del mensaje; la URL se resuelve al mostrar cada uno. */
  previewAttachment(event: { messageId: string; attachmentId: string }): void {
    const items = (this.store.attachments().get(event.messageId)?.items ?? []).filter(a => a.downloadStatus !== 'Blocked' && a.downloadStatus !== 'UnderReview');
    const start = items.findIndex(a => a.attachmentId === event.attachmentId);
    if (start < 0) {
      return;
    }
    this.viewerFiles.set(
      items.map(a => ({
        name: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        resolveUrl: () => this.store.attachmentUrl(event.messageId, a.attachmentId),
        ref: { messageId: event.messageId, attachmentId: a.attachmentId },
      })),
    );
    this.viewerIndex.set(start);
    this.viewerOpen.set(true);
  }

  onViewerDownload(event: FileViewerDownload): void {
    this.downloadAttachment(event.item.ref as { messageId: string; attachmentId: string });
  }

  loadMoreMessages(): void {
    this.store.loadMessages(false);
  }

  retryMessages(): void {
    this.store.loadMessages(true);
  }

  archiveThread(): void {
    this.store.archiveSelectedThread();
  }

  unarchiveThread(): void {
    this.store.unarchiveSelectedThread();
  }

  trashMessage(messageId: string): void {
    this.store.trashOpenMessage(messageId);
  }

  restoreTrash(id: string): void {
    const item = this.store.trash().find(t => t.messageId === id);
    if (item) {
      this.store.restoreTrashItem(item);
    }
  }

  purgeTrash(id: string): void {
    const item = this.store.trash().find(t => t.messageId === id);
    if (item) {
      this.store.purgeTrashItem(item);
    }
  }

  toggleMessageRead(event: { messageId: string; isRead: boolean }): void {
    this.store.setMessageRead(event.messageId, event.isRead);
  }

  setThreadRead(isRead: boolean): void {
    this.store.setThreadRead(isRead);
  }

  // ---------- Reply ----------

  startReply(messageId: string): void {
    this.store.startReply(messageId);
  }

  cancelReply(): void {
    this.store.cancelReply();
  }

  sendReply(text: string): void {
    this.store.sendReply(text);
  }

  // ---------- Composer ----------

  openCompose(): void {
    this.selectedDraftId.set(null);
    // Con un cliente filtrado (o en el perfil), "To" arranca con su email principal; sin filtro, vacío.
    const prefillTo = this.store.selectedCustomerId() ? this.store.selectedCustomer()?.primaryEmail || null : null;
    this.store.openCompose(prefillTo);
  }

  closeCompose(): void {
    this.selectedDraftId.set(null);
    this.store.closeCompose();
  }

  discardCompose(): void {
    this.selectedDraftId.set(null);
    this.store.discardCompose();
  }

  /**
   * El editor no conoce el buzón: se completa acá con el activo. El cliente NO se toma del rail: lo fija
   * el composer al abrirse (en el perfil, siempre el del perfil).
   */
  sendCompose(payload: ComposeDraftPayload): void {
    const accountId = this.store.activeAccountId();
    if (!accountId) {
      return;
    }
    this.store.sendCompose({ ...payload, accountId });
  }

  unlinkComposeCustomer(): void {
    this.store.unlinkComposeCustomer();
  }

  /** Un cliente elegido como destinatario archiva en él la redacción que aún no tiene cliente. */
  fileComposeUnder(customer: CustomerSummary): void {
    this.store.fileComposeUnder(customer);
  }
}
