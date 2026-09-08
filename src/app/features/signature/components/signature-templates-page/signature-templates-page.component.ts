import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SignatureService } from '../../data-access/signature.service';
import {
  SIGNATURE_CATEGORIES,
  SIGNATURE_CATEGORY_LABEL,
  SignatureCategory,
  SignatureTemplateStatus,
  TOKEN_EXPIRATION_DEFAULT_HOURS,
  TemplateSummary,
} from '../../data-access/signature.model';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { SignatureTemplateEditorComponent } from '../../ui/signature-template-editor/signature-template-editor.component';

/**
 * Autoría de plantillas de firma (`/signature/templates`). Dos vistas:
 *  - Lista: todos los moldes del tenant (Draft/Published/Archived) con sus contadores.
 *  - Editor: <app-signature-template-editor> para el molde seleccionado/creado.
 *
 * Usa el service directo (no el store) porque el store filtra a Published para el picker;
 * aquí hacen falta también los borradores.
 */
@Component({
  selector: 'app-signature-templates-page',
  imports: [CommonModule, FormsModule, RouterLink, ModalComponent, SignatureTemplateEditorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-templates-page.component.html',
  styleUrl: './signature-templates-page.component.css',
})
export class SignatureTemplatesPageComponent implements OnInit {
  private readonly service = inject(SignatureService);

  readonly categories = SIGNATURE_CATEGORIES;
  readonly categoryLabel = SIGNATURE_CATEGORY_LABEL;

  readonly templates = signal<TemplateSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  /** null = vista de lista; con id = editor abierto. */
  readonly editingId = signal<string | null>(null);

  // ---------- Modal "New template" ----------
  readonly isCreateOpen = signal(false);
  readonly draftTitle = signal('');
  readonly draftCategory = signal<SignatureCategory>('Fiscal');
  readonly createBusy = signal(false);
  readonly createError = signal('');

  readonly canCreate = computed(() => this.draftTitle().trim().length >= 3);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(this.service.listTemplates());
      this.templates.set(result.items ?? []);
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  statusClass(status: SignatureTemplateStatus): string {
    switch (status) {
      case 'Published':
        return 'bg-emerald-50 text-emerald-600';
      case 'Archived':
        return 'bg-gray-100 text-gray-500';
      default:
        return 'bg-amber-50 text-amber-600';
    }
  }

  // ---------- Crear ----------

  openCreate(): void {
    this.draftTitle.set('');
    this.draftCategory.set('Fiscal');
    this.createError.set('');
    this.isCreateOpen.set(true);
  }

  closeCreate(): void {
    if (this.createBusy()) {
      return;
    }
    this.isCreateOpen.set(false);
  }

  async createTemplate(): Promise<void> {
    if (!this.canCreate() || this.createBusy()) {
      return;
    }
    this.createBusy.set(true);
    this.createError.set('');
    try {
      const detail = await firstValueFrom(
        this.service.createTemplate({
          title: this.draftTitle().trim(),
          description: null,
          category: this.draftCategory(),
          defaultTokenExpirationHours: TOKEN_EXPIRATION_DEFAULT_HOURS,
          requiresSequentialSigning: false,
          requiresConsent: true,
          generateCertificate: true,
        }),
      );
      this.isCreateOpen.set(false);
      this.editingId.set(detail.id);
    } catch (err) {
      this.createError.set(toApiError(err).message);
    } finally {
      this.createBusy.set(false);
    }
  }

  // ---------- Editor ----------

  openEditor(templateId: string): void {
    this.editingId.set(templateId);
  }

  closeEditor(): void {
    this.editingId.set(null);
    void this.load();
  }
}
