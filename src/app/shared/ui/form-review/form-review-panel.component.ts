import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormEngine } from '@shared/utils/data-collection/form-engine';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { isRecord } from '@shared/utils/data-collection/properties';
import { revisionDiff, type RevisionDiffEntry } from '@shared/utils/data-collection/revision-diff';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { DcAnswersViewComponent } from '@shared/ui/data-collection/answers-view/dc-answers-view.component';
import type {
  DataCollectionAttachment,
  DataCollectionFieldComment,
} from '@shared/ui/data-collection/data-collection.models';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import type { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import {
  findReviewComponent,
  formatAnswerValue,
  formatReviewDate,
  formatReviewDateTime,
  humanizeAction,
  reviewRowLabel,
} from './form-review.format';
import { FILE_UNDER_REVIEW_LABEL, rejectedFileText } from '@shared/utils/file-moderation';

export type FormReviewTab = 'answers' | 'changes' | 'files' | 'activity';

export interface FormReviewRevision {
  number: number;
  answers: FormAnswers;
  fieldComments: readonly DataCollectionFieldComment[];
}

export interface FormReviewRevisionOption {
  number: number;
  submittedAtUtc: string;
}

export interface FormReviewTimelineEntry {
  action: string;
  outcome: string;
  actorType: string;
  occurredAtUtc: string;
}

/** Entrada que `app-dc-answers-view` pasa al slot de acciones por campo. */
interface AnswerSlotEntry {
  component: { id: string; type: string };
  rowId: string | null;
  value: unknown;
}

interface ChangeView {
  key: string;
  label: string;
  rowLabel: string | null;
  kind: string;
  tone: StatusTone;
  before: string;
  after: string;
}

const REVEAL_MS = 30_000;

/**
 * Cuerpo presentacional de la revisión de un formulario: pestañas Answers | Changes | Files |
 * Activity, selector de revisión, comentarios por campo y reveal de taxId. Lo usan los drawers del
 * perfil del cliente y de la bandeja; cada uno pone su encabezado, sus acciones y su store.
 *
 * Reveal: pide confirmación, se oculta solo a los 30 s, al cambiar de revisión o de request, con
 * `hideReveal()` (el drawer lo llama al cerrar) y al destruir el panel.
 */
@Component({
  selector: 'app-form-review-panel',
  imports: [
    ConfirmDialogComponent,
    DcAnswersViewComponent,
    FileViewerComponent,
    StatusPillComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex overflow-x-auto border-b border-gray-200 px-6" aria-label="Review sections">
      @for (item of tabs; track item.id) {
        <button
          type="button"
          class="shrink-0 border-b-2 px-4 py-3 text-sm font-semibold"
          [class.border-brand-bold]="tab() === item.id"
          [class.text-brand-bold]="tab() === item.id"
          [class.border-transparent]="tab() !== item.id"
          [class.text-gray-500]="tab() !== item.id"
          [attr.aria-current]="tab() === item.id ? 'page' : null"
          (click)="tab.set(item.id)"
        >
          {{ item.label }}
        </button>
      }
    </nav>

    <div class="p-6">
      @if (revisions().length > 1) {
        <label class="mb-5 block text-sm font-semibold text-gray-700">
          Revision
          <select
            class="mt-1 min-h-10 w-full rounded-xl border border-gray-300 bg-white px-3"
            [value]="revision()?.number ?? ''"
            (change)="selectRevision($event)"
          >
            @for (option of revisions(); track option.number) {
              <option [value]="option.number" [selected]="option.number === revision()?.number">
                Revision {{ option.number }} · {{ date(option.submittedAtUtc) }}
              </option>
            }
          </select>
        </label>
      }

      @if (tab() === 'answers') {
        @if (revision(); as current) {
          <app-dc-answers-view
            [definition]="definition()"
            [answers]="current.answers"
            [visibility]="visibility()!"
            [attachments]="attachmentsById()"
            [fieldComments]="current.fieldComments"
            [fieldActionsTemplate]="fieldActions"
            audience="staff"
          />
        } @else {
          <p class="py-10 text-center text-sm text-gray-500">No submitted answers yet.</p>
        }
      } @else if (tab() === 'changes') {
        <section aria-labelledby="form-review-changes-heading">
          <h3 id="form-review-changes-heading" class="text-lg font-bold text-gray-900">
            Changes from the previous revision
          </h3>
          <div class="mt-4 divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            @for (entry of changes(); track entry.key) {
              <div class="p-4">
                <div class="flex items-center justify-between gap-3">
                  <p class="font-semibold text-gray-900">{{ entry.label }}</p>
                  <app-status-pill [tone]="entry.tone" size="xs">{{ entry.kind }}</app-status-pill>
                </div>
                @if (entry.rowLabel) {
                  <p class="mt-1 text-xs text-gray-500">{{ entry.rowLabel }}</p>
                }
                <div class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div class="break-words rounded-xl bg-red-50 p-3">
                    <span class="block text-xs font-bold text-red-700">Before</span
                    >{{ entry.before }}
                  </div>
                  <div class="break-words rounded-xl bg-emerald-50 p-3">
                    <span class="block text-xs font-bold text-emerald-700">After</span
                    >{{ entry.after }}
                  </div>
                </div>
              </div>
            } @empty {
              <p class="p-8 text-center text-sm text-gray-500">
                No changes from the previous revision.
              </p>
            }
          </div>
        </section>
      } @else if (tab() === 'files') {
        <section aria-labelledby="form-review-files-heading">
          <h3 id="form-review-files-heading" class="text-lg font-bold text-gray-900">Files</h3>
          <div class="mt-4 divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            @for (file of attachments(); track file.id) {
              <button
                type="button"
                class="flex w-full items-center gap-3 p-4 text-left hover:bg-gray-50"
                [disabled]="file.status !== 'Available'"
                (click)="openFile(file.id)"
              >
                <ion-icon name="document-attach-outline" class="text-xl text-brand-bold"></ion-icon>
                <span class="min-w-0 flex-1"
                  ><span class="block truncate font-semibold text-gray-900">{{
                    file.displayName
                  }}</span
                  ><span class="text-xs" [class.text-gray-500]="file.status !== 'Rejected'" [class.text-red-600]="file.status === 'Rejected'">{{ fileStatusLabel(file) }}</span></span
                >
                <ion-icon name="eye-outline" class="text-gray-400"></ion-icon>
              </button>
            } @empty {
              <p class="p-8 text-center text-sm text-gray-500">No files were submitted.</p>
            }
          </div>
        </section>
      } @else {
        <section aria-labelledby="form-review-activity-heading">
          <h3 id="form-review-activity-heading" class="text-lg font-bold text-gray-900">
            Activity
          </h3>
          <ol class="mt-4 space-y-4 border-l border-gray-200 pl-5">
            @for (event of timeline(); track $index) {
              <li class="relative">
                <span
                  class="absolute -left-[1.55rem] top-1.5 h-2 w-2 rounded-full bg-brand-bold"
                ></span>
                <p class="font-semibold text-gray-900">{{ humanize(event.action) }}</p>
                <p class="text-sm text-gray-600">{{ event.outcome }} · {{ event.actorType }}</p>
                <time class="text-xs text-gray-500">{{ dateTime(event.occurredAtUtc) }}</time>
              </li>
            } @empty {
              <li class="text-sm text-gray-500">No activity recorded yet.</li>
            }
          </ol>
        </section>
      }
    </div>

    <ng-template #fieldActions let-entry>
      <div class="mt-2 space-y-2">
        @if (entry.component.type === 'taxId' && canReveal() && sensitiveRef(entry)) {
          @if (revealedFor(entry); as value) {
            <div
              class="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-900"
            >
              <span>{{ value }}</span>
              <button
                type="button"
                class="ml-auto"
                aria-label="Hide sensitive value"
                (click)="hideReveal()"
              >
                <ion-icon name="eye-off-outline"></ion-icon>
              </button>
            </div>
          } @else {
            <button
              type="button"
              class="text-xs font-bold text-brand-bold"
              (click)="confirmReveal(entry)"
            >
              Reveal
            </button>
          }
        }
        @if (requestChangesMode()) {
          <label class="block text-xs font-semibold text-gray-600"
            >Comment<span class="sr-only"> on {{ entry.component.label || 'this field' }}</span>
            <textarea
              class="mt-1 w-full rounded-2xl border border-gray-300 p-2 text-sm"
              rows="2"
              [value]="fieldComment(entry)"
              (input)="setFieldComment(entry, $event)"
            ></textarea>
          </label>
        }
      </div>
    </ng-template>

    <app-confirm-dialog
      [isOpen]="revealTarget() != null"
      heading="Reveal sensitive value?"
      message="This reveal is recorded. The value hides automatically after 30 seconds."
      confirmLabel="Reveal"
      (cancelled)="revealTarget.set(null)"
      (confirmed)="revealConfirmed()"
    />

    <app-file-viewer
      [isOpen]="viewerOpen()"
      [files]="viewerFiles()"
      [startIndex]="viewerIndex()"
      (closed)="viewerOpen.set(false)"
    />
  `,
})
export class FormReviewPanelComponent {
  private readonly engine = new FormEngine();

  readonly requestId = input.required<string>();
  readonly definition = input.required<FormDefinition>();
  readonly revision = input<FormReviewRevision | null>(null);
  readonly previousRevision = input<{ answers: FormAnswers } | null>(null);
  readonly revisions = input<readonly FormReviewRevisionOption[]>([]);
  readonly attachments = input<readonly DataCollectionAttachment[]>([]);

  /** Estado del archivo en palabras del preparador (T-20: revisión y bloqueo por política). */
  fileStatusLabel(file: DataCollectionAttachment): string {
    switch (file.status) {
      case 'Available':
        return 'Ready';
      case 'Pending':
        return 'Scanning…';
      case 'UnderReview':
        return FILE_UNDER_REVIEW_LABEL;
      case 'Rejected':
        return rejectedFileText(file.rejectionCode);
      default:
        return file.status ?? '';
    }
  }
  /** Visores de los adjuntos `Available`, en el mismo orden que en `attachments`. */
  readonly viewerFiles = input<readonly FileViewerItem[]>([]);
  readonly timeline = input<readonly FormReviewTimelineEntry[]>([]);
  readonly canReveal = input(false);
  readonly requestChangesMode = input(false);
  /** Pide el valor en claro al backend (auditado); null si falla o se deniega. */
  readonly revealValue = input<(sensitiveAnswerId: string) => Promise<string | null>>(
    async () => null,
  );

  readonly tab = model<FormReviewTab>('answers');
  /** Comentarios por campo: `componentId:rowId → texto`. */
  readonly comments = model<Record<string, string>>({});
  readonly revisionSelected = output<number>();

  readonly tabs: readonly { id: FormReviewTab; label: string }[] = [
    { id: 'answers', label: 'Answers' },
    { id: 'changes', label: 'Changes' },
    { id: 'files', label: 'Files' },
    { id: 'activity', label: 'Activity' },
  ];
  readonly revealTarget = signal<AnswerSlotEntry | null>(null);
  readonly revealed = signal<{ key: string; value: string } | null>(null);
  readonly viewerOpen = signal(false);
  readonly viewerIndex = signal(0);
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cambia con la request o la revisión; cualquier cambio oculta el valor revelado. */
  private readonly revealScope = computed(
    () => `${this.requestId()}#${this.revision()?.number ?? ''}`,
  );

  readonly visibility = computed(() => {
    const revision = this.revision();
    return revision ? this.engine.evaluateVisibility(this.definition(), revision.answers) : null;
  });
  readonly attachmentsById = computed(() =>
    Object.fromEntries(this.attachments().map((file) => [file.id, file])),
  );
  readonly changes = computed<ChangeView[]>(() => {
    const current = this.revision();
    const previous = this.previousRevision();
    if (!current || !previous) return [];
    return revisionDiff(previous.answers, current.answers).map((entry) =>
      this.changeView(entry, previous.answers, current.answers),
    );
  });

  constructor() {
    effect(() => {
      this.revealScope();
      untracked(() => {
        this.revealTarget.set(null);
        this.hideReveal();
      });
    });
    inject(DestroyRef).onDestroy(() => this.hideReveal());
  }

  date(value: string): string {
    return formatReviewDate(value);
  }

  dateTime(value: string): string {
    return formatReviewDateTime(value);
  }

  humanize(value: string): string {
    return humanizeAction(value);
  }

  selectRevision(event: Event): void {
    this.hideReveal();
    this.revisionSelected.emit(Number((event.target as HTMLSelectElement).value));
  }

  openFile(attachmentId: string): void {
    const available = this.attachments().filter((file) => file.status === 'Available');
    const index = available.findIndex((file) => file.id === attachmentId);
    if (index < 0) return;
    this.viewerIndex.set(index);
    this.viewerOpen.set(true);
  }

  fieldComment(entry: AnswerSlotEntry): string {
    return this.comments()[entryKey(entry)] ?? '';
  }

  setFieldComment(entry: AnswerSlotEntry, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.comments.update((current) => ({ ...current, [entryKey(entry)]: value }));
  }

  sensitiveRef(entry: AnswerSlotEntry): string | null {
    return isRecord(entry.value) && typeof entry.value['sensitiveRef'] === 'string'
      ? entry.value['sensitiveRef']
      : null;
  }

  confirmReveal(entry: AnswerSlotEntry): void {
    if (this.canReveal()) this.revealTarget.set(entry);
  }

  async revealConfirmed(): Promise<void> {
    const target = this.revealTarget();
    const id = target ? this.sensitiveRef(target) : null;
    this.revealTarget.set(null);
    if (!target || !id || !this.canReveal()) return;
    const scope = this.revealScope();
    const value = await this.revealValue()(id);
    // Si mientras tanto cambió la revisión o se perdió el permiso, no se muestra.
    if (!value || scope !== this.revealScope() || !this.canReveal()) return;
    this.hideReveal();
    this.revealed.set({ key: entryKey(target), value });
    this.revealTimer = setTimeout(() => this.hideReveal(), REVEAL_MS);
  }

  revealedFor(entry: AnswerSlotEntry): string | null {
    const value = this.revealed();
    return value?.key === entryKey(entry) && this.canReveal() ? value.value : null;
  }

  hideReveal(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
    this.revealed.set(null);
  }

  private changeView(
    entry: RevisionDiffEntry,
    previous: FormAnswers,
    current: FormAnswers,
  ): ChangeView {
    const found = findReviewComponent(this.definition(), entry.componentId);
    const attachments = this.attachments();
    return {
      key: `${entry.componentId}:${entry.rowId ?? ''}`,
      label: found?.component.label || 'Untitled field',
      rowLabel: entry.rowId
        ? reviewRowLabel(found?.section, entry.rowId, [current, previous])
        : null,
      kind: entry.kind === 'added' ? 'Added' : entry.kind === 'removed' ? 'Removed' : 'Changed',
      tone: entry.kind === 'added' ? 'success' : entry.kind === 'removed' ? 'danger' : 'warning',
      before: formatAnswerValue(found?.component, entry.before, attachments),
      after: formatAnswerValue(found?.component, entry.after, attachments),
    };
  }
}

function entryKey(entry: AnswerSlotEntry): string {
  return `${entry.component.id}:${entry.rowId ?? ''}`;
}
