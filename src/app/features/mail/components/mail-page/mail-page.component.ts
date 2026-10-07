import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MailFolder, MailFolderListComponent } from '../../ui/mail-folder-list/mail-folder-list.component';
import { MailListComponent, MailListRow } from '../../ui/mail-list/mail-list.component';
import { MailReadingPaneComponent } from '../../ui/mail-reading-pane/mail-reading-pane.component';
import { ComposeDraftPayload, MailComposeComponent } from '../../ui/mail-compose/mail-compose.component';
import { MailConnectManualComponent } from '../../ui/mail-connect-manual/mail-connect-manual.component';
import { MailFolderId, MailStore } from '../../data-access/mail.store';
import {
  ConnectManualAccountRequest,
  MailAccount,
  MailAccountStatus,
  formatMailTime,
} from '../../data-access/mail.model';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { ComposeMailDeepLink, hasComposeMailParams, parseComposeMailDeepLink } from '../../utils/compose-deep-link';
import { CorrespondenceCapabilities } from '../../data-access/correspondence-permissions';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerDownload, FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';

/**
 * Página del módulo Mail conectada a los dos servicios reales del Gateway:
 * - Connectors.Api (`/connectors`): cuentas de buzón externas del tenant. SIN una
 *   cuenta utilizable no hay correo, así que la página muestra el flujo de
 *   "conectar buzón" (OAuth Gmail/Microsoft) en vez de una bandeja falsa.
 * - Correspondence.Api (`/correspondence`): el inbox real, que es
 *   CUSTOMER-CÉNTRICO — los hilos cuelgan de un cliente, no existe una bandeja
 *   global del tenant. Por eso el rail izquierdo obliga a elegir cliente antes
 *   de listar conversaciones.
 *
 * Se conserva el layout de 3 paneles del diseño (rail | listado | lectura), pero
 * las carpetas del mock (Inbox/Sent/Starred/Trash) se reducen a las tres que el
 * backend respalda: Conversations, Archived y Drafts. Toda la lógica (paginación,
 * cuerpos en vivo, adjuntos bajo demanda, reply y compose) vive en MailStore;
 * este componente sólo traduce estado a la UI y despacha intenciones.
 *
 * Modo embebido (`injectEmbeddedCustomer()`): lo monta `ClientMailWorkspaceComponent` en el perfil
 * del cliente. Cliente fijo (sin picker), sin consumir query params (OAuth / deep link) y sin el
 * gestor de buzones: si no hay buzón se enlaza a /email y los hilos se ven en solo lectura.
 */
