import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Template, TemplateCategory, TemplateCardGridComponent } from '../../ui/template-card-grid/template-card-grid.component';
import { TemplateFormPanelComponent } from '../../ui/template-form-panel/template-form-panel.component';
import { TemplatePreviewComponent } from '../../ui/template-preview/template-preview.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';

type CategoryFilter = 'All' | TemplateCategory;

/** Builds a YYYY-MM-DD date string relative to today so the seed templates always look alive. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const SEED_TEMPLATES: Template[] = [
  {
    id: 'template-1',
    name: 'Engagement Letter — Individual',
    category: 'Letter',
    status: 'published',
    body:
      'Dear {{client_name}},\n\n' +
      'Thank you for choosing our firm to prepare your {{tax_year}} individual tax return. This letter confirms ' +
      'the terms of our engagement.\n\n' +
      'We will prepare your federal and state income tax returns based on the information and documents you ' +
      'provide. Our fees are based on the complexity of your return and will be communicated before we begin work.\n\n' +
      'Please sign and return this letter by {{date}} so we can begin preparing your return.\n\n' +
      'Sincerely,\n{{preparer_name}}',
    updatedAt: dateInDays(-45),
  },
  {
    id: 'template-2',
    name: 'Engagement Letter — Business',
    category: 'Letter',
    status: 'published',
    body:
      'Dear {{client_name}},\n\n' +
      'This letter confirms our engagement to prepare the {{tax_year}} federal and state income tax returns for ' +
      '{{business_name}}.\n\n' +
      'Management is responsible for the accuracy and completeness of the records provided. We will rely on this ' +
      'information without independently verifying it.\n\n' +
      'Please sign below to acknowledge and accept these terms by {{date}}.\n\n' +
      'Sincerely,\n{{preparer_name}}',
    updatedAt: dateInDays(-40),
  },
  {
    id: 'template-3',
    name: 'Missing Documents Reminder',
    category: 'Reminder',
    status: 'published',
    body:
      'Hi {{client_name}},\n\n' +
      'We are still missing the following documents to complete your {{tax_year}} tax return:\n' +
      '{{document_list}}\n\n' +
      'To avoid delays or a filing extension, please upload these documents to your client portal by {{date}}.\n\n' +
      'Thank you,\n{{preparer_name}}',
    updatedAt: dateInDays(-10),
  },
  {
    id: 'template-4',
    name: 'Extension Filed Confirmation',
    category: 'Email',
    status: 'published',
    body:
      'Hi {{client_name}},\n\n' +
      'We have filed Form 4868 to extend the deadline for your {{tax_year}} individual tax return. Your new ' +
      'filing deadline is {{extended_due_date}}.\n\n' +
      'Please note that any tax owed is still due by the original deadline to avoid interest and penalties. ' +
      'We estimate your balance due at {{amount}}.\n\n' +
      'Let us know if you have any questions.\n\n' +
      'Best,\n{{preparer_name}}',
    updatedAt: dateInDays(-20),
  },
  {
    id: 'template-5',
    name: 'Invoice Payment Reminder',
    category: 'Reminder',
    status: 'published',
    body:
      'Hi {{client_name}},\n\n' +
      'This is a friendly reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.\n\n' +
      'You can pay online through your client portal, or reply to this message if you have any questions about ' +
      'the charges.\n\n' +
      'Thank you for your business,\n{{preparer_name}}',
    updatedAt: dateInDays(-5),
  },
  {
    id: 'template-6',
    name: 'Welcome New Client',
    category: 'Email',
    status: 'draft',
    body:
      'Hi {{client_name}},\n\n' +
      'Welcome to {{firm_name}}! We are excited to work with you starting this {{tax_year}} filing season.\n\n' +
      'To get started, please create your client portal account and upload a copy of your prior year return, ' +
      'along with any {{document_list}} you already have on hand.\n\n' +
      'We will reach out with next steps shortly.\n\n' +
      'Warm regards,\n{{preparer_name}}',
    updatedAt: dateInDays(-2),
  },
  {
    id: 'template-7',
    name: 'Invoice Note — Standard Services',
    category: 'Invoice Note',
    status: 'published',
    body:
      'Thank you for trusting {{firm_name}} with your {{tax_year}} tax preparation.\n\n' +
      'This invoice covers professional services rendered, including document review, return preparation, and ' +
      'filing. Payment is due within 15 days of the invoice date.\n\n' +
      'Questions about this invoice can be directed to {{preparer_name}}.',
    updatedAt: dateInDays(-30),
  },
  {
    id: 'template-8',
    name: 'Late Payment Notice',
    category: 'Reminder',
    status: 'draft',
    body:
      'Hi {{client_name}},\n\n' +
      'Our records show that invoice {{invoice_number}} for {{amount}} is now past due as of {{due_date}}.\n\n' +
      'Please submit payment at your earliest convenience through your client portal to avoid any late fees. If ' +
      'you have already sent payment, please disregard this notice.\n\n' +
      'Thank you,\n{{preparer_name}}',
    updatedAt: dateInDays(-1),
  },
  {
    id: 'template-9',
    name: 'Document Request Follow-up',
    category: 'Email',
    status: 'draft',
    body:
      'Hi {{client_name}},\n\n' +
      'Following up on our previous request — we still need {{document_list}} to move forward with your ' +
      '{{tax_year}} return.\n\n' +
      'If you have questions about any of these items, feel free to reply here or schedule a call with ' +
      '{{preparer_name}}.\n\n' +
      'Thanks,\n{{preparer_name}}',
    updatedAt: dateInDays(-3),
  },
  {
    id: 'template-10',
    name: 'Year-End Tax Planning Invite',
    category: 'Letter',
    status: 'draft',
    body:
      'Dear {{client_name}},\n\n' +
      "As {{tax_year}} comes to a close, it's a great time to review your tax situation and identify " +
      'opportunities to reduce your liability before December 31.\n\n' +
      'We would like to schedule a year-end planning session with you by {{date}}. Please let us know a few ' +
      'times that work for you.\n\n' +
      'Looking forward to it,\n{{preparer_name}}',
    updatedAt: dateInDays(-7),
  },
];

/**
 * Página del módulo Templates (estilo "Aether"): stats pastel + grid de
 * tarjetas de plantillas con filtros de categoría/búsqueda + panel de
 * creación/edición + vista previa de solo lectura (takeover, mismo patrón
 * *ngIf/else que invoices-page). Es la biblioteca de plantillas propia del
 * usuario (documentos/emails para su firma), no un marketplace: sin precio,
 * ventas ni calificaciones. Todo el estado vive en signals dentro de esta
 * página, con datos estáticos y sin servicios ni backend.
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
export class TemplatesPageComponent {
  readonly templates = signal<Template[]>(SEED_TEMPLATES);

  readonly categories: TemplateCategory[] = ['Email', 'Letter', 'Invoice Note', 'Reminder'];
  readonly categoryFilters: CategoryFilter[] = ['All', ...this.categories];
  readonly categoryFilter = signal<CategoryFilter>('All');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingTemplate = signal<Template | null>(null);
  readonly previewTemplate = signal<Template | null>(null);
  readonly pendingDelete = signal<Template | null>(null);

  readonly deleteMessage = computed(() => {
    const template = this.pendingDelete();
    return template ? `You're about to delete template ${template.name}. This can't be undone.` : '';
  });

  readonly totalCount = computed(() => this.templates().length);
  readonly publishedCount = computed(() => this.templates().filter(t => t.status === 'published').length);
  readonly draftCount = computed(() => this.templates().filter(t => t.status === 'draft').length);

  readonly visibleTemplates = computed<Template[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.categoryFilter();
    return this.templates()
      .filter(template => filter === 'All' || template.category === filter)
      .filter(template => !query || template.name.toLowerCase().includes(query));
  });

  setCategoryFilter(filter: CategoryFilter): void {
    this.categoryFilter.set(filter);
  }

  openCreatePanel(): void {
    this.editingTemplate.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(template: Template): void {
    this.editingTemplate.set(template);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingTemplate.set(null);
  }

  handleSaved(template: Template): void {
    this.templates.update(list => {
      const exists = list.some(item => item.id === template.id);
      return exists ? list.map(item => (item.id === template.id ? template : item)) : [template, ...list];
    });
    if (this.previewTemplate()?.id === template.id) {
      this.previewTemplate.set(template);
    }
    this.closePanel();
  }

  duplicateTemplate(template: Template): void {
    const copy: Template = {
      ...template,
      id: `template-${Date.now()}`,
      name: `${template.name} (Copy)`,
      status: 'draft',
      updatedAt: dateInDays(0),
    };
    this.templates.update(list => [copy, ...list]);
  }

  deleteTemplate(template: Template): void {
    this.pendingDelete.set(template);
  }

  confirmDelete(): void {
    const template = this.pendingDelete();
    if (!template) {
      return;
    }
    this.templates.update(list => list.filter(item => item.id !== template.id));
    if (this.previewTemplate()?.id === template.id) {
      this.previewTemplate.set(null);
    }
    this.pendingDelete.set(null);
  }

  openPreview(template: Template): void {
    this.previewTemplate.set(template);
  }

  closePreview(): void {
    this.previewTemplate.set(null);
  }

  editFromPreview(template: Template): void {
    this.previewTemplate.set(null);
    this.openEditPanel(template);
  }
}
