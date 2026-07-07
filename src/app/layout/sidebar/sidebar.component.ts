import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { MenuItem, SubMenuItem } from '../../shared/models/menu-item.interface';

/**
 * Visual port of the production sidebar. Role/permission-based menu
 * filtering (AuthorizationService/AppRole) and the onboarding product tour
 * (TourService/AppTourStep) were removed entirely -- there is no auth system
 * or tour engine yet, so every menu item is shown unconditionally. Submenu
 * expand/collapse is kept as local UI state (pure signals, no backend)
 * even though none of the current placeholder items use a submenu, since
 * the original component supports it and future menu items might.
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

  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();
  private bodyTooltipEl: HTMLDivElement | null = null;

  readonly isExpanded = signal(false);
  private readonly navigationInProgress = signal(false);

  /** Posición/tamaño del pill deslizante que resalta el ítem activo del sidebar. */
  readonly indicatorTop = signal(0);
  readonly indicatorLeft = signal(0);
  readonly indicatorWidth = signal(0);
  readonly indicatorHeight = signal(0);
  readonly indicatorReady = signal(false);

  readonly menuItems = signal<MenuItem[]>([
    { label: 'Dashboard', icon: 'grid-outline', route: '/dashboard', isActive: false },
    { label: 'Mail', icon: 'mail-outline', route: '/email' },
    { label: 'Task', icon: 'checkmark-done-outline', route: '/task' },
    { label: 'Clients', icon: 'people-outline', route: '/clients' },
    { label: 'Documents', icon: 'document-text-outline', route: '/documents' },
    { label: 'Invoices', icon: 'receipt-outline', route: '/invoices' },
    { label: 'Products/Services', icon: 'barcode-outline', route: '/products-services' },
    { label: 'Signature', icon: 'pencil-outline', route: '/signature' },
    { label: 'Chat', icon: 'chatbubbles-outline', route: '/chat' },
    { label: 'Meetings', icon: 'videocam-outline', route: '/meetings' },
    { label: 'Support', icon: 'headset-outline', route: '/support' },
    { label: 'Campaigns', icon: 'megaphone-outline', route: '/campaigns' },
    { label: 'AI', icon: 'sparkles-outline', route: '/ai-assistant', isSpecial: true },
    { label: 'Settings', icon: 'settings-outline', route: '/settings' },
  ]);

  ngOnInit(): void {
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
    // On desktop, start expanded once the layout has settled.
    setTimeout(() => {
      if (!this.isMobile && !this.isExpanded()) {
        this.isExpanded.set(true);
        this.sidebarStateChange.emit(true);
      }
      this.syncIndicator();
      // The expand toggle above changes each row's width/padding classes;
      // Angular needs its own render tick before getBoundingClientRect()
      // reflects that, so re-measure once more right after it settles
      // (same reasoning as the toggleSidebar() re-sync below).
      setTimeout(() => this.syncIndicator(), 220);
    });

    // Re-sync if the menu list itself ever changes shape.
    this.itemButtons?.changes.pipe(takeUntil(this.destroy$)).subscribe(() => this.syncIndicator());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    if (this.bodyTooltipEl && document.body.contains(this.bodyTooltipEl)) {
      document.body.removeChild(this.bodyTooltipEl);
      this.bodyTooltipEl = null;
    }
  }

  canShowItem(_item: MenuItem): boolean {
    // No role/permission system yet -- every item is always visible.
    return true;
  }

  canShowSubItem(_subItem: SubMenuItem): boolean {
    return true;
  }

  onMenuItemMouseEnter(event: MouseEvent, item: MenuItem): void {
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
        backgroundColor: '#111827',
        color: '#fff',
        padding: '6px 12px',
        borderRadius: '9999px',
        fontSize: '13px',
        fontWeight: '500',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: String(2147483647),
        boxShadow:
          '0 10px 15px -3px rgba(17,24,39,0.25), 0 4px 6px -4px rgba(17,24,39,0.2)',
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

    // The sidebar's own width animates (transition-all duration-200), which shifts
    // where a centered collapsed button ends up -- re-sync once immediately and
    // again after that transition settles so the pill lands in the right spot.
    setTimeout(() => this.syncIndicator());
    setTimeout(() => this.syncIndicator(), 220);
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

    const activeIndex = this.menuItems().findIndex((item) => item.isActive);
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