@Component({
  selector: 'app-mail-page',
  imports: [
    CommonModule,
    MailFolderListComponent,
    MailListComponent,
    MailReadingPaneComponent,
    MailComposeComponent,
    MailConnectManualComponent,
    CustomerPickerComponent,
    FileViewerComponent,
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

  ngOnInit(): void {
    // Idempotente: cuentas de buzón + clientes + realtime; si ya hay ambos, dispara hilos y drafts.
    this.store.init();
    // Embebido: los query params son del perfil, no de Mail (ni OAuth ni deep link de compose).
    if (this.embedded()) {
      return;
    }
    this.consumeOAuthCallback();
    this.consumeComposeDeepLink();
  }

  /**
   * `/email?compose=1&customerId=<id>&to=<email>` (acción "Send email" del perfil del cliente):
   * elige ese cliente (leído del directorio) y abre el composer con el destinatario precargado.
   * Limpia la URL. Solo con permiso de redactar (`correspondence.compose`).
   */
  private consumeComposeDeepLink(): void {
    const params = this.route.snapshot.queryParamMap;
    const link = parseComposeMailDeepLink(params);
    if (hasComposeMailParams(params)) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
    if (!link || !this.can.canCompose()) {
      return;
    }
    this.directory.byId([link.customerId]).subscribe({
      next: found => {
        const customer = found.get(link.customerId);
        if (!customer) {
          return;
        }
        this.directory.addRecent(customer);
        this.pickCustomer(customer);
        this.pendingCompose.set(link);
      },
      error: () => undefined,
    });
  }

  ngOnDestroy(): void {
    this.pendingCompose.set(null);
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
  private consumeOAuthCallback(): void {
    const params = this.route.snapshot.queryParamMap;
    const connected = params.get('connectors_connected');
    const error = params.get('connectors_error');
    const adminConsent = params.get('connectors_admin_consent');
    if (!connected && !error && !adminConsent) {
      return;
    }

    if (connected === 'true') {
      this.connectResult.set({ ok: true, text: 'Mailbox connected.' });
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
  }

  // ---------- Carpetas (sólo las que el backend respalda) ----------

  readonly folders = computed<MailFolder[]>(() => [
    {
      id: 'conversations',
      // El badge cuenta conversaciones CON no-leídos (baja al abrir/marcar leído, desaparece en 0),
      // no el total de hilos — así refleja "cuántas te faltan por leer", estilo cliente de correo.
      label: 'Conversations',
      icon: 'chatbubbles-outline',
      count: this.store.activeThreads().filter(thread => thread.unreadCount > 0).length,
    },
    {
      // Enviados del cliente. Sin badge: no hay "no-leídos" en lo que uno mismo envió.
      id: 'sent',
      label: 'Sent',
      icon: 'paper-plane-outline',
      count: 0,
    },
    {
      id: 'archived',
      label: 'Archived',
      icon: 'archive-outline',
      count: this.store.archivedThreads().length,
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
      }));
    }

    if (this.store.activeFolderId() === 'trash') {
      return this.store.trash().map(item => ({
        id: item.messageId,
        avatarName: item.subject || 'Trash',
        avatarColor: avatarColorFor(item.subject || item.messageId),
        title: item.subject || '(No subject)',
        subtitle: `${item.kind === 'Sent' ? 'To' : 'From'} ${item.counterparty}`,
        time: formatMailTime(item.deletedAtUtc),
        badge: item.kind,
        unreadCount: 0,
        attachmentCount: item.hasAttachments ? item.attachmentCount : 0,
      }));
    }

    if (this.store.activeFolderId() === 'sent') {
      return this.store.sent().map(item => ({
        id: item.messageId,
        avatarName: item.subject || 'Sent',
        avatarColor: avatarColorFor(item.subject || item.messageId),
        title: item.subject || '(No subject)',
        // Muestra el destinatario; el clip 📎 lo pinta la lista con attachmentCount.
        subtitle: item.toAddresses.length > 0 ? `To ${item.toAddresses.join(', ')}` : 'Sent message',
        time: formatMailTime(item.sentAtUtc),
        badge: item.isReply ? 'Reply' : null,
        unreadCount: 0,
        attachmentCount: item.hasAttachments ? item.attachmentCount : 0,
      }));
    }

    const threads =
      this.store.activeFolderId() === 'archived' ? this.store.archivedThreads() : this.store.activeThreads();

    return threads.map(thread => ({
      id: thread.threadId,
      avatarName: thread.subject || 'Thread',
      avatarColor: avatarColorFor(thread.subject || thread.threadId),
      title: thread.subject || '(No subject)',
      subtitle: `${thread.messageCount} ${thread.messageCount === 1 ? 'message' : 'messages'}`,
      time: formatMailTime(thread.lastMessageAtUtc),
      badge: null,
      unreadCount: thread.unreadCount,
    }));
  });

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

  /** Estados vacíos honestos: distinguen "falta elegir cliente" de "no hay nada". */
  readonly listEmptyText = computed(() => {
    // Embebido: el cliente siempre está fijado, solo aplican los textos por carpeta.
    if (!this.embedded() && this.store.customers().length === 0) {
      return 'No clients yet — mail threads belong to a client';
    }
    if (!this.embedded() && !this.store.selectedCustomerId()) {
      return 'Select a client to see their mail';
    }
    switch (this.store.activeFolderId()) {
      case 'drafts':
        return 'No drafts for this client';
      case 'sent':
        return 'No sent messages for this client yet';
      case 'trash':
        return 'Trash is empty';
      case 'archived':
        return 'No archived conversations for this client';
      default:
        return 'No conversations for this client yet';
    }
  });

  readonly selectedCustomerName = computed(() => this.store.selectedCustomerName());

  // ---------- Selector de cliente ----------
  // Correspondence no tiene bandeja global: los hilos cuelgan de un cliente, así que elegir cliente
  // es la acción más frecuente del módulo. Lo resuelve `app-customer-picker` (búsqueda server-side,
  // recientes compartidos del CustomerDirectoryStore y navegación por teclado).

  /**
   * `null` = el usuario pulsó "Change client" en el chip: el picker pasa a modo búsqueda pero la
   * bandeja sigue siendo la del cliente activo hasta que elija otro.
   */
  onCustomerChange(customer: CustomerSummary | null): void {
    if (customer) {
      this.pickCustomer(customer);
    }
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

  /** Redactar exige cuenta de buzón utilizable + cliente (el draft cuelga de ambos). */
  readonly canCompose = computed(() => !!this.store.activeAccountId() && !!this.store.selectedCustomerId());

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
      // Éxito: la cuenta ya existe y hasMailbox() pasa a true → la bandeja aparece sola.
      this.showManualForm.set(false);
      this.connectResult.set({ ok: true, text: 'Mailbox connected.' });
    });
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
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

  /** Abre el visor con los adjuntos (no bloqueados) del mensaje; la URL se resuelve al mostrar cada uno. */
  previewAttachment(event: { messageId: string; attachmentId: string }): void {
    const items = (this.store.attachments().get(event.messageId)?.items ?? []).filter(a => a.downloadStatus !== 'Blocked');
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
    // Embebido: "To" arranca con el email principal del cliente (si el directorio lo trajo).
    this.store.openCompose(this.embedded() ? this.store.selectedCustomer()?.primaryEmail || null : null);
  }

  closeCompose(): void {
    this.selectedDraftId.set(null);
    this.store.closeCompose();
  }

  discardCompose(): void {
    this.selectedDraftId.set(null);
    this.store.discardCompose();
  }

  /** El editor no conoce los ids del contrato: se completan acá con la selección activa. */
  sendCompose(payload: ComposeDraftPayload): void {
    const customerId = this.store.selectedCustomerId();
    const accountId = this.store.activeAccountId();
    if (!customerId || !accountId) {
      return;
    }
    this.store.sendCompose({ ...payload, customerId, accountId });
  }
}
