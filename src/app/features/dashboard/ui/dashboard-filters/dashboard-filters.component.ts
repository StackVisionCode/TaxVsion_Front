import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Filter bar rendered above the dashboard widgets: a preparer selector
 * (owners only), a start/end date range, and applied-filter chips. The
 * preparer list is a static local mock — no UserManagementService call.
 * `filtersApplied` and `preparerSelected` stay real Outputs; they simply
 * aren't wired to a parent/backend yet.
 */
interface DashboardPreparer {
  id: string;
  name: string;
  lastName: string;
  email: string;
}

interface DashboardFilters {
  clientId: string;
  startDate: string;
  endDate: string;
}

@Component({
  selector: 'app-dashboard-filters',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-filters.component.html',
  styleUrl: './dashboard-filters.component.scss',
})
export class DashboardFiltersComponent {
  @Input() isOwner = true;
  @Input() currentUserId = '';

  @Output() filtersApplied = new EventEmitter<DashboardFilters>();
  @Output() preparerSelected = new EventEmitter<string>();

  readonly users = signal<DashboardPreparer[]>([
    { id: 'u-1', name: 'Emily', lastName: 'Carter', email: 'emily.carter@taxvision.com' },
    { id: 'u-2', name: 'Marcus', lastName: 'Nguyen', email: 'marcus.nguyen@taxvision.com' },
    { id: 'u-3', name: 'Sofia', lastName: 'Ramirez', email: 'sofia.ramirez@taxvision.com' },
    { id: 'u-4', name: 'David', lastName: 'Kim', email: 'david.kim@taxvision.com' },
    { id: 'u-5', name: 'Priya', lastName: 'Patel', email: 'priya.patel@taxvision.com' },
  ]);

  readonly selectedClientId = signal('');
  readonly startDate = signal('');
  readonly endDate = signal('');

  readonly filteredUsers = computed(() => {
    if (this.isOwner && this.currentUserId) {
      return this.users().filter(user => user.id !== this.currentUserId);
    }
    return this.users();
  });

  readonly hasActiveFilters = computed(() => {
    if (this.isOwner) {
      return !!(this.selectedClientId() || this.startDate() || this.endDate());
    }
    return !!(this.startDate() || this.endDate());
  });

  onClientChange(clientId: string): void {
    this.selectedClientId.set(clientId);

    if (this.isOwner) {
      this.preparerSelected.emit(clientId);
    } else {
      this.emitFilters();
    }
  }

  onStartDateChange(date: string): void {
    this.startDate.set(date);
    this.emitFilters();
  }

  onEndDateChange(date: string): void {
    this.endDate.set(date);
    this.emitFilters();
  }

  applyFilters(): void {
    this.emitFilters();
  }

  clearAllFilters(): void {
    this.selectedClientId.set('');
    this.startDate.set('');
    this.endDate.set('');

    if (this.isOwner) {
      this.preparerSelected.emit('');
    }

    this.emitFilters();
  }

  clearClientFilter(): void {
    this.selectedClientId.set('');

    if (this.isOwner) {
      this.preparerSelected.emit('');
    }

    this.emitFilters();
  }

  clearStartDateFilter(): void {
    this.startDate.set('');
    this.emitFilters();
  }

  clearEndDateFilter(): void {
    this.endDate.set('');
    this.emitFilters();
  }

  getSelectedClientName(): string {
    const selectedUser = this.users().find(user => user.id === this.selectedClientId());
    return selectedUser
      ? `${selectedUser.name || ''} ${selectedUser.lastName || ''}`.trim() || selectedUser.email
      : '';
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-US');
  }

  private emitFilters(): void {
    if (!this.isOwner) {
      this.filtersApplied.emit({
        clientId: this.selectedClientId(),
        startDate: this.startDate(),
        endDate: this.endDate(),
      });
    }
  }
}
