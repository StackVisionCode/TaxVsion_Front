import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  untracked,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { skip } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ChatConversationListComponent } from '../../ui/chat-conversation-list/chat-conversation-list.component';
import type { ChatMessage } from '@shared/ui/chat/chat-message.model';
import { ChatConversationPanelComponent } from '../conversation-panel/conversation-panel.component';
import { ChatMessageSearchComponent } from '../../ui/chat-message-search/chat-message-search.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { ActiveCallService } from '@core/communication/active-call.service';
import {
  DirectorySearch,
  GroupCreateRequest,
  NewConversationModalComponent,
} from '../../ui/new-conversation-modal/new-conversation-modal.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import {
  CustomerDirectoryEntry,
  EmployeeDirectoryEntry,
  presenceDotClass,
  presenceLabel,
  presenceTextClass,
} from '../../data-access/chat.model';
import { fillViewportHeight } from '@shared/utils/fill-viewport-height';
import { ChatStore } from '../../data-access/chat.store';
import { GroupInfoPanelComponent } from '../../ui/group-info-panel/group-info-panel.component';
import { ConversationContentTabsComponent } from '../../ui/conversation-content-tabs/conversation-content-tabs.component';

/** Alto mínimo usable (móvil apaisado): por debajo de esto sí se deja scrollear la página. */
const MIN_CHAT_HEIGHT = 360;

/**
 * Página del módulo Chat (estilo "Aether"): mensajería interna de equipo,
 * no el AI Assistant. Rail de conversaciones a la izquierda + hilo activo a
 * la derecha. Datos reales vía ChatStore (Communication: lista/historial
 * por HTTP, enviar/recibir + nueva conversación + adjuntos en vivo por
 * Socket.IO) — deja fuera de esta conexión: reacciones, editar/borrar
 * mensajes, y video-llamadas (fuera de alcance del feature).
 */
