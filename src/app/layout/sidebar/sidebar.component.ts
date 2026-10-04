import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { MenuItem, SubMenuItem } from '../../shared/models/menu-item.interface';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { AccessStore } from '@core/access/access.store';
import { PacedPreloadStrategy } from '@core/performance/paced-preload.strategy';
import type { ChatStore } from '@features/chat/data-access/chat.store';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_FALLBACK_WIDTH, sidebarExpandedWidth } from './sidebar-width.util';

/**
 * El menu del CRM. Cada entrada declara QUE feature es (`featureId`) y el registro
 * `core/access/features` dice que modulo del plan y que permissions hacen falta; quien contesta es
 * el `AccessStore`. Acá solo viven el orden, la etiqueta y el icono.
 *
 * Antes la lista se mostraba entera y sin condiciones, con una sola excepcion escrita a mano
 * (`requiredPermissions` en SMS). El resultado era el caso 4 del Anexo C: el empleado veia Meetings
 * en el menu, entraba, y recien ahi el backend le contestaba 403.
 *
 * El submenu se conserva como estado local de UI aunque hoy ninguna entrada lo use.
 */
@Component({
  selector: 'app-sidebar',
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
})
export class SidebarComponent implements OnInit, OnDestroy, AfterViewInit {
  @Output() sidebarStateChange = new EventEmitter<boolean>();
  @Input() isMobile = false;

  @ViewChild('listContainer') private listContainerRef?: ElementRef<HTMLElement>;
  @ViewChildren('itemButton') private itemButtons?: QueryList<ElementRef<HTMLElement>>;
  @ViewChildren('itemLabel') private itemLabels?: QueryList<ElementRef<HTMLElement>>;

  private readonly router = inject(Router);
  private readonly branding = inject(TenantBrandingService);
  /**
   * El store del chat (y su servicio/directorio) no viaja en el bundle inicial: se descarga tras el
   * primer render y hasta entonces el badge simplemente no se muestra.
   */
  private readonly chatStore = signal<ChatStore | null>(null);
  private readonly injector = inject(Injector);
  private readonly preloadStrategy = inject(PacedPreloadStrategy);
  private readonly access = inject(AccessStore);
  private readonly destroy$ = new Subject<void>();

  /** Refleja los no-leídos del chat en el badge del item Chat (en vivo). */
  private readonly chatBadgeEffect = effect(() => {
    const unread = this.chatStore()?.totalUnread() ?? 0;
    this.menuItems.update(items =>
      items.map(item => (item.route === '/chat' ? { ...item, badge: unread > 0 ? unread : undefined } : item)),
    );
  });

  /** Logo del tenant (o null → cae al asterisco de marca). */
  readonly logoUrl = this.branding.logoUrl;
  protected readonly showLogoFallback = signal(false);

  /**
   * Marca del sidebar colapsado (ancho 64px). Se prefiere el favicon: es el
   * asset cuadrado del tenant y aguanta el tamaño chico sin verse borroso,
   * mientras que un logo horizontal encogido a 40px queda diminuto. Si el
   * tenant no subió favicon se usa el logo, y recién sin ninguno de los dos
   * queda el asterisco de siempre.
   */
  protected readonly collapsedMarkUrl = computed(() => {
    const favicon = this.faviconFailed() ? null : this.branding.faviconUrl();
    return favicon ?? this.branding.logoUrl();
  });
  /** El favicon no cargó (p. ej. un .ico que el navegador no pinta en un <img>). */
  private readonly faviconFailed = signal(false);
  /** Ya no queda ninguna imagen que probar: se muestra el asterisco. */
  protected readonly showMarkFallback = signal(false);

  /**
   * Fallback encadenado favicon → logo → asterisco. Sin el paso intermedio, un
   * favicon que el navegador no sabe pintar dejaría el asterisco aunque el
   * tenant tenga un logo perfectamente válido.
   */
  protected onMarkError(): void {
    if (!this.faviconFailed() && this.branding.faviconUrl() && this.branding.logoUrl()) {
      this.faviconFailed.set(true);
      return;
    }
    this.showMarkFallback.set(true);
  }
  private bodyTooltipEl: HTMLDivElement | null = null;

  readonly isExpanded = signal(false);
  private readonly navigationInProgress = signal(false);

  /** Posición/tamaño del pill deslizante que resalta el ítem activo del sidebar. */
  readonly indicatorTop = signal(0);
  readonly indicatorLeft = signal(0);
  readonly indicatorWidth = signal(0);
  readonly indicatorHeight = signal(0);
  readonly indicatorReady = signal(false);

