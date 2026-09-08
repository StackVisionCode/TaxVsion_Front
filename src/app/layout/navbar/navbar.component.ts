import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { AuthService } from '@core/auth/auth.service';
import { NotificationsStore } from '@features/notifications/data-access/notifications.store';
import { AppNotification, NotificationType } from '@features/notifications/ui/notification-list/notification-list.component';
import {
  notificationIcon,
  notificationIconBg,
  notificationIconText,
} from '@features/notifications/data-access/notifications.model';

/**
 * Visual port of the production navbar. El usuario del menú viene de
 * AuthService.currentUser() (GET /auth/me); notifications y customer search
 * results siguen siendo datos locales de muestra. Search filtering es real
 * (computed) así la UI se siente interactiva aunque no toque backend. La
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

interface NavbarCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  ssnOrItin: string;
}

@Component({
  selector: 'app-navbar',
  imports: [CommonModule, RouterModule, FormsModule, SidebarComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css',
})
export class NavbarComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly notificationsStore = inject(NotificationsStore);

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
  readonly notifications = this.notificationsStore.recent;
  readonly notificationCount = this.notificationsStore.unreadCount;
  readonly hasNotifications = computed(() => this.notifications().length > 0);
  readonly hasUnread = computed(() => this.notificationCount() > 0);

  // Static customer directory used for the local search demo
  private readonly customers: NavbarCustomer[] = [
    { id: 'c1', firstName: 'Maria', lastName: 'Gonzalez', email: 'maria.gonzalez@example.com', ssnOrItin: '***-**-4821' },
    { id: 'c2', firstName: 'David', lastName: 'Chen', email: 'david.chen@example.com', ssnOrItin: '***-**-1076' },
    { id: 'c3', firstName: 'Sarah', lastName: 'Kim', email: 'sarah.kim@example.com', ssnOrItin: '***-**-2938' },
    { id: 'c4', firstName: 'Alvarez Family Trust', lastName: '', email: 'contact@alvarezfamily.com', ssnOrItin: '**-***4455' },
  ];

  readonly searchQuery = signal('');
  private readonly searchFocused = signal(false);

  readonly searchResults = computed<NavbarCustomer[]>(() => {
    const term = this.searchQuery().trim().toLowerCase();
    if (!term) {
      return [];
    }
    return this.customers
      .filter(customer => {
        const firstName = customer.firstName.toLowerCase();
        const lastName = customer.lastName.toLowerCase();
        const email = customer.email.toLowerCase();
        const ssnOrItin = customer.ssnOrItin.toLowerCase();
        return (
          firstName.includes(term) ||
          lastName.includes(term) ||
          email.includes(term) ||
          ssnOrItin.includes(term)
        );
      })
      .slice(0, 10);
  });

  readonly isSearchDropdownOpen = computed(() => this.searchFocused() && this.searchQuery().trim().length > 0);

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

    if (!isUserDropdown && this.isUserMenuOpen()) {
      this.isUserMenuOpen.set(false);
    }
    if (!isNotificationsDropdown && this.isNotificationsOpen()) {
      this.isNotificationsOpen.set(false);
    }
  }

  // Cmd+F / Ctrl+F focuses the command-style search (reference behavior).
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.searchInput?.nativeElement.focus();
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

  logout(): void {
    this.isUserMenuOpen.set(false);
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }

  // ==========================================
  // Notifications
  // ==========================================

  toggleNotifications(): void {
    this.isNotificationsOpen.update(open => !open);
    this.isUserMenuOpen.set(false);
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
    this.notificationsStore.markRead(notificationId);
  }

  markAllAsRead(): void {
    this.notificationsStore.markAllRead();
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
  }

  onSearchFocus(): void {
    this.searchFocused.set(true);
  }

  onSearchBlur(): void {
    setTimeout(() => this.searchFocused.set(false), 200);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchFocused.set(false);
  }

  selectCustomer(customer: NavbarCustomer): void {
    this.clearSearch();
    this.router.navigate(['/app/customers', customer.id]);
  }

  getCustomerFullName(customer: NavbarCustomer): string {
    const fullName = `${customer.firstName} ${customer.lastName}`.trim();
    return fullName || customer.email || 'Unnamed client';
  }

  getCustomerInitials(customer: NavbarCustomer): string {
    if (customer.firstName && customer.lastName) {
      return `${customer.firstName.charAt(0)}${customer.lastName.charAt(0)}`.toUpperCase();
    }
    if (customer.firstName) {
      return customer.firstName.charAt(0).toUpperCase();
    }
    if (customer.lastName) {
      return customer.lastName.charAt(0).toUpperCase();
    }
    if (customer.email) {
      return customer.email.charAt(0).toUpperCase();
    }
    return 'C';
  }

  trackByCustomer(index: number, customer: NavbarCustomer): string {
    return customer.id;
  }
}
