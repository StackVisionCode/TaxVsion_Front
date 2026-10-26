import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormEngine } from '@shared/utils/data-collection/form-engine';
import type { FormAnswers, RepeaterRows } from '@shared/utils/data-collection/form-answers.model';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { normalizeTaxId } from '@shared/utils/data-collection/formats';
import { issue, type ValidationIssue } from '@shared/utils/data-collection/validation';
import type {
  DataCollectionAttachment,
  DataCollectionConsentRequest,
  DataCollectionFieldComment,
  DataCollectionFileSelection,
  DataCollectionRendererMode,
  DataCollectionSensitiveEntry,
  DataCollectionValueChange,
} from '../data-collection.models';
import { createPreviewId } from '../data-collection.utils';
import { DcAnswersViewComponent } from '../answers-view/dc-answers-view.component';
import { DcErrorSummaryComponent } from '../error-summary/dc-error-summary.component';
import { DcPageComponent } from '../structure/dc-page.component';

/**
 * Renderer controlado del schema v1.
 * Uso: `<app-dc-form-renderer [definition]="definition" [answers]="answers" (answersChange)="save($event)" />`.
 */
@Component({
  selector: 'app-dc-form-renderer',
  imports: [DcAnswersViewComponent, DcErrorSummaryComponent, DcPageComponent],
  templateUrl: './dc-form-renderer.component.html',
  styleUrl: './dc-form-renderer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DcFormRendererComponent {
  private readonly document = inject(DOCUMENT);
  private readonly engine = new FormEngine();
  private readonly definitionState = signal<FormDefinition | null>(null);
  private readonly answersState = signal<FormAnswers>({ schemaVersion: 1, values: {} });
  private readonly modeState = signal<DataCollectionRendererMode>('fill');
  private readonly externalIssues = signal<readonly ValidationIssue[]>([]);
  private readonly pageIndexState = signal(0);
  private readonly externalAttachments = signal<Readonly<Record<string, DataCollectionAttachment>>>(
    {},
  );
  private readonly previewAttachments = signal<Readonly<Record<string, DataCollectionAttachment>>>(
    {},
  );
  private readonly internalIssues = signal<readonly ValidationIssue[]>([]);
  private readonly titleControl = signal(false);
  private previousTitle: string | null = null;

  @Input({ required: true }) set definition(value: FormDefinition) {
    this.definitionState.set(value);
    this.ensurePageIndex();
  }
  @Input({ required: true }) set answers(value: FormAnswers) {
    this.answersState.set(value ?? { schemaVersion: 1, values: {} });
    this.ensurePageIndex();
  }
  @Input() set mode(value: DataCollectionRendererMode) {
    this.modeState.set(value);
  }
  @Input() set issues(value: readonly ValidationIssue[]) {
    this.externalIssues.set(value ?? []);
  }
  @Input() set pageIndex(value: number) {
    this.pageIndexState.set(Math.max(0, value || 0));
    this.ensurePageIndex();
  }
  @Input() set attachments(value: Readonly<Record<string, DataCollectionAttachment>>) {
    this.externalAttachments.set(value ?? {});
  }
  @Input() prefilledIds: readonly string[] = [];
  @Input() fieldComments: readonly DataCollectionFieldComment[] = [];
  @Input() submitLabel: string | null = null;
  @Input() submitting = false;
  /** Deshabilita el envío sin mostrar "Sending…" (p. ej. archivos en escaneo). */
  @Input() submitDisabled = false;
  /**
   * Se espera antes de cambiar de página (regla 4 de P-5.3-bis: guardar antes de navegar).
   * Si devuelve `false` o rechaza, la página no cambia.
   */
  @Input() beforePageChange: ((targetIndex: number) => Promise<boolean> | boolean) | null = null;
  /** Solo la página pública lo activa: escribe "Step N of M" en la pestaña y lo restaura al salir. */
  @Input() set controlsDocumentTitle(value: boolean) {
    this.titleControl.set(value);
  }

  @Output() readonly answersChange = new EventEmitter<FormAnswers>();
  @Output() readonly pageIndexChange = new EventEmitter<number>();
  @Output() readonly fileSelected = new EventEmitter<DataCollectionFileSelection>();
  @Output() readonly fileRemoved = new EventEmitter<string>();
  @Output() readonly sensitiveEntered = new EventEmitter<DataCollectionSensitiveEntry>();
  @Output() readonly consentRequested = new EventEmitter<DataCollectionConsentRequest>();
  @Output() readonly submitRequested = new EventEmitter<void>();
  @ViewChild(DcErrorSummaryComponent) private errorSummary?: DcErrorSummaryComponent;

  readonly definitionValue = computed(() => this.definitionState());
  readonly answersValue = computed(() => this.answersState());
  readonly modeValue = computed(() => this.modeState());
  readonly visibility = computed(() => {
    const definition = this.definitionState();
    return definition ? this.engine.evaluateVisibility(definition, this.answersState()) : null;
  });
  readonly visiblePages = computed(() => {
    const definition = this.definitionState();
    const visibility = this.visibility();
    return definition && visibility
      ? definition.pages.filter((page) => visibility.isVisible(page.id))
      : [];
  });
  readonly contentStepCount = computed(() =>
    this.definitionState()?.presentation === 'singlePage' ? 1 : this.visiblePages().length,
  );
  readonly totalSteps = computed(() => this.contentStepCount() + 1);
  readonly isReview = computed(() => this.pageIndexState() >= this.contentStepCount());
  readonly currentPage = computed(() => this.visiblePages()[this.pageIndexState()] ?? null);
  readonly allIssues = computed(() => [...this.externalIssues(), ...this.internalIssues()]);
  readonly attachmentsValue = computed(() => ({
    ...this.externalAttachments(),
    ...this.previewAttachments(),
  }));
  readonly progressPercent = computed(() =>
    Math.min(100, Math.round(((this.pageIndexState() + 1) / Math.max(1, this.totalSteps())) * 100)),
  );
  readonly pageIndexValue = computed(() => this.pageIndexState());
  readonly navigating = signal(false);

  constructor() {
    effect(() => {
      const definition = this.definitionState();
      if (!definition || !this.titleControl()) {
        this.restoreTitle();
        return;
      }
      const title = this.isReview() ? 'Review' : this.currentPage()?.title || definition.title;
      this.previousTitle ??= this.document.title;
      this.document.title = `Step ${Math.min(this.pageIndexState() + 1, this.totalSteps())} of ${this.totalSteps()} - ${title}`;
    });
    inject(DestroyRef).onDestroy(() => this.restoreTitle());
  }

  updateValue(change: DataCollectionValueChange): void {
    if (change.rowId != null) return;
    this.commit({
      ...this.answersState(),
      values: { ...this.answersState().values, [change.componentId]: change.value },
    });
  }

  updateRepeater(change: { sectionId: string; value: RepeaterRows }): void {
    this.commit({
      ...this.answersState(),
      values: { ...this.answersState().values, [change.sectionId]: change.value },
    });
  }

  handleFiles(selection: DataCollectionFileSelection): void {
    if (this.modeState() !== 'preview') {
      this.fileSelected.emit(selection);
      return;
    }
    const created = selection.files.map((file) => {
      const fileId = createPreviewId();
      return {
        answer: { fileId },
        attachment: {
          id: fileId,
          fileId,
          componentId: selection.componentId,
          rowId: selection.rowId,
          displayName: file.name,
          status: 'Preview only',
        } satisfies DataCollectionAttachment,
      };
    });
    this.previewAttachments.update((current) => ({
      ...current,
      ...Object.fromEntries(created.map((item) => [item.attachment.fileId, item.attachment])),
    }));
    const current = this.readValue(selection.componentId, selection.rowId);
    this.writeContextValue(selection.componentId, selection.rowId, [
      ...(Array.isArray(current) ? current : []),
      ...created.map((item) => item.answer),
    ]);
  }

  handleFileRemoved(attachmentId: string): void {
    if (this.modeState() !== 'preview') {
      this.fileRemoved.emit(attachmentId);
      return;
    }
    const attachment = this.previewAttachments()[attachmentId];
    if (!attachment) return;
    this.previewAttachments.update((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== attachmentId)),
    );
    const current = this.readValue(attachment.componentId, attachment.rowId ?? null);
    this.writeContextValue(
      attachment.componentId,
      attachment.rowId ?? null,
      Array.isArray(current)
        ? current.filter(
            (item) =>
              !(
                typeof item === 'object' &&
                item != null &&
                'fileId' in item &&
                item.fileId === attachment.fileId
              ),
          )
        : [],
    );
  }

  handleSensitive(entry: DataCollectionSensitiveEntry): void {
    if (this.modeState() !== 'preview') {
      this.sensitiveEntered.emit(entry);
      return;
    }
    const normalized = normalizeTaxId(entry.value, entry.kind);
    if (!normalized) {
      this.internalIssues.set([
        issue(
          'answer.sensitive_invalid',
          `/values/${entry.componentId}`,
          entry.componentId,
          entry.rowId,
        ),
      ]);
      return;
    }
    this.internalIssues.set([]);
    this.writeContextValue(entry.componentId, entry.rowId, {
      sensitiveRef: createPreviewId(),
      last4: normalized.slice(-4),
      kind: entry.kind,
    });
  }

  next(): void {
    const definition = this.definitionState();
    if (!definition || this.isReview() || this.navigating()) return;
    const pageId = definition.presentation === 'wizard' ? this.currentPage()?.id : undefined;
    const report = this.engine.validateAnswers(
      definition,
      this.answersState(),
      'submit',
      pageId ? { pageId } : {},
    );
    this.internalIssues.set(report.issues);
    if (!report.isValid) {
      setTimeout(() => this.errorSummary?.focus());
      return;
    }
    void this.goTo(this.pageIndexState() + 1);
  }

  back(): void {
    if (this.pageIndexState() > 0 && !this.navigating()) {
      this.internalIssues.set([]);
      void this.goTo(this.pageIndexState() - 1);
    }
  }

  private async goTo(index: number): Promise<void> {
    const next = Math.max(0, Math.min(index, this.totalSteps() - 1));
    if (this.beforePageChange != null) {
      this.navigating.set(true);
      let allowed = false;
      try {
        allowed = (await this.beforePageChange(next)) !== false;
      } catch {
        allowed = false;
      } finally {
        this.navigating.set(false);
      }
      if (!allowed) return;
    }
    this.pageIndexState.set(next);
    this.pageIndexChange.emit(next);
  }

  private commit(answers: FormAnswers): void {
    this.answersState.set(answers);
    this.internalIssues.set([]);
    this.answersChange.emit(answers);
    this.ensurePageIndex();
  }

  private readValue(componentId: string, rowId: string | null): unknown {
    if (rowId == null) return this.answersState().values[componentId];
    for (const value of Object.values(this.answersState().values)) {
      if (
        typeof value !== 'object' ||
        value == null ||
        !('rows' in value) ||
        !Array.isArray(value.rows)
      )
        continue;
      const row = value.rows.find(
        (item: unknown) =>
          typeof item === 'object' && item != null && 'rowId' in item && item.rowId === rowId,
      );
      if (
        row &&
        typeof row === 'object' &&
        'values' in row &&
        typeof row.values === 'object' &&
        row.values != null
      )
        return (row.values as Record<string, unknown>)[componentId];
    }
    return undefined;
  }

  private writeContextValue(componentId: string, rowId: string | null, value: unknown): void {
    if (rowId == null) {
      this.updateValue({ componentId, rowId, value });
      return;
    }
    const values = Object.fromEntries(
      Object.entries(this.answersState().values).map(([sectionId, sectionValue]) => {
        if (
          typeof sectionValue !== 'object' ||
          sectionValue == null ||
          !('rows' in sectionValue) ||
          !Array.isArray(sectionValue.rows)
        )
          return [sectionId, sectionValue];
        return [
          sectionId,
          {
            rows: sectionValue.rows.map((row: unknown) =>
              typeof row === 'object' &&
              row != null &&
              'rowId' in row &&
              row.rowId === rowId &&
              'values' in row &&
              typeof row.values === 'object' &&
              row.values != null
                ? {
                    ...row,
                    values: { ...(row.values as Record<string, unknown>), [componentId]: value },
                  }
                : row,
            ),
          },
        ];
      }),
    );
    this.commit({ ...this.answersState(), values });
  }

  private restoreTitle(): void {
    if (this.previousTitle == null) return;
    this.document.title = this.previousTitle;
    this.previousTitle = null;
  }

  private ensurePageIndex(): void {
    const maximum = Math.max(0, this.totalSteps() - 1);
    if (this.pageIndexState() > maximum) this.pageIndexState.set(maximum);
  }
}