  /**
   * Ancho del sidebar expandido: se ajusta al nombre más largo del menú (antes era un `w-64` fijo que
   * dejaba una franja vacía). Se mide con los labels visibles; colapsado se conserva el último valor.
   */
  readonly expandedWidth = signal(SIDEBAR_FALLBACK_WIDTH);
  readonly currentWidth = computed(() => (this.isExpanded() ? this.expandedWidth() : SIDEBAR_COLLAPSED_WIDTH));
  /** Re-sincroniza el pill con cualquier cambio de tamaño de la lista (resize, zoom del navegador, ancho). */
  private listResizeObserver: ResizeObserver | null = null;

  readonly menuItems = signal<MenuItem[]>([
    { label: 'Dashboard', icon: 'speedometer-outline', route: '/dashboard', featureId: 'dashboard', isActive: false },
    { label: 'Mail', icon: 'mail-outline', route: '/email', featureId: 'email' },
    { label: 'Task', icon: 'checkmark-done-outline', route: '/task', featureId: 'task' },
    { label: 'Clients', icon: 'people-outline', route: '/clients', featureId: 'clients' },
    { label: 'Documents', icon: 'document-text-outline', route: '/documents', featureId: 'documents' },
    { label: 'Billing', icon: 'receipt-outline', route: '/billing', featureId: 'billing' },
    { label: 'Products/Services', icon: 'pricetags-outline', route: '/products-services', featureId: 'catalog' },
    { label: 'Inventory', icon: 'cube-outline', route: '/inventory', featureId: 'inventory' },
    { label: 'Signature', icon: 'create-outline', route: '/signature', featureId: 'signature' },
    { label: 'SMS', icon: 'chatbox-ellipses-outline', route: '/sms', featureId: 'sms' },
    { label: 'Chat', icon: 'chatbubbles-outline', route: '/chat', featureId: 'chat' },
    { label: 'Meetings', icon: 'videocam-outline', route: '/meetings', featureId: 'meetings' },
    { label: 'Support', icon: 'headset-outline', route: '/support', featureId: 'support' },
    { label: 'Campaigns', icon: 'megaphone-outline', route: '/campaigns', featureId: 'campaigns' },
    { label: 'AI', icon: 'sparkles-outline', route: '/ai-assistant', featureId: 'ai-assistant', isSpecial: true },
    { label: 'Workflow', icon: 'git-network-outline', route: '/workflow', featureId: 'workflow' },
    // Gestión de usuarios de la oficina: antes vivía en el menú del avatar.
    { label: 'Users', icon: 'person-circle-outline', route: '/company/users', featureId: 'users' },
    { label: 'Settings', icon: 'settings-outline', route: '/settings', featureId: 'settings' },
  ]);

  /**
   * Lo que se pinta. Es un `computed`, asi que cuando el bootstrap de acceso llega el menu se
   * reacomoda solo, sin recargar la pagina.
   *
   * El filtro se hace ACA y no con un `*ngIf` dentro del `*ngFor`: con el `*ngIf`, la lista de
   * botones del DOM quedaba mas corta que `menuItems()` y el pill deslizante, que busca el indice
   * en la lista completa, se posaba sobre la fila equivocada en cuanto se ocultaba una entrada.
   */
  readonly visibleItems = computed(() => this.menuItems().filter(item => this.canShowItem(item)));

