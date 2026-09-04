import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { formatBytes } from '@core/cloud-storage/cloud-storage.model';
import { TaskService } from '../../data-access/task.service';
import {
  ApiTaskPriority,
  RecurrenceMode,
  SaveTaskTemplateRequest,
  TaskClientSummary,
  TaskTemplateResponse,
  TemplateApplicationResponse,
} from '../../data-access/task.model';

/** Fila editable de un paso del guion (view-model del editor). */
interface EditableStep {
  title: string;
  description: string;
  priority: ApiTaskPriority;
  estimatedHours: number | null;
  dueOffsetDays: number;
  isStatutory: boolean;
  dependsOnStepOrder: number | null;
  parentStepOrder: number | null;
  suggestedRoleName: string;
}

/**
 * Plantillas fiscales: instalar el catálogo estándar (1040 / 1040-ES / 941) con un click y APLICAR
 * una plantilla sobre un cliente/año (crea el árbol de tareas encadenado; solo el paso 1 arranca
 * ejecutable). Modal sobre `app-modal`. El editor de pasos (autoría de plantillas nuevas) queda como
 * follow-up — install-standard cubre los encargos comunes.
 */
@Component({
  selector: 'app-task-templates-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-templates-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskTemplatesModalComponent implements OnChanges {
  private readonly service = inject(TaskService);
  private readonly toast = inject(ToastService);
  private readonly cloud = inject(CloudStorageUploadService);

  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  /** Se aplicó una plantilla (se crearon tareas) → el tablero refresca. */
  @Output() applied = new EventEmitter<void>();

  /** Vista interna del modal: catálogo · aplicar · editar/crear. */
  readonly view = signal<'list' | 'apply' | 'edit'>('list');

  readonly templates = signal<TaskTemplateResponse[]>([]);
  readonly loading = signal(false);
  readonly installing = signal(false);

  readonly priorities: ApiTaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];

  // ----- Editor de plantilla (autoría) -----
  readonly editingId = signal<string | null>(null);
  readonly formName = signal('');
  readonly formDescription = signal('');
  readonly formRecurring = signal(false);
  readonly formRecurrenceRule = signal('');
  readonly formRecurrenceMode = signal<RecurrenceMode>('FixedSchedule');
  readonly formSteps = signal<EditableStep[]>([]);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Adjuntos de referencia (solo en edición: requieren un templateId).
  readonly editorAttachments = signal<{ fileId: string; displayName: string; contentType: string | null; sizeBytes: number }[]>([]);
  readonly uploadingAttachment = signal(false);

  // ----- Estado de "aplicar" -----
  readonly selected = signal<TaskTemplateResponse | null>(null);
  readonly clientSearch = signal('');
  readonly clientResults = signal<TaskClientSummary[]>([]);
  readonly selectedClient = signal<TaskClientSummary | null>(null);
  readonly taxYear = signal<number>(new Date().getFullYear());
  readonly anchorDate = signal<string>(this.todayIso());
  readonly allowDuplicate = signal(false);
  readonly applying = signal(false);
  readonly applyError = signal<string | null>(null);
  readonly result = signal<TemplateApplicationResponse | null>(null);
  private clientSearchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.view.set('list');
      this.resetApply();
      this.load();
    }
  }

  private load(): void {
    this.loading.set(true);
    this.service.listTemplates(false).subscribe({
      next: t => {
        this.templates.set(t);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  installStandard(): void {
    if (this.installing()) return;
    this.installing.set(true);
    this.service.installStandardTemplates().subscribe({
      next: t => {
        this.templates.set(t);
        this.installing.set(false);
        this.toast.success('Standard templates installed');
      },
      error: err => {
        this.installing.set(false);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  // ----- Aplicar -----

  pickTemplate(t: TaskTemplateResponse): void {
    this.selected.set(t);
    this.result.set(null);
    this.applyError.set(null);
    this.view.set('apply');
  }

  backToList(): void {
    this.selected.set(null);
    this.result.set(null);
    this.view.set('list');
  }

  // ----- Editor de plantilla -----

  newTemplate(): void {
    this.editingId.set(null);
    this.formName.set('');
    this.formDescription.set('');
    this.formRecurring.set(false);
    this.formRecurrenceRule.set('');
    this.formRecurrenceMode.set('FixedSchedule');
    this.formSteps.set([this.blankStep(0)]);
    this.editorAttachments.set([]);
    this.saveError.set(null);
    this.view.set('edit');
  }

  editTemplate(t: TaskTemplateResponse, event: Event): void {
    event.stopPropagation();
    this.editingId.set(t.id);
    this.formName.set(t.name);
    this.formDescription.set(t.description ?? '');
    this.formRecurring.set(!!t.recurrenceRule);
    this.formRecurrenceRule.set(t.recurrenceRule ?? '');
    this.formRecurrenceMode.set(t.recurrenceMode ?? 'FixedSchedule');
    this.formSteps.set(
      t.steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(s => ({
          title: s.title,
          description: s.description ?? '',
          priority: s.priority,
          estimatedHours: s.estimatedHours,
          dueOffsetDays: s.dueOffsetDays,
          isStatutory: s.isStatutory,
          dependsOnStepOrder: s.dependsOnStepOrder,
          parentStepOrder: s.parentStepOrder,
          suggestedRoleName: s.suggestedRoleName ?? '',
        })),
    );
    this.editorAttachments.set(
      (t.attachments ?? []).map(a => ({
        fileId: a.fileId,
        displayName: a.displayName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    );
    this.saveError.set(null);
    this.view.set('edit');
  }

  private blankStep(offsetDays: number): EditableStep {
    return {
      title: '',
      description: '',
      priority: 'Normal',
      estimatedHours: null,
      dueOffsetDays: offsetDays,
      isStatutory: false,
      dependsOnStepOrder: null,
      parentStepOrder: null,
      suggestedRoleName: '',
    };
  }

  addStep(): void {
    this.formSteps.update(steps => [...steps, this.blankStep(0)]);
  }

  removeStep(index: number): void {
    this.formSteps.update(steps => steps.filter((_, i) => i !== index));
  }

  moveStep(index: number, dir: -1 | 1): void {
    const target = index + dir;
    this.formSteps.update(steps => {
      if (target < 0 || target >= steps.length) return steps;
      const copy = [...steps];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  updateStep(index: number, patch: Partial<EditableStep>): void {
    this.formSteps.update(steps => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  /** Órdenes (1-based) de los OTROS pasos, para los selects de depends/parent. */
  otherOrders(index: number): number[] {
    return this.formSteps()
      .map((_, i) => i + 1)
      .filter(o => o !== index + 1);
  }

  canSave(): boolean {
    if (this.saving() || !this.formName().trim() || this.formSteps().length === 0) return false;
    if (this.formSteps().some(s => !s.title.trim())) return false;
    // Con recurrencia: exactamente 1 paso + regla.
    if (this.formRecurring()) {
      return this.formSteps().length === 1 && this.formRecurrenceRule().trim().length > 0;
    }
    return true;
  }

  saveTemplate(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const recurring = this.formRecurring();
    const req: SaveTaskTemplateRequest = {
      name: this.formName().trim(),
      description: this.formDescription().trim() || null,
      recurrenceRule: recurring ? this.formRecurrenceRule().trim() : null,
      recurrenceTimeZoneId: recurring ? 'America/New_York' : null,
      recurrenceMode: this.formRecurrenceMode(),
      steps: this.formSteps().map((s, i) => ({
        order: i + 1,
        title: s.title.trim(),
        description: s.description.trim() || null,
        priority: s.priority,
        estimatedHours: s.estimatedHours,
        dueOffsetDays: s.dueOffsetDays,
        isStatutory: s.isStatutory,
        dependsOnStepOrder: s.dependsOnStepOrder,
        parentStepOrder: s.parentStepOrder,
        suggestedRoleName: s.suggestedRoleName.trim() || null,
      })),
    };
    const id = this.editingId();
    const op = id ? this.service.updateTemplate(id, req) : this.service.createTemplate(req);
    op.subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(id ? 'Template updated' : 'Template created');
        this.view.set('list');
        this.load();
      },
      error: err => {
        this.saving.set(false);
        this.saveError.set(toApiError(err).message);
      },
    });
  }

  // ----- Adjuntos de referencia de la plantilla -----

  attachSize(bytes: number): string {
    return formatBytes(bytes);
  }

  async uploadTemplateAttachment(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const id = this.editingId();
    if (!file || !id || this.uploadingAttachment()) {
      input.value = '';
      return;
    }
    this.uploadingAttachment.set(true);
    try {
      // Archivo de referencia de la firma (a nivel tenant): owner Tenant, folder Templates.
      const initiated = await firstValueFrom(
        this.cloud.initiateUpload({
          originalName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          ownerType: 'Tenant',
          ownerId: null,
          folderType: 'Templates',
          taxYear: null,
        }),
      );
      await firstValueFrom(this.cloud.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file));
      await firstValueFrom(this.cloud.completeUpload(initiated.fileId));
      const next = [
        ...this.editorAttachments(),
        { fileId: initiated.fileId, displayName: file.name, contentType: file.type || null, sizeBytes: file.size },
      ];
      await this.persistAttachments(id, next);
    } catch (err) {
      this.toast.error(toApiError(err).message);
    } finally {
      this.uploadingAttachment.set(false);
      input.value = '';
    }
  }

  async removeTemplateAttachment(fileId: string): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    const next = this.editorAttachments().filter(a => a.fileId !== fileId);
    await this.persistAttachments(id, next);
  }

  private async persistAttachments(
    id: string,
    list: { fileId: string; displayName: string; contentType: string | null; sizeBytes: number }[],
  ): Promise<void> {
    const updated = await firstValueFrom(
      this.service.setTemplateAttachments(id, {
        attachments: list.map(a => ({
          fileId: a.fileId,
          displayName: a.displayName,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          stepOrder: null,
        })),
      }),
    );
    this.editorAttachments.set(
      (updated.attachments ?? []).map(a => ({
        fileId: a.fileId,
        displayName: a.displayName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    );
  }

  toggleActive(t: TaskTemplateResponse, event: Event): void {
    event.stopPropagation();
    this.service.setTemplateActive(t.id, { isActive: !t.isActive }).subscribe({
      next: () => {
        this.toast.success(t.isActive ? 'Template retired' : 'Template reactivated');
        this.load();
      },
      error: err => this.toast.error(toApiError(err).message),
    });
  }

  onClientSearch(term: string): void {
    this.clientSearch.set(term);
    this.selectedClient.set(null);
    if (this.clientSearchTimer) clearTimeout(this.clientSearchTimer);
    const q = term.trim();
    if (q.length < 2) {
      this.clientResults.set([]);
      return;
    }
    this.clientSearchTimer = setTimeout(() => {
      this.service.searchClients(q, 8).subscribe({
        next: page => this.clientResults.set(page.items),
        error: () => this.clientResults.set([]),
      });
    }, 300);
  }

  chooseClient(c: TaskClientSummary): void {
    this.selectedClient.set(c);
    this.clientSearch.set(c.displayName);
    this.clientResults.set([]);
  }

  canApply(): boolean {
    return !!this.selected() && !!this.selectedClient() && !!this.anchorDate() && !this.applying();
  }

  apply(): void {
    const template = this.selected();
    const client = this.selectedClient();
    if (!template || !client || !this.anchorDate()) return;
    this.applying.set(true);
    this.applyError.set(null);
    this.service
      .applyTemplate(template.id, {
        assigneeUserId: null,
        customerId: client.id,
        taxYear: this.taxYear(),
        dueAtUtc: new Date(`${this.anchorDate()}T00:00:00Z`).toISOString(),
        timeZoneId: null,
        allowDuplicate: this.allowDuplicate(),
      })
      .subscribe({
        next: res => {
          this.result.set(res);
          this.applying.set(false);
          this.toast.success(`${res.tasksCreated} task(s) created from "${template.name}"`);
          this.applied.emit();
        },
        error: err => {
          this.applying.set(false);
          const e = toApiError(err);
          // AlreadyApplied → sugerir "Apply anyway".
          this.applyError.set(
            e.message?.includes('AlreadyApplied') || e.code?.includes('AlreadyApplied')
              ? 'This template was already applied to this client and year. Enable "Apply anyway" to create a duplicate.'
              : e.message,
          );
        },
      });
  }

  close(): void {
    this.closed.emit();
  }

  private resetApply(): void {
    this.selected.set(null);
    this.clientSearch.set('');
    this.clientResults.set([]);
    this.selectedClient.set(null);
    this.taxYear.set(new Date().getFullYear());
    this.anchorDate.set(this.todayIso());
    this.allowDuplicate.set(false);
    this.result.set(null);
    this.applyError.set(null);
  }

  private todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }
}
