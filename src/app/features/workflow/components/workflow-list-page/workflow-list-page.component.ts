import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { WorkflowLibraryService, WorkflowSummary } from '../../data-access/workflow-library.service';
import { WorkflowStore } from '../../data-access/workflow.store';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';

/**
 * Portada de Workflow: los workflows guardados, en tabla, antes de entrar al builder.
 *
 * Hasta ahora esta pantalla no existía y el módulo abría directo el editor sobre un único
 * documento guardado en una clave fija — renombrar no creaba otro, pisaba el que había.
 */
@Component({
  selector: 'app-workflow-list-page',
  imports: [ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-list-page.component.html',
})
export class WorkflowListPageComponent {
  private readonly library = inject(WorkflowLibraryService);
  private readonly store = inject(WorkflowStore);
  private readonly router = inject(Router);

  readonly search = signal('');
  readonly pendingDelete = signal<WorkflowSummary | null>(null);

  readonly items = computed(() => {
    const term = this.search().trim().toLowerCase();
    const all = this.library.items();
    return term ? all.filter(item => item.name.toLowerCase().includes(term)) : all;
  });

  readonly total = this.library.count;
  readonly filtering = computed(() => this.search().trim().length > 0);

  open(item: WorkflowSummary): void {
    void this.router.navigate(['/workflow', item.id]);
  }

  create(): void {
    void this.router.navigate(['/workflow', this.store.openNew()]);
  }

  duplicate(item: WorkflowSummary, event: Event): void {
    event.stopPropagation();
    this.library.duplicate(item.id);
  }

  askDelete(item: WorkflowSummary, event: Event): void {
    event.stopPropagation();
    this.pendingDelete.set(item);
  }

  confirmDelete(): void {
    const target = this.pendingDelete();
    if (target) {
      this.library.remove(target.id);
    }
    this.pendingDelete.set(null);
  }

  /** "hace 5 min" / "ayer" / fecha: en una tabla la fecha cruda cuesta más de leer. */
  updatedLabel(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) {
      return '—';
    }
    const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
    if (minutes < 1) {
      return 'Just now';
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    if (days === 1) {
      return 'Yesterday';
    }
    return days < 7 ? `${days} days ago` : new Date(then).toLocaleDateString();
  }
}
