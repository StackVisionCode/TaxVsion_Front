import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, ElementRef, HostListener, Injector, ViewChild, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, HostListener, Injector, ViewChild, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { AuthService } from '@core/auth/auth.service';
import { WalletStore } from '@features/wallet/data-access/wallet.store';
import { formatMicros } from '@features/wallet/data-access/wallet.model';
import type { NotificationsStore } from '@features/notifications/data-access/notifications.store';
import { AppNotification, NotificationType } from '@features/notifications/ui/notification-list/notification-list.component';
import {
  needsAttention,
  notificationIcon,
  notificationIconBg,
  notificationIconText,
} from '@features/notifications/data-access/notifications.model';
import { AccessStore } from '@core/access/access.store';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import type { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import type { CustomerSummary } from '@core/customers/customer-summary.model';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';

/** Cuántos clientes muestra el buscador del navbar (el listado completo vive en /clients). */
const NAVBAR_SEARCH_SIZE = 8;
const NAVBAR_SEARCH_DEBOUNCE_MS = 250;

/** Pestañas de la campana. No hay "Mentions": este producto no genera menciones. */
export type NotificationTab = 'all' | 'unread' | 'alerts';

/**
 * Visual port of the production navbar. El usuario del menú viene de
 * AuthService.currentUser() (GET /auth/me). El buscador consulta el directorio real de clientes
 * (`CustomerDirectoryStore`: GET /customers server-side, cacheado, + recientes); el store se
 * descarga la primera vez que se abre el buscador para no engordar el bundle inicial (R3). La
 * campana de notificaciones abre un panel local, no un servicio de modal.
 */

interface NavbarUser {
  name: string;
  lastName: string;
  fullName: string;
  companyName: string;
  email: string;
  avatarUrl: string | null;
  isOwner: boolean;
  role: string;
}

@Component({
  selector: 'app-navbar',
  imports: [CommonModule, RouterModule, SidebarComponent, AvatarComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css',
})
export class NavbarComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  /** El store de notificaciones se descarga tras el primer render (fuera del bundle inicial). */
  private readonly notificationsStore = signal<NotificationsStore | null>(null);
  private readonly loadNotificationsStore = afterNextRender(() => {
    void import('@features/notifications/data-access/notifications.store').then(m =>
      this.notificationsStore.set(this.injector.get(m.NotificationsStore)),
    );
  });
  private readonly access = inject(AccessStore);
  readonly handoff = inject(AccountHandoffStore);

  // Pill de saldo del monedero (siempre visible en el header, 00_Plan §10). Comparte el WalletStore
  // singleton con el apartado /wallet. Se carga perezosamente solo si el tenant puede ver el monedero
  // (evita un 403 de GET /wallet en tenants sin el permiso); la carga es idempotente.
  private readonly wallet = inject(WalletStore);
  private readonly _walletInit = effect(() => {
    if (this.access.canUseId('wallet')) {
      this.wallet.init();
    }
  });
  readonly walletAvailableLabel = computed(() =>
    formatMicros(this.wallet.availableMicros(), this.wallet.currency()),
  );
  readonly walletLowBalance = computed(() => this.wallet.lowBalance());

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  // Dropdown / panel visibility
  readonly isUserMenuOpen = signal(false);
  readonly isMobileMenuOpen = signal(false);
  readonly isNotificationsOpen = signal(false);

  // Usuario logueado real, derivado de AuthService.currentUser() (GET /auth/me).
  readonly user = computed<NavbarUser>(() => {
    const me = this.auth.currentUser();
    if (!me) {
      return {
        name: '',
        lastName: '',
        fullName: '',
        companyName: '',
        email: '',
        avatarUrl: null,
        isOwner: false,
        role: '',
      };
    }
    return {
      name: me.name,
      lastName: me.lastName,
      fullName: `${me.name} ${me.lastName}`.trim(),
      companyName: me.tenant?.name ?? '',
      email: me.email,
      avatarUrl: null,
      isOwner: me.actorType === 'TenantAdmin',
      role: me.roles[0] ?? me.actorType,
    };
  });

  // Notificaciones REALES (Communication): feed corto de la campana + conteo en vivo.
  readonly notifications = computed(() => this.notificationsStore()?.recent() ?? []);
  readonly notificationCount = computed(() => this.notificationsStore()?.unreadCount() ?? 0);
  readonly hasUnread = computed(() => this.notificationCount() > 0);

  /**
   * Pestañas de la campana. Filtran EN LOCAL el mismo feed corto que ya está cargado: son
   * para encontrar algo de un vistazo, no para paginar — para eso está `/notifications`.
   */
  readonly notificationTab = signal<NotificationTab>('all');
  readonly notificationTabs: ReadonlyArray<{ id: NotificationTab; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'alerts', label: 'Alerts' },
  ];

  readonly visibleNotifications = computed(() => {
    const list = this.notifications();
    switch (this.notificationTab()) {
      case 'unread':
        return list.filter(n => !n.isRead);
      case 'alerts':
        return list.filter(n => needsAttention(n.type));
      default:
        return list;
    }
  });

  /** Cuántas hay en cada pestaña, para el contador que va junto a su nombre. */
  readonly notificationTabCounts = computed(() => {
    const list = this.notifications();
    return {
      all: list.length,
      unread: list.filter(n => !n.isRead).length,
      alerts: list.filter(n => needsAttention(n.type)).length,
    } satisfies Record<NotificationTab, number>;
  });

  readonly searchQuery = signal('');
  private readonly searchFocused = signal(false);
  /** Buscador expandido (la cápsula crece desde la lupa, al lado de la campana). */
  readonly isSearchOpen = signal(false);
  /** Solo quien puede ver clientes tiene buscador: si no, cada búsqueda sería un 403. */
  readonly canSearchClients = computed(() => this.access.canUseId('clients'));

  /** Directorio de clientes, cargado a demanda (import dinámico) al abrir el buscador. */
  private readonly directory = signal<CustomerDirectoryStore | null>(null);
  private readonly searchTerm$ = new Subject<string>();
  readonly searchResults = signal<CustomerSummary[]>([]);
  readonly searchTotal = signal(0);
  readonly searchLoading = signal(false);
  readonly searchError = signal(false);
  /** Fila resaltada con ↑/↓ (Enter la abre). */
  readonly activeResultIndex = signal(0);

  /** Sin texto se ofrecen los recientes del directorio (compartidos con los pickers de cada módulo). */
  readonly recentCustomers = computed(() => (this.directory()?.recent() ?? []).slice(0, 5));
  readonly hasSearchTerm = computed(() => this.searchQuery().trim().length > 0);
  /** Lo que se navega con el teclado: resultados si hay texto, recientes si no. */
  readonly visibleCustomers = computed(() => (this.hasSearchTerm() ? this.searchResults() : this.recentCustomers()));

  readonly isSearchDropdownOpen = computed(
    () => this.isSearchOpen() && this.searchFocused() && (this.hasSearchTerm() || this.recentCustomers().length > 0),
  );

  private readonly wireSearch = this.searchTerm$
    .pipe(
      map(term => term.trim()),
      debounceTime(NAVBAR_SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap(term => {
        const directory = this.directory();
        if (!term || !directory) {
          this.searchLoading.set(false);
          return of({ items: [] as CustomerSummary[], totalCount: 0, failed: false });
        }
        this.searchLoading.set(true);
        this.searchError.set(false);
        return directory.search({ term, status: 'NotArchived', page: 1, size: NAVBAR_SEARCH_SIZE }).pipe(
          map(page => ({ items: page.items, totalCount: page.totalCount, failed: false })),
          catchError(() => of({ items: [] as CustomerSummary[], totalCount: 0, failed: true })),
        );
      }),
      takeUntilDestroyed(inject(DestroyRef)),
    )
    .subscribe(({ items, totalCount, failed }) => {
      this.searchResults.set(items);
      this.searchTotal.set(totalCount);
      this.searchError.set(failed);
      this.searchLoading.set(false);
      this.activeResultIndex.set(0);
    });

  // ==========================================
  // Mobile menu
  // ==========================================

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update(open => !open);
    document.body.style.overflow = this.isMobileMenuOpen() ? 'hidden' : '';
  }

  closeMobileMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.max-w-xs') || target.classList.contains('inset-0')) {
      this.isMobileMenuOpen.set(false);
      document.body.style.overflow = '';
    }
  }

  // ==========================================
  // Outside click handling
  // ==========================================

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const isUserDropdown = target.closest('[data-dropdown="user"]');
    const isNotificationsDropdown = target.closest('[data-dropdown="notifications"]');
    const isSearch = target.closest('[data-dropdown="search"]');

    if (!isUserDropdown && this.isUserMenuOpen()) {
      this.isUserMenuOpen.set(false);
    }
    if (!isNotificationsDropdown && this.isNotificationsOpen()) {
      this.isNotificationsOpen.set(false);
    }
    // Clic fuera: se pliega solo si no hay nada escrito (no se pierde una búsqueda a medias).
    if (!isSearch && this.isSearchOpen() && !this.searchQuery()) {
      this.isSearchOpen.set(false);
    }
  }

  // Cmd+F / Ctrl+F focuses the command-style search (reference behavior).
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    // Sin buscador (no puede ver clientes) se deja el ⌘F del navegador intacto.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && this.canSearchClients()) {
      event.preventDefault();
      this.openSearch();
    }
  }

  // ==========================================
  // User menu
  // ==========================================

  toggleUserMenu(): void {
    this.isUserMenuOpen.update(open => !open);
    this.isNotificationsOpen.set(false);
  }

  getTaxUserFullName(): string {
    const u = this.user();
    const fullName = `${u.name} ${u.lastName}`.trim();
    return fullName || u.fullName;
  }

  getCompanyName(): string {
    return this.user().companyName;
  }

  getUserInitials(): string {
    const u = this.user();
    if (u.name && u.lastName) {
      return `${u.name.charAt(0)}${u.lastName.charAt(0)}`.toUpperCase();
    }
    if (u.name) {
      return u.name.substring(0, 2).toUpperCase();
    }
    if (u.fullName) {
      const words = u.fullName.trim().split(/\s+/);
      if (words.length >= 2) {
        return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
      }
      return u.fullName.substring(0, 2).toUpperCase();
    }
    return u.email.substring(0, 2).toUpperCase();
  }

  getUserRole(): string {
    return this.user().role;
  }

  getUserEmail(): string {
    return this.user().email;
  }

  getUserImageSrc(): string | null {
    return this.user().avatarUrl;
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }

  /** Si una entrada del menu de usuario se muestra, segun el registro de features. */
  canUse(featureId: string): boolean {
    return this.access.canUseId(featureId);
  }

  /**
   * El Account se abre con `billing.view`, no con el actor type. Es el mismo criterio del backend,
   * donde el permiso es `IsAssignableByTenant:false`: solo lo trae el rol raiz de la oficina, asi
   * que el `isAdmin()` que habia acá no agregaba nada y contradecia la regla ("sale de los
   * permisos, nunca del actor type").
   */
  canManageSubscription(): boolean {
    return this.access.canManageBilling();
  }

  manageSubscription(): void {
    this.handoff.open();
  }

  logout(): void {
    this.isUserMenuOpen.set(false);
    // Recarga DURA en vez de navegación SPA: los stores providedIn:'root' (productos, billing,
    // inventario, etc.) retienen los datos del usuario saliente y su flag `initialized` no se
    // reinicia, así que sin recargar sangraban en la sesión siguiente de la misma pestaña (se veían
    // datos del admin al entrar como empleado hasta refrescar). Un reload completo destruye todos los
    // singletons y garantiza una sesión limpia. logoutLocal() ya se ejecutó dentro de auth.logout().
    this.auth.logout().subscribe(() => window.location.assign('/login'));
  }

  // ==========================================
  // Notifications
  // ==========================================

  toggleNotifications(): void {
    this.isNotificationsOpen.update(open => !open);
    this.isUserMenuOpen.set(false);
    // Abrir siempre arranca en "All": si la última vez quedó en Alerts, reabrir mostraría
    // una lista vacía y parecería que no hay nada.
    if (this.isNotificationsOpen()) {
      this.notificationTab.set('all');
    }
  }

  selectNotificationTab(tab: NotificationTab): void {
    this.notificationTab.set(tab);
  }

  /** Texto del vacío según la pestaña: un vacío tiene que decir de qué está vacío. */
  emptyNotificationsMessage(): string {
    switch (this.notificationTab()) {
      case 'unread':
        return 'Nothing unread.';
      case 'alerts':
        return 'No alerts right now.';
      default:
        return 'Nothing here yet.';
    }
  }

  notificationIcon(type: NotificationType): string {
    return notificationIcon(type);
  }
  notificationIconBg(type: NotificationType): string {
    return notificationIconBg(type);
  }
  notificationIconText(type: NotificationType): string {
    return notificationIconText(type);
  }

  trackByNotificationId(_index: number, notification: AppNotification): string {
    return notification.id;
  }

  markAsRead(notificationId: string, event?: Event): void {
    event?.stopPropagation();
    this.notificationsStore()?.markRead(notificationId);
  }

  markAllAsRead(): void {
    this.notificationsStore()?.markAllRead();
  }

  navigateToNotificationCenter(): void {
    this.isNotificationsOpen.set(false);
    this.router.navigate(['/notifications']);
  }

  // ==========================================
  // Customer search (local filtering only, no backend)
  // ==========================================

  onSearchChange(query: string): void {
    this.searchQuery.set(query);
    this.activeResultIndex.set(0);
    if (query.trim()) {
      this.searchLoading.set(true);
    }
    this.searchTerm$.next(query);
  }

  /** ↑/↓ recorren la lista visible (resultados o recientes) y Enter abre la fila resaltada. */
  onSearchKeydown(event: KeyboardEvent): void {
    const list = this.visibleCustomers();
    if (!this.isSearchDropdownOpen() || list.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeResultIndex.set((this.activeResultIndex() + step + list.length) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const customer = list[this.activeResultIndex()];
      if (customer) {
        this.selectCustomer(customer);
      }
    }
  }

  onSearchFocus(): void {
    this.searchFocused.set(true);
  }

  onSearchBlur(): void {
    setTimeout(() => {
      this.searchFocused.set(false);
      if (!this.searchQuery()) {
        this.isSearchOpen.set(false);
      }
    }, 200);
  }

  toggleSearch(): void {
    if (this.isSearchOpen()) {
      this.closeSearch();
    } else {
      this.openSearch();
    }
  }

  /** Expande la cápsula y enfoca el input (la transición de ancho corre en CSS, ver .search-shell). */
  openSearch(): void {
    if (!this.canSearchClients()) {
      return;
    }
    if (!this.directory()) {
      void import('@core/customers/customer-directory.store').then(m =>
        this.directory.set(this.injector.get(m.CustomerDirectoryStore)),
      );
    }
    this.isSearchOpen.set(true);
    this.isNotificationsOpen.set(false);
    this.isUserMenuOpen.set(false);
    // El input tiene tabindex -1 mientras está plegado: se enfoca en el siguiente frame, ya abierto.
    requestAnimationFrame(() => this.searchInput?.nativeElement.focus({ preventScroll: true }));
  }

  /** Escape o la lupa con el buscador abierto: limpia y pliega. */
  closeSearch(): void {
    this.clearSearch();
    this.isSearchOpen.set(false);
    this.searchInput?.nativeElement.blur();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchTerm$.next('');
    this.searchResults.set([]);
    this.searchTotal.set(0);
    this.searchError.set(false);
    this.activeResultIndex.set(0);
  }

  selectCustomer(customer: CustomerSummary): void {
    this.directory()?.addRecent(customer);
    this.closeSearch();
    void this.router.navigate(['/clients', customer.id]);
  }

  /** Ver todos: el directorio de /clients con el mismo término ya escrito. */
  openClientDirectory(): void {
    const term = this.searchQuery().trim();
    this.closeSearch();
    void this.router.navigate(['/clients'], term ? { queryParams: { term } } : {});
  }
}
