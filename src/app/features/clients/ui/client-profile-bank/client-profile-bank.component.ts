import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

interface BankStatement {
  id: string;
  name: string;
  description: string;
  /** ISO date string (YYYY-MM-DD). */
  createdAt: string;
  /** ISO date string (YYYY-MM-DD). */
  updatedAt: string;
}

const PAGE_SIZE = 6;

const MOCK_STATEMENTS: BankStatement[] = [
  { id: 'stmt-1', name: 'Chase Business •••1234', description: 'Jan 1, 2026 – Mar 31, 2026', createdAt: '2026-04-02', updatedAt: '2026-04-02' },
  { id: 'stmt-2', name: 'Chase Business •••1234', description: 'Oct 1, 2025 – Dec 31, 2025', createdAt: '2026-01-05', updatedAt: '2026-01-05' },
  { id: 'stmt-3', name: 'Bank of America •••9087', description: 'Jul 1, 2025 – Sep 30, 2025', createdAt: '2025-10-03', updatedAt: '2025-10-10' },
  { id: 'stmt-4', name: 'Bank of America •••9087', description: 'Apr 1, 2025 – Jun 30, 2025', createdAt: '2025-07-06', updatedAt: '2025-07-06' },
  { id: 'stmt-5', name: 'Chase Business •••1234', description: 'Jan 1, 2025 – Mar 31, 2025', createdAt: '2025-04-04', updatedAt: '2025-04-04' },
  { id: 'stmt-6', name: 'Wells Fargo •••5521', description: 'Oct 1, 2024 – Dec 31, 2024', createdAt: '2025-01-08', updatedAt: '2025-01-08' },
];

/**
 * Pestaña "Bank" del perfil de cliente (puerto visual/estructural de
 * `cuenta-banco`): el legacy es un gestor de extractos bancarios en PDF con
 * parseo automático, no un formulario de cuenta bancaria. Aquí se simplifica
 * a una tabla mock de extractos con alta manual (nombre/periodo, sin file
 * picker real), selección bulk y borrado individual/bulk. Load/Export quedan
 * como botones visuales pero inertes (sin backend de parseo/export real).
 */
@Component({
  selector: 'app-client-profile-bank',
  imports: [CommonModule, FormsModule, ModalComponent, ConfirmDialogComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-bank.component.html',
})
export class ClientProfileBankComponent {
  @Input() clientId = '';

  readonly pageSize = PAGE_SIZE;

  readonly statements = signal<BankStatement[]>([...MOCK_STATEMENTS]);
  readonly search = signal('');
  readonly currentPage = signal(1);
  readonly selectedIds = signal<Set<string>>(new Set());

  readonly visibleStatements = computed<BankStatement[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.statements();
    }
    return this.statements().filter(
      statement => statement.name.toLowerCase().includes(query) || statement.description.toLowerCase().includes(query),
    );
  });

  readonly pagedStatements = computed<BankStatement[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleStatements().slice(start, start + PAGE_SIZE);
  });

  readonly allVisibleSelected = computed(() => {
    const visible = this.visibleStatements();
    return visible.length > 0 && visible.every(statement => this.selectedIds().has(statement.id));
  });

  // Add form
  readonly isAddModalOpen = signal(false);
  readonly addName = signal('');
  readonly addDescription = signal('');
  readonly canSaveAdd = computed(() => this.addName().trim().length > 0);

  // Delete (single row id or bulk ids)
  readonly pendingDeleteIds = signal<string[] | null>(null);
  readonly pendingDeleteMessage = computed(() => {
    const ids = this.pendingDeleteIds();
    if (!ids) {
      return '';
    }
    if (ids.length === 1) {
      const statement = this.statements().find(item => item.id === ids[0]);
      return statement ? `You're about to delete "${statement.name}" (${statement.description}). This can't be undone.` : '';
    }
    return `You're about to delete ${ids.length} statements. This can't be undone.`;
  });

  setSearch(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  toggleSelected(id: string): void {
    this.selectedIds.update(ids => {
      const next = new Set(ids);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  toggleSelectAllVisible(): void {
    const visible = this.visibleStatements();
    const allSelected = this.allVisibleSelected();
    this.selectedIds.update(ids => {
      const next = new Set(ids);
      visible.forEach(statement => {
        if (allSelected) {
          next.delete(statement.id);
        } else {
          next.add(statement.id);
        }
      });
      return next;
    });
  }

  openAddModal(): void {
    this.addName.set('');
    this.addDescription.set('');
    this.isAddModalOpen.set(true);
  }

  closeAddModal(): void {
    this.isAddModalOpen.set(false);
  }

  saveAdd(): void {
    if (!this.canSaveAdd()) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const statement: BankStatement = {
      id: `stmt-${Date.now()}`,
      name: this.addName().trim(),
      description: this.addDescription().trim() || 'Statement period not specified',
      createdAt: today,
      updatedAt: today,
    };
    this.statements.update(list => [statement, ...list]);
    this.closeAddModal();
  }

  requestDelete(id: string): void {
    this.pendingDeleteIds.set([id]);
  }

  requestBulkDelete(): void {
    if (this.selectedIds().size === 0) {
      return;
    }
    this.pendingDeleteIds.set([...this.selectedIds()]);
  }

  confirmDelete(): void {
    const ids = this.pendingDeleteIds();
    if (!ids) {
      return;
    }
    const idSet = new Set(ids);
    this.statements.update(list => list.filter(statement => !idSet.has(statement.id)));
    this.selectedIds.update(current => {
      const next = new Set(current);
      idSet.forEach(id => next.delete(id));
      return next;
    });
    this.pendingDeleteIds.set(null);
  }
}
