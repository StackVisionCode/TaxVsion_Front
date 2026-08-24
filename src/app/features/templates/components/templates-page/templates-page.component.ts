import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import { TemplateCardGridComponent } from '../../ui/template-card-grid/template-card-grid.component';
import { TemplateFormPanelComponent } from '../../ui/template-form-panel/template-form-panel.component';
import { TemplatePreviewComponent } from '../../ui/template-preview/template-preview.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { TemplatesStore } from '../../data-access/templates.store';
import { Template, TemplateFormValue } from '../../data-access/templates.model';

type CategoryFilter = 'All' | string;

/**
 * Página del módulo Templates conectada a Notification
 * (`/notifications/email/templates`): biblioteca de plantillas de correo de la firma.
 *
 * Diferencias con el mock, impuestas por el contrato real:
 *  - El cuerpo no viaja con la plantilla (vive en CloudStorage): se baja al abrir la
 *    vista previa o el editor.
 *  - No hay borrado: las plantillas se ARCHIVAN. Tampoco hay duplicar (habría que
 *    recrear la plantilla y subir una versión nueva), así que esa acción se retiró.
 *  - Publicar es un paso explícito sobre una versión concreta.
 *  - Las plantillas `System` son de plataforma: se listan de solo lectura.
 */
@Component({
  selector: 'app-templates-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TemplateCardGridComponent,
    TemplateFormPanelComponent,
    TemplatePreviewComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './templates-page.component.html',
})
export class TemplatesPageComponent implements OnInit {
  readonly store = inject(TemplatesStore);

  readonly categoryFilter = signal<CategoryFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingTemplate = signal<Template | null>(null);
  readonly panelSaving = signal(false);
  readonly panelError = signal<string | null>(null);

  /** Id (no el objeto): la plantilla del preview se re-deriva del store y se mantiene fresca. */
  private readonly previewId = signal<string | null>(null);
  readonly previewTemplate = computed<Template | null>(() => {
    const id = this.previewId();
    return id ? (this.store.templates().find(template => template.id === id) ?? null) : null;
  });

  readonly pendingArchive = signal<Template | null>(null);

  ngOnInit(): void {
    this.store.init();
  }

  readonly categoryFilters = computed<CategoryFilter[]>(() => ['All', ...this.store.categories()]);

  readonly archiveMessage = computed(() => {
    const template = this.pendingArchive();
    return template
      ? `You're about to archive template ${template.name}. It stays available for existing campaigns but can't be used for new ones.`
      : '';
  });

  readonly totalCount = computed(() => this.store.templates().length);
  readonly publishedCount = computed(
    () => this.store.templates().filter(template => template.status === 'published').length,
  );
  readonly draftCount = computed(() => this.store.templates().filter(template => template.status === 'draft').length);

  readonly visibleTemplates = computed<Template[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.categoryFilter();
    return this.store
      .templates()
      .filter(template => filter === 'All' || template.category === filter)
      .filter(
        template =>
          !query ||
          template.name.toLowerCase().includes(query) ||
          template.subject.toLowerCase().includes(query),
      );
  });

  readonly emptyMessage = computed(() =>
    this.store.templates().length === 0
      ? 'No templates yet — create your first one'
      : 'No templates match your search',
  );

  /** Cuerpo de la plantilla abierta (preview o edición), ya descargado de CloudStorage. */
  readonly activeBody = computed<string | null>(() => {
    const template = this.editingTemplate() ?? this.previewTemplate();
    return template ? this.store.bodyFor(template.id) : null;
  });

  setCategoryFilter(filter: CategoryFilter): void {
    this.categoryFilter.set(filter);
  }

  retryLoad(): void {
    this.store.refresh();
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  openCreatePanel(): void {
    this.editingTemplate.set(null);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(template: Template): void {
    this.editingTemplate.set(template);
    this.panelError.set(null);
    this.isPanelOpen.set(true);
    this.store.loadBody(template.id);
  }

  closePanel(): void {
    if (this.panelSaving()) {
      return;
    }
    this.isPanelOpen.set(false);
    this.editingTemplate.set(null);
    this.panelError.set(null);
  }

  handleSaved(form: TemplateFormValue): void {
    if (this.panelSaving()) {
      return;
    }
    const editing = this.editingTemplate();
    const action = editing ? this.store.updateTemplate(editing, form) : this.store.createTemplate(form);
    this.panelSaving.set(true);
    this.panelError.set(null);
    action.subscribe({
      next: () => {
        this.panelSaving.set(false);
        this.isPanelOpen.set(false);
        this.editingTemplate.set(null);
      },
      error: err => {
        this.panelSaving.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }

  publishTemplate(template: Template): void {
    this.store.publishCurrent(template);
  }

  archiveTemplate(template: Template): void {
    this.pendingArchive.set(template);
  }

  confirmArchive(): void {
    const template = this.pendingArchive();
    if (!template) {
      return;
    }
    this.pendingArchive.set(null);
    this.store.archiveTemplate(template.id);
    if (this.previewId() === template.id) {
      this.previewId.set(null);
    }
  }

  openPreview(template: Template): void {
    this.previewId.set(template.id);
    this.store.loadBody(template.id);
  }

  closePreview(): void {
    this.previewId.set(null);
  }

  reloadBody(template: Template): void {
    this.store.loadBody(template.id, true);
  }

  editFromPreview(template: Template): void {
    this.previewId.set(null);
    this.openEditPanel(template);
  }
}
