import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SidebarComponent } from '../sidebar/sidebar.component';

/**
 * Visual port of the production navbar. No real services are wired in:
 * the user, notifications and customer search results are local sample
 * data held in signals. Search filtering is real (computed) so the UI
 * still feels interactive, but nothing ever touches a backend. The
 * notifications bell opens a local dropdown panel, not a modal service.
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

interface NavbarNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
  icon: string;
  isRead: boolean;
  priority?: 2 | 3;
}

interface NavbarCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  ssnOrItin: string;
}

interface NavbarLanguage {
  code: string;
  label: string;
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

  // Dropdown / panel visibility
  readonly isLanguageOpen = signal(false);
  readonly isUserMenuOpen = signal(false);
  readonly isMobileMenuOpen = signal(false);
  readonly isNotificationsOpen = signal(false);
  readonly isTaxProDropdownOpen = signal(false);

  // Static "logged in" user placeholder
  readonly user = signal<NavbarUser>({
    name: 'Jordan',
    lastName: 'Reyes',
    fullName: 'Jordan Reyes',
    companyName: 'Reyes Tax & Accounting',
    email: 'jordan.reyes@taxvision.com',
    avatarUrl: null,
    isOwner: true,
    role: 'Administrator',
  });

  // Static notifications feed
  readonly notifications = signal<NavbarNotification[]>([
    {
      id: 'n1',
      title: 'New invoice signed',
      message: 'Maria Gonzalez signed invoice #1042 for tax year 2025.',
      time: '5m ago',
      type: 'success',
      icon: 'checkmark-done-outline',
      isRead: false,
    },
    {
      id: 'n2',
      title: 'Task assigned to you',
      message: 'Review W-2 documents for the Alvarez family before Friday.',
      time: '38m ago',
      type: 'info',
      icon: 'clipboard-outline',
      isRead: false,
      priority: 2,
    },
    {
      id: 'n3',
      title: 'Payment received',
      message: '$450.00 payment received from David Chen.',
      time: '2h ago',
      type: 'success',
      icon: 'cash-outline',
      isRead: true,
    },
    {
      id: 'n4',
      title: 'Payment failed',
      message: 'Card payment from Sarah Kim could not be processed.',
      time: '1d ago',
      type: 'error',
      icon: 'alert-circle-outline',
      isRead: true,
      priority: 3,
    },
  ]);

  readonly notificationCount = computed(() => this.notifications().filter(n => !n.isRead).length);
  readonly hasNotifications = computed(() => this.notifications().length > 0);
  readonly hasReadNotifications = computed(() => this.notifications().some(n => n.isRead));

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

  // Static language options (visual only, no i18n library wired up)
  readonly languages: NavbarLanguage[] = [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'English' },
    { code: 'pt', label: 'Português' },
    { code: 'fr', label: 'Français' },
  ];

  readonly currentLanguage = signal('EN');

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
    const isLanguageDropdown = target.closest('[data-dropdown="language"]');
    const isUserDropdown = target.closest('[data-dropdown="user"]');
    const isNotificationsDropdown = target.closest('[data-dropdown="notifications"]');
    const isTaxProDropdown = target.closest('.relative');

    if (!isLanguageDropdown && this.isLanguageOpen()) {
      this.isLanguageOpen.set(false);
    }
    if (!isUserDropdown && this.isUserMenuOpen()) {
      this.isUserMenuOpen.set(false);
    }
    if (!isNotificationsDropdown && this.isNotificationsOpen()) {
      this.isNotificationsOpen.set(false);
    }
    if (!isTaxProDropdown && this.isTaxProDropdownOpen()) {
      this.isTaxProDropdownOpen.set(false);
    }
  }

  // ==========================================
  // Language selector
  // ==========================================

  toggleLanguage(): void {
    this.isLanguageOpen.update(open => !open);
    this.isUserMenuOpen.set(false);
    this.isNotificationsOpen.set(false);
  }

  selectLanguage(lang: NavbarLanguage): void {
    this.currentLanguage.set(lang.code.toUpperCase());
    this.isLanguageOpen.set(false);
  }

  // ==========================================
  // User menu
  // ==========================================

  toggleUserMenu(): void {
    this.isUserMenuOpen.update(open => !open);
    this.isLanguageOpen.set(false);
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

  getUserDisplayName(): string {
    const u = this.user();
    const companyName = this.getCompanyName();
    const taxUserName = this.getTaxUserFullName();

    if (companyName && taxUserName) {
      return `${companyName} · ${taxUserName}`;
    }
    return companyName || taxUserName || u.email;
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
    this.router.navigate(['/login']);
  }

  // ==========================================
  // Notifications
  // ==========================================

  toggleNotifications(): void {
    this.isNotificationsOpen.update(open => !open);
    this.isLanguageOpen.set(false);
    this.isUserMenuOpen.set(false);
    this.isTaxProDropdownOpen.set(false);
  }

  getNotificationTypeColor(type: NavbarNotification['type']): string {
    switch (type) {
      case 'info':
        return 'text-blue-600';
      case 'success':
        return 'text-green-600';
      case 'warning':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  }

  getNotificationBgColor(type: NavbarNotification['type']): string {
    switch (type) {
      case 'info':
        return 'bg-blue-50 border-blue-200';
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  }

  trackByNotificationId(index: number, notification: NavbarNotification): string {
    return notification.id;
  }

  markAsRead(notificationId: string, event?: Event): void {
    event?.stopPropagation();
    this.notifications.update(list =>
      list.map(n => (n.id === notificationId ? { ...n, isRead: true } : n))
    );
  }

  markAllAsRead(): void {
    this.notifications.update(list => list.map(n => ({ ...n, isRead: true })));
  }

  deleteNotification(notificationId: string, event?: Event): void {
    event?.stopPropagation();
    this.notifications.update(list => list.filter(n => n.id !== notificationId));
  }

  deleteAllRead(): void {
    this.notifications.update(list => list.filter(n => !n.isRead));
  }

  clearAllNotifications(): void {
    this.notifications.set([]);
    this.isNotificationsOpen.set(false);
  }

  navigateToNotificationCenter(): void {
    this.isNotificationsOpen.set(false);
    this.router.navigate(['/app/notifications']);
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