  ngOnInit(): void {
    // La sidebar arranca YA en su estado final. Antes se expandía en un setTimeout DESPUÉS
    // del primer render, así que en cada carga se veía colapsada y "saltaba" a ancha.
    // `isMobile` es un @Input, y los inputs ya están resueltos cuando corre ngOnInit.
    const expanded = !this.isMobile;
    if (this.isExpanded() !== expanded) {
      this.isExpanded.set(expanded);
      this.sidebarStateChange.emit(expanded);
    }

    this.updateActiveState(this.router.url);

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        this.updateActiveState(event.url);
        setTimeout(() => this.syncIndicator());
      });
  }

  ngAfterViewInit(): void {
    // Una sola medición, después del render real. Antes había dos setTimeout anidados
    // (+220 ms) porque el estado expandido se aplicaba tarde y cambiaba el ancho de las
    // filas; ahora el ancho ya es el definitivo en el primer render y basta con medir una
    // vez, sin la ventana en la que el pill quedaba fuera de sitio.
    afterNextRender(
      () => {
        void import('@features/chat/data-access/chat.store').then(m =>
          this.chatStore.set(this.injector.get(m.ChatStore)),
        );
        this.measureWidth();
        this.syncIndicator();
        this.observeListSize();
        // La fuente web cambia el ancho del texto cuando termina de cargar.
        void document.fonts?.ready.then(() => this.measureWidth());
      },
      { injector: this.injector },
    );

    // Re-sync if the menu list itself ever changes shape (permisos/módulos que muestran u ocultan entradas).
    this.itemButtons?.changes.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.measureWidth();
      this.syncIndicator();
    });
  }

  /** Recalcula el ancho expandido con el ancho natural de cada label (`scrollWidth` ignora el truncate). */
  private measureWidth(): void {
    if (!this.isExpanded()) {
      return;
    }
    const widths = this.itemLabels?.map(label => label.nativeElement.scrollWidth) ?? [];
    if (widths.length > 0) {
      this.expandedWidth.set(sidebarExpandedWidth(widths));
    }
  }

  private observeListSize(): void {
    const container = this.listContainerRef?.nativeElement;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.listResizeObserver = new ResizeObserver(() => this.syncIndicator());
    this.listResizeObserver.observe(container);
  }

  /** Terminó la animación de ancho (expandir/colapsar): el pill se posa en la fila ya asentada. */
  onSidebarTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName === 'width') {
      this.measureWidth();
      this.syncIndicator();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.listResizeObserver?.disconnect();
    this.listResizeObserver = null;

    if (this.bodyTooltipEl && document.body.contains(this.bodyTooltipEl)) {
      document.body.removeChild(this.bodyTooltipEl);
      this.bodyTooltipEl = null;
    }
  }

  canShowItem(item: MenuItem): boolean {
    return this.access.canUseId(item.featureId);
  }

  canShowSubItem(subItem: SubMenuItem): boolean {
    return this.access.canUseId(subItem.featureId);
  }

  /**
   * Mismo prefetch por teclado: llegar a un ítem con Tab es tan buena señal de intención
   * como el hover, y la navegación accesible no debería pagar más lento que la del mouse.
   */
  onMenuItemFocus(item: MenuItem): void {
    this.prefetchRoute(item);
  }

  private prefetchRoute(item: MenuItem): void {
    if (item.route) {
      this.preloadStrategy.prefetchPath(item.route);
    }
  }

  onMenuItemMouseEnter(event: MouseEvent, item: MenuItem): void {
    // Intención de navegar: se precarga el chunk de la sección mientras el cursor viaja
    // hasta el clic (200-400 ms de regalo). Va ANTES del early-return del tooltip, que solo
    // aplica al sidebar colapsado. Solo hace algo con las secciones excluidas del preloading
    // pausado (signature, meetings, checkout); el resto ya está en memoria para entonces.
    this.prefetchRoute(item);

    if (this.isExpanded()) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = Math.round(rect.right + 8);
    const y = Math.round(rect.top + rect.height / 2);

    if (!this.bodyTooltipEl) {
      this.bodyTooltipEl = document.createElement('div');
      this.bodyTooltipEl.setAttribute('role', 'tooltip');
      Object.assign(this.bodyTooltipEl.style, {
        position: 'fixed',
        backgroundColor: 'rgb(var(--color-gray-900-rgb, 13 13 13))',
        color: '#fff',
        padding: '6px 12px',
        borderRadius: '9999px',
        fontSize: '13px',
        fontWeight: '500',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: String(2147483647),
        boxShadow: '0 10px 15px -3px rgba(17,24,39,0.25), 0 4px 6px -4px rgba(17,24,39,0.2)',
        transition: 'opacity 150ms ease, transform 150ms ease',
      } as CSSStyleDeclaration);
      document.body.appendChild(this.bodyTooltipEl);
    }

    this.bodyTooltipEl.textContent = item.label;
    this.bodyTooltipEl.style.left = `${x}px`;
    this.bodyTooltipEl.style.top = `${y}px`;
    this.bodyTooltipEl.style.transform = 'translateY(-50%) scale(1)';
    this.bodyTooltipEl.style.opacity = '1';
  }

  onMenuItemMouseLeave(_item: MenuItem): void {
    if (!this.bodyTooltipEl) return;

    this.bodyTooltipEl.style.opacity = '0';
    this.bodyTooltipEl.style.transform = 'translateY(-50%) scale(0.95)';

    const tooltip = this.bodyTooltipEl;
    this.bodyTooltipEl = null;

    setTimeout(() => {
      if (document.body.contains(tooltip)) {
        document.body.removeChild(tooltip);
      }
    }, 150);
  }

  toggleSidebar(): void {
    const next = !this.isExpanded();
    this.isExpanded.set(next);
    this.sidebarStateChange.emit(next);

    if (!next) {
      this.menuItems.update((items) => items.map((item) => ({ ...item, isOpen: false })));
    }

    // El ancho del sidebar anima: se sincroniza ya y otra vez en `onSidebarTransitionEnd`, cuando
    // la transición termina y la fila activa quedó en su sitio definitivo.
    setTimeout(() => this.syncIndicator());
  }

  handleMenuClick(event: MouseEvent, item: MenuItem): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.navigationInProgress()) return;

    if (!this.isExpanded() && item.hasSubmenu) {
      this.isExpanded.set(true);
      this.sidebarStateChange.emit(true);
      this.openSubmenu(item);
      return;
    }

    if (this.isExpanded() && item.hasSubmenu) {
      this.toggleSubmenu(item);
      return;
    }

    if (item.route) {
      this.performNavigation(item.route);
    }
  }

  private openSubmenu(item: MenuItem): void {
    this.menuItems.update((items) =>
      items.map((menuItem) => ({ ...menuItem, isOpen: menuItem === item })),
    );
  }

  toggleSubmenu(item: MenuItem): void {
    if (!item.hasSubmenu) return;

    const willOpen = !item.isOpen;
    this.menuItems.update((items) =>
      items.map((menuItem) => {
        if (menuItem === item) {
          return { ...menuItem, isOpen: willOpen };
        }
        return willOpen && menuItem.hasSubmenu ? { ...menuItem, isOpen: false } : menuItem;
      }),
    );
  }

  handleSubmenuClick(event: MouseEvent, route: string): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.navigationInProgress() || !route) return;

    this.performNavigation(route);
  }

  private performNavigation(route: string): void {
    if (this.router.url === route) return;

    this.navigationInProgress.set(true);
    this.router.navigateByUrl(route).finally(() => {
      this.navigationInProgress.set(false);
    });
  }

  private updateActiveState(url: string): void {
    const normalizedUrl = url.split('?')[0].split('#')[0];

    this.menuItems.update((items) => {
      let matchFound = false;

      const withSubmenuMatch = items.map((item) => {
        if (!item.submenu || item.submenu.length === 0 || matchFound) {
          return { ...item, isActive: false };
        }

        const activeSubItem = item.submenu.find((subItem) => {
          const normalizedRoute = subItem.route.split('?')[0].split('#')[0];
          return (
            normalizedUrl === normalizedRoute || normalizedUrl.startsWith(normalizedRoute + '/')
          );
        });

        if (activeSubItem) {
          matchFound = true;
          return { ...item, isActive: true, isOpen: true };
        }

        return { ...item, isActive: false };
      });

      if (matchFound) {
        return withSubmenuMatch;
      }

      return withSubmenuMatch.map((item) => {
        if (item.route && !item.hasSubmenu) {
          const normalizedRoute = item.route.split('?')[0].split('#')[0];
          if (
            normalizedUrl === normalizedRoute ||
            normalizedUrl.startsWith(normalizedRoute + '/')
          ) {
            return { ...item, isActive: true };
          }
        }
        return item;
      });
    });
  }

  /**
   * Mide la posición real del botón activo (vía getBoundingClientRect, no
   * offsetTop) para que el pill deslizante funcione sin importar el
   * contenedor posicionado intermedio de cada fila del *ngFor.
   */
  private syncIndicator(): void {
    const container = this.listContainerRef?.nativeElement;
    const buttons = this.itemButtons?.toArray();
    if (!container || !buttons?.length) {
      this.indicatorReady.set(false);
      return;
    }

    // Sobre la lista VISIBLE: es la que tiene un boton por fila en el DOM.
    const activeIndex = this.visibleItems().findIndex((item) => item.isActive);
    const activeButton = activeIndex >= 0 ? buttons[activeIndex]?.nativeElement : undefined;
    if (!activeButton) {
      this.indicatorReady.set(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();

    this.indicatorTop.set(buttonRect.top - containerRect.top + container.scrollTop);
    this.indicatorLeft.set(buttonRect.left - containerRect.left + container.scrollLeft);
    this.indicatorWidth.set(buttonRect.width);
    this.indicatorHeight.set(buttonRect.height);
    this.indicatorReady.set(true);
  }

  isClickable(): boolean {
    return !this.navigationInProgress();
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByRoute(index: number, item: MenuItem): string | number {
    return item.route || index;
  }
}
