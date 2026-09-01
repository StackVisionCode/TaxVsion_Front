import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MailFolder, MailFolderListComponent } from '../../ui/mail-folder-list/mail-folder-list.component';
import { MailListComponent, MailListRow } from '../../ui/mail-list/mail-list.component';
import { MailReadingPaneComponent } from '../../ui/mail-reading-pane/mail-reading-pane.component';
import { ComposeDraftPayload, MailComposeComponent } from '../../ui/mail-compose/mail-compose.component';
import { MailConnectManualComponent } from '../../ui/mail-connect-manual/mail-connect-manual.component';
import { MailFolderId, MailStore } from '../../data-access/mail.store';
import {
  ConnectManualAccountRequest,
  MailAccountStatus,
  avatarColorFor,
  formatMailTime,
  initialsFor,
} from '../../data-access/mail.model';

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
 */
@Component({
  selector: 'app-mail-page',
  imports: [
    CommonModule,
    FormsModule,
    MailFolderListComponent,
    MailListComponent,
    MailReadingPaneComponent,
    MailComposeComponent,
    MailConnectManualComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-page.component.html',
  styleUrl: './mail-page.component.css',
})
export class MailPageComponent implements OnInit {
  readonly store = inject(MailStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Draft resaltado en el listado mientras el composer lo carga (GET /drafts/{id} es async). */
  readonly selectedDraftId = signal<string | null>(null);

  /**
   * Resultado del callback OAuth de Connectors. El backend no vuelve a una ruta propia:
   * redirige a la raíz del portal con `?connectors_connected=true` (o `connectors_error`),
   * y `app.routes.ts` desvía esa raíz hasta acá conservando los query params.
   */
  readonly connectResult = signal<{ ok: boolean; text: string } | null>(null);

  ngOnInit(): void {
    // Idempotente: cuentas de buzón + clientes; si ya hay ambos, dispara hilos y drafts.
    this.store.init();
    this.consumeOAuthCallback();
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
      label: 'Conversations',
      icon: 'chatbubbles-outline',
      count: this.store.activeThreads().length,
    },
    {
      id: 'archived',
      label: 'Archived',
      icon: 'archive-outline',
      count: this.store.archivedThreads().length,
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
        initials: initialsFor(draft.subject || 'Draft'),
        avatarColor: avatarColorFor(draft.subject || draft.draftId),
        title: draft.subject || '(No subject)',
        subtitle: draft.isReply ? 'Reply draft' : 'New message',
        time: formatMailTime(draft.updatedAtUtc),
        // El estado sólo se muestra cuando NO es el normal (Sending/Failed/Sent).
        badge: draft.status === 'Draft' ? null : draft.status,
        unreadCount: 0,
      }));
    }

    const threads =
      this.store.activeFolderId() === 'archived' ? this.store.archivedThreads() : this.store.activeThreads();

    return threads.map(thread => ({
      id: thread.threadId,
      initials: initialsFor(thread.subject || 'Thread'),
      avatarColor: avatarColorFor(thread.subject || thread.threadId),
      title: thread.subject || '(No subject)',
      subtitle: `${thread.messageCount} ${thread.messageCount === 1 ? 'message' : 'messages'}`,
      time: formatMailTime(thread.lastMessageAtUtc),
      badge: null,
      unreadCount: thread.unreadCount,
    }));
  });

  readonly listLoading = computed(() =>
    this.store.activeFolderId() === 'drafts' ? this.store.draftsLoading() : this.store.threadsLoading(),
  );

  readonly listError = computed(() =>
    this.store.activeFolderId() === 'drafts' ? this.store.draftsError() : this.store.threadsError(),
  );

  readonly listHasMore = computed(() =>
    this.store.activeFolderId() === 'drafts' ? this.store.draftsHasMore() : this.store.threadsHasMore(),
  );

  readonly selectedRowId = computed(() =>
    this.store.activeFolderId() === 'drafts' ? this.selectedDraftId() : this.store.selectedThreadId(),
  );

  /** Estados vacíos honestos: distinguen "falta elegir cliente" de "no hay nada". */
  readonly listEmptyText = computed(() => {
    if (this.store.customers().length === 0) {
      return 'No clients yet — mail threads belong to a client';
    }
    if (!this.store.selectedCustomerId()) {
      return 'Select a client to see their mail';
    }
    switch (this.store.activeFolderId()) {
      case 'drafts':
        return 'No drafts for this client';
      case 'archived':
        return 'No archived conversations for this client';
      default:
        return 'No conversations for this client yet';
    }
  });

  readonly selectedCustomerName = computed(
    () =>
      this.store.customers().find(customer => customer.id === this.store.selectedCustomerId())?.displayName ?? null,
  );

  /** Redactar exige cuenta de buzón utilizable + cliente (el draft cuelga de ambos). */
  readonly canCompose = computed(() => !!this.store.activeAccountId() && !!this.store.selectedCustomerId());

  // ---------- Cuentas de buzón ----------

  selectCustomer(customerId: string): void {
    this.selectedDraftId.set(null);
    this.store.selectCustomer(customerId);
  }

  selectAccount(accountId: string): void {
    this.store.setActiveAccount(accountId);
  }

  /** Muestra/oculta el formulario de alta manual IMAP/SMTP en la pantalla de conexión. */
  readonly showManualForm = signal(false);

  /**
   * Qué opciones de conexión ofrecer según el proveedor detectado del email de login. Como el guard
   * obliga a que el buzón sea ese mismo email, solo tiene sentido el proveedor de su dominio:
   * gmail.com → solo Gmail; outlook/hotmail → solo Microsoft; dominio propio (Unknown) → ambos, porque
   * no se puede saber si es Google Workspace o M365; yahoo/icloud/zoho (Imap) → ninguno OAuth, solo manual.
   */
  readonly showGmailOption = computed(() => {
    const p = this.store.providerDetection().provider;
    return p === 'Gmail' || p === 'Unknown';
  });
  readonly showGraphOption = computed(() => {
    const p = this.store.providerDetection().provider;
    return p === 'Graph' || p === 'Unknown';
  });
  readonly showOAuthOptions = computed(() => this.showGmailOption() || this.showGraphOption());

  connectMailbox(provider: 'Gmail' | 'Graph'): void {
    // El store redirige la pestaña completa al consentimiento del proveedor.
    this.store.connectMailbox(provider);
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
    this.store.selectFolder(folderId as MailFolderId);
  }

  selectRow(id: string): void {
    if (this.store.activeFolderId() === 'drafts') {
      // Un draft no se "lee": se retoma en el composer (GET /drafts/{id}).
      this.selectedDraftId.set(id);
      this.store.openDraft(id);
      return;
    }
    this.selectedDraftId.set(null);
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

  loadMoreMessages(): void {
    this.store.loadMessages(false);
  }

  retryMessages(): void {
    this.store.loadMessages(true);
  }

  archiveThread(): void {
    this.store.archiveSelectedThread();
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
    this.store.openCompose();
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