@Component({
  selector: 'app-chat-page',
  imports: [
    CommonModule,
    ChatConversationListComponent,
    ChatConversationPanelComponent,
    ModalComponent,
    NewConversationModalComponent,
    AvatarComponent,
    AvatarUrlPipe,
    SearchInputComponent,
    SegmentedComponent,
    ChatMessageSearchComponent,
    GroupInfoPanelComponent,
    ConversationContentTabsComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
  host: { '[style.height.px]': 'fillHeight()' },
})
export class ChatPageComponent {
  private readonly store = inject(ChatStore);
  private readonly activeCall = inject(ActiveCallService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** F8a (ADD-12 H-11): el deep link pidió un chat de Support o de una sala → a su módulo. */
  private readonly redirectEffect = effect(() => {
    const target = this.store.redirect();
    if (!target) {
      return;
    }
    untracked(() => {
      this.store.clearRedirect();
      void this.router.navigate(target.commands, { queryParams: target.queryParams, replaceUrl: true });
    });
  });
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Alto del chat = lo que queda del viewport VISIBLE debajo de su borde superior. Así la página no
   * crece con los mensajes (solo scrollean la lista y el hilo) y, en el móvil, el composer queda
   * encima del teclado (`visualViewport` se achica al abrirlo). null hasta medir por primera vez.
   */
  readonly fillHeight = fillViewportHeight(this.host, this.destroyRef, MIN_CHAT_HEIGHT);

  /** Por debajo de `lg` se ve un panel a la vez (maestro-detalle): la lista o la conversación. */
  readonly mobilePane = signal<'list' | 'thread'>('list');

  readonly canStartAudioCall = this.store.canStartAudioCall;
  readonly canStartVideoCall = this.store.canStartVideoCall;
  readonly callPhase = this.activeCall.phase;

  readonly conversations = this.store.conversations;
  readonly loading = this.store.loading;
  readonly loadError = this.store.error;
  readonly activeConversationId = computed(() => this.store.activeConversationId() ?? '');

  /** True solo cuando hay una conversación real seleccionada — controla el thread vs. el empty state. */
  readonly hasActiveConversation = computed(() => {
    const id = this.store.activeConversationId();
    return !!id && this.conversations().some(conv => conv.id === id);
  });

  readonly isInfoOpen = signal(false);
  readonly isNewConversationOpen = signal(false);

  /** Tab del rail izquierdo: conversaciones, o directorio de clientes/equipo (estilo WhatsApp). */
  readonly railTab = signal<'chats' | 'clients' | 'team'>('chats');
  readonly railTabs: SegmentedOption<'chats' | 'clients' | 'team'>[] = [
    { id: 'chats', label: 'Chats' },
    { id: 'clients', label: 'Clients' },
    { id: 'team', label: 'Team' },
  ];
  readonly railSearch = signal('');
  private railSearchDebounce: ReturnType<typeof setTimeout> | undefined;

  readonly loadingOlder = this.store.loadingOlder;

  readonly employeeResults = this.store.employeeResults;
  readonly customerResults = this.store.customerResults;
  readonly employeeSearchLoading = this.store.employeeSearchLoading;
  readonly employeeSearchError = this.store.employeeSearchError;
  readonly newConversationError = this.store.newConversationError;
  readonly creatingConversation = this.store.creatingConversation;
  readonly canCreateGroups = this.store.canCreateGroups;
  readonly hasMoreDirectory = this.store.hasMoreDirectory;
  /** Filas de esqueleto mientras llega la primera página del directorio. */
  readonly skeletonRows = [0, 1, 2, 3, 4];

  // ---------- F7: búsqueda de mensajes ----------
  @ViewChild(ChatConversationPanelComponent) protected panel?: ChatConversationPanelComponent;
  readonly searchOpen = signal(false);
  readonly searchQuery = this.store.searchQuery;
  readonly searchResults = this.store.searchResults;
  readonly searchLoading = this.store.searchLoading;
  readonly searchError = this.store.searchError;
  readonly searchTruncated = this.store.searchTruncated;
  /** Resultado elegido que no está cargado en el hilo: queda resaltado en la lista. */
  readonly searchHighlightId = signal<string | null>(null);

  constructor() {
    // El store suena al recibir un mensaje solo mientras esta página está a la vista.
    this.store.pageAttached.set(true);
    this.destroyRef.onDestroy(() => this.store.pageAttached.set(false));
    // Deep-link opcional `?conversation=<id>` (p. ej. desde un ticket de Support): abre esa.
    const preferId = this.route.snapshot.queryParamMap.get('conversation');
    this.store.load(preferId ?? undefined);
    if (preferId || this.route.snapshot.queryParamMap.get('startUser')) {
      this.mobilePane.set('thread'); // un deep-link va directo a la conversación, también en el móvil
    }
    // Si el param cambia estando ya en la página, enfocá la nueva conversación.
    this.route.queryParamMap.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('conversation');
      if (id && id !== this.store.activeConversationId()) {
        this.store.focusConversation(id);
        this.mobilePane.set('thread');
      }
    });

    // Deep-link `?startCustomer&startUser&name` desde el perfil de cliente (tab Communication):
    // inicia (o reabre) el 1:1 con ese cliente. Espera a que el socket conecte para no chocar con
    // `Socket.NotConnected`; el guard `started` corta el seguimiento tras disparar una sola vez.
    const startUser = this.route.snapshot.queryParamMap.get('startUser');
    const startCustomer = this.route.snapshot.queryParamMap.get('startCustomer');
    const startName = this.route.snapshot.queryParamMap.get('name');
    if (startUser && startCustomer) {
      let started = false;
      effect(() => {
        if (started || !this.store.connected()) {
          return;
        }
        started = true;
        void this.store.startDirectWithCustomer({
          customerId: startCustomer,
          displayName: startName ?? 'Client',
          email: '',
          isActive: true,
          portalUserId: startUser,
        });
      });
    }
  }

  get isActiveGroup(): boolean {
    return this.activeConversation.kind === 'Group';
  }

  /** F8b: "Group · N members" en la cabecera en lugar de la presencia de un par. */
  get groupSubtitle(): string {
    const count = this.activeConversation.participants?.length ?? 0;
    return `Group · ${count} ${count === 1 ? 'member' : 'members'}`;
  }

  get isActiveSupport(): boolean {
    return this.activeConversation.kind === 'Support';
  }

  /** Es un 1:1 llamable (Direct/Support con par conocido). */
  private get isCallableConversation(): boolean {
    const conv = this.activeConversation;
    return !!conv.peerUserId && (conv.kind === 'Direct' || conv.kind === 'Support');
  }

  get canCallActiveConversation(): boolean {
    return this.isCallableConversation && this.canStartAudioCall();
  }

  get canVideoCallActiveConversation(): boolean {
    return this.isCallableConversation && this.canStartVideoCall();
  }

  /**
   * Motivo por el que NO se puede llamar ahora (null = se puede). Deshabilita el botón solo cuando YO ya
   * estoy en una llamada, o cuando el par está en OTRA llamada (Busy). Ya NO se exige que el par esté
   * Online: se permite llamar aunque esté offline — si no contesta / no está conectado, el backend marca
   * la llamada como MissedCall y el caller ve "Could not reach {name}" (queda en el historial de ambos).
   */
  get callDisabledReason(): string | null {
    if (this.callPhase() !== 'idle') {
      return 'You are already on a call';
    }
    const conv = this.activeConversation;
    const who = conv.name || 'This contact';
    if (conv.presence === 'Busy') {
      return `${who} is currently on a call`;
    }
    return null;
  }

  get callButtonsDisabled(): boolean {
    return this.callDisabledReason !== null;
  }

  startAudioCall(): void {
    this.startCall('Audio');
  }

  startVideoCall(): void {
    this.startCall('Video');
  }

  private startCall(kind: 'Audio' | 'Video'): void {
    const conv = this.activeConversation;
    if (!conv.peerUserId) {
      return;
    }
    void this.activeCall.startCall(conv.peerUserId, conv.name, kind, conv.id, conv.avatarFileId);
  }

  get activeConversation() {
    return (
      this.conversations().find(conv => conv.id === this.store.activeConversationId()) ?? {
        id: '',
        name: '',
        kind: 'Direct' as const,
        peerUserId: null,
        avatarColor: 'bg-brand-bold',
        presence: 'Offline' as const,
        busyReason: null,
        typingName: null,
        recordingName: null,
        hasMoreHistory: false,
        unread: 0,
        messages: [] as ChatMessage[],
      }
    );
  }

  /** F8d: archivo elegido en las pestañas de Info → visor del panel. */
  openContentFile(file: { fileId: string; name: string }): void {
    this.panel?.openFile(file.fileId, file.name);
  }

  openInfo(): void {
    this.isInfoOpen.set(true);
  }

  closeInfo(): void {
    this.isInfoOpen.set(false);
  }

  selectConversation(id: string): void {
    if (id !== this.store.activeConversationId()) {
      this.closeSearch();
    }
    this.store.selectConversation(id);
    this.mobilePane.set('thread');
  }

  toggleSearch(): void {
    if (this.searchOpen()) {
      this.closeSearch();
    } else {
      this.searchOpen.set(true);
    }
  }

  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchHighlightId.set(null);
    this.store.clearMessageSearch();
  }

  onSearch(query: string): void {
    this.searchHighlightId.set(null);
    this.store.searchMessages(query);
  }

  /** Salta al mensaje si está cargado en el hilo; si no, solo lo resalta en los resultados. */
  onSearchResult(messageId: string): void {
    const found = this.panel?.scrollToMessage(messageId) ?? false;
    this.searchHighlightId.set(found ? null : messageId);
  }

  /** Móvil: vuelve de la conversación a la lista. */
  showList(): void {
    this.mobilePane.set('list');
  }

  // Presencia del participante activo (etiqueta/colores accesibles, no solo color).
  get presenceLabel(): string {
    return presenceLabel(this.activeConversation.presence, this.activeConversation.busyReason);
  }

  get presenceDotClass(): string {
    return presenceDotClass(this.activeConversation.presence);
  }

  get presenceTextClass(): string {
    return presenceTextClass(this.activeConversation.presence);
  }

  get showPresenceDot(): boolean {
    return this.activeConversation.presence !== 'Offline';
  }

  // ---------- Rail directorio (Clients / Team) ----------

  switchRailTab(tab: 'chats' | 'clients' | 'team'): void {
    if (this.railTab() === tab) {
      return;
    }
    this.railTab.set(tab);
    this.railSearch.set('');
    clearTimeout(this.railSearchDebounce);
    this.store.resetNewConversationState();
    // F8c: la pestaña abre con la primera página (sin escribir nada).
    if (tab === 'clients') {
      this.store.searchCustomers('');
    } else if (tab === 'team') {
      this.store.searchEmployees('');
    }
  }

  loadMoreDirectory(): void {
    this.store.loadMoreDirectory();
  }

  /** F8c: motivo por el que una fila no es chateable (null = se puede). */
  blockedLabel(reason: string | null | undefined): string | null {
    if (reason === 'EmployeeToEmployeeDisabled') {
      return 'Team chat is turned off by your admin.';
    }
    if (reason === 'NoPortalAccount') {
      return "This client hasn't activated their portal yet, so they can't be messaged.";
    }
    return null;
  }

  /** F8c: cierra el hilo y vuelve al estado sin conversación. */
  closeConversation(): void {
    this.closeSearch();
    this.store.closeConversation();
    this.mobilePane.set('list');
  }

  onRailSearch(term: string): void {
    this.railSearch.set(term);
    clearTimeout(this.railSearchDebounce);
    const tab = this.railTab();
    this.railSearchDebounce = setTimeout(() => {
      if (tab === 'clients') {
        this.store.searchCustomers(term);
      } else if (tab === 'team') {
        this.store.searchEmployees(term);
      }
    }, 300);
  }

  async onRailSelectCustomer(entry: CustomerDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectWithCustomer(entry);
    if (ok) {
      this.switchRailTab('chats');
      this.mobilePane.set('thread');
    }
  }

  async onRailSelectEmployee(entry: EmployeeDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectConversation(entry);
    if (ok) {
      this.switchRailTab('chats');
      this.mobilePane.set('thread');
    }
  }

  openNewConversation(): void {
    this.store.resetNewConversationState();
    this.store.searchCustomers(''); // el modal abre en Clients con la primera página
    this.isNewConversationOpen.set(true);
  }

  closeNewConversation(): void {
    this.isNewConversationOpen.set(false);
  }

  onDirectorySearch(search: DirectorySearch): void {
    if (search.audience === 'clients') {
      this.store.searchCustomers(search.term);
    } else {
      this.store.searchEmployees(search.term);
    }
  }

  async onDirectSelected(entry: EmployeeDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectConversation(entry);
    if (ok) {
      this.isNewConversationOpen.set(false);
      this.mobilePane.set('thread');
    }
  }

  async onCustomerSelected(entry: CustomerDirectoryEntry): Promise<void> {
    const ok = await this.store.startDirectWithCustomer(entry);
    if (ok) {
      this.isNewConversationOpen.set(false);
      this.mobilePane.set('thread');
    }
  }

  async onGroupCreateRequested(request: GroupCreateRequest): Promise<void> {
    const ok = await this.store.createGroupConversation(request.title, request.memberUserIds, request.description);
    if (ok) {
      this.isNewConversationOpen.set(false);
      this.mobilePane.set('thread');
    }
  }

}
