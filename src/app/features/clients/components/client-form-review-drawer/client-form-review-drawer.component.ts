import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import type { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import {
  FormReviewActionDialogComponent,
  type FormReviewAction,
  type FormReviewActionResult,
} from '@shared/ui/form-review/form-review-action-dialog.component';
import {
  FormReviewPanelComponent,
  type FormReviewTab,
} from '@shared/ui/form-review/form-review-panel.component';
import {
  canChangeReviewDueDate,
  fieldCommentsFrom,
  formatDueDate,
  isOpenReviewStatus,
  reviewStatusLabel,
  reviewStatusTone,
} from '@shared/ui/form-review/form-review.format';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClientFormsStore } from '../../data-access/client-forms.store';

type ClientReviewAction = Exclude<FormReviewAction, 'archive'>;

const ACTION_MESSAGES: Record<ClientReviewAction, string> = {
  return: 'Changes requested',
  complete: 'Request completed',
  cancel: 'Request cancelled',
  dueDate: 'Due date updated',
};

@Component({
  selector: 'app-client-form-review-drawer',
  imports: [
    DrawerComponent,
    FormReviewActionDialogComponent,
    FormReviewPanelComponent,
    StatusPillComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer
      [isOpen]="store.detail() != null"
      [heading]="store.detail()?.request?.title || 'Client form'"
      [subheading]="clientName"
      width="xl"
      bodyClass="p-0"
      (closed)="close()"
    >
      @if (store.detail(); as detail) {
        <header class="border-b border-gray-200 px-6 py-4">
          <div class="flex flex-wrap items-center gap-2">
            <app-status-pill [tone]="tone(detail.request.status)" [soft]="true">{{
              label(detail.request.status)
            }}</app-status-pill>
            <span class="text-xs font-semibold text-gray-500"
              >Revision {{ store.revision()?.number || detail.request.currentRevisionNumber }}</span
            >
            <span class="ml-auto text-xs text-gray-500"
              >{{ detail.progressPercent }}% complete</span
            >
          </div>
          @if (store.actionError() && !action()) {
            <div
              class="mt-3 flex justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <span>{{ store.actionError() }}</span
              ><button
                type="button"
                aria-label="Dismiss error"
                (click)="store.dismissActionError()"
              >
                <ion-icon name="close-outline"></ion-icon>
              </button>
            </div>
          }
          <div class="mt-4 flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <div>
              <p class="text-xs font-semibold uppercase text-gray-500">Due date</p>
              <p class="mt-1 font-semibold text-gray-900">
                {{ dueDate(detail.request.dueAtUtc) || 'No due date' }}
              </p>
            </div>
            @if (canManage() && canChangeDueDate(detail.request.status)) {
              <button
                type="button"
                class="text-xs font-bold text-brand-bold"
                (click)="openAction('dueDate')"
              >
                Change
              </button>
            }
          </div>
        </header>
        <app-form-review-panel
          [requestId]="detail.request.id"
          [definition]="detail.definition"
          [revision]="store.revision()"
          [previousRevision]="store.previousRevision()"
          [revisions]="detail.revisions"
          [attachments]="detail.attachments"
          [viewerFiles]="viewerFiles()"
          [timeline]="detail.timeline"
          [canReveal]="canReveal()"
          [requestChangesMode]="requestChangesMode()"
          [revealValue]="revealValue"
          [(tab)]="tab"
          [(comments)]="comments"
          (revisionSelected)="changeRevision($event)"
        />
      }
      <div drawerFooter class="flex w-full flex-wrap justify-end gap-2">
        @if (store.detail(); as detail) {
          @if (requestChangesMode()) {
            <!-- Modo revisión: se comenta cada campo y recién "Send request" abre el diálogo con el conteo real. -->
            <p class="mr-auto self-center text-xs text-gray-600" role="status" data-testid="request-changes-mode">
              Add a comment to each field that needs changes ·
              {{ commentCount() }} comment{{ commentCount() === 1 ? '' : 's' }}
            </p>
            <button
              type="button"
              class="min-h-10 rounded-full border border-gray-300 px-3 text-sm font-semibold"
              (click)="cancelReturn()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="min-h-10 rounded-full bg-amber-700 px-4 text-sm font-bold text-white"
              (click)="sendReturn()"
            >
              Send request
            </button>
          } @else {
          @if (canReview() && detail.request.status === 'Submitted') {
            <button
              type="button"
              class="min-h-10 rounded-full border border-amber-300 px-3 text-sm font-semibold text-amber-800"
              (click)="beginReturn()"
            >
              Request changes
            </button>
            <button
              type="button"
              class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white"
              (click)="openAction('complete')"
            >
              Complete
            </button>
          }
          @if (canManage() && isOpen(detail.request.status)) {
            <button
              type="button"
              class="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-700"
              (click)="openAction('cancel')"
            >
              Cancel
            </button>
          }
          }
        }
      </div>
    </app-drawer>

    <app-form-review-action-dialog
      [kind]="action()"
      [busy]="store.busy()"
      [dueAtUtc]="store.detail()?.request?.dueAtUtc ?? null"
      [commentCount]="commentCount()"
      [error]="action() ? store.actionError() : null"
      (confirmed)="submitAction($event)"
      (closed)="closeAction()"
    />
  `,
})
export class ClientFormReviewDrawerComponent {
  readonly store = inject(ClientFormsStore);
  private readonly access = inject(AccessStore);
  private readonly cloud = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);
  private readonly panel = viewChild(FormReviewPanelComponent);

  @Output() readonly closed = new EventEmitter<void>();
  @Input() clientName = '';

  readonly tab = signal<FormReviewTab>('answers');
  readonly action = signal<ClientReviewAction | null>(null);
  readonly requestChangesMode = signal(false);
  readonly comments = signal<Record<string, string>>({});

  // Computed sobre AccessStore: reaccionan si los permisos cambian en vivo.
  readonly canReview = computed(() => this.access.can('tasks.form_requests.review'));
  readonly canManage = computed(() => this.access.can('tasks.form_requests.manage'));
  readonly canReveal = computed(() => this.access.can('tasks.form_submissions.reveal'));

  readonly revealValue = (sensitiveAnswerId: string) => this.store.reveal(sensitiveAnswerId);
  readonly viewerFiles = computed<FileViewerItem[]>(() =>
    (this.store.detail()?.attachments ?? [])
      .filter((file) => file.status === 'Available')
      .map((file) => this.cloud.viewerItemForId(file.fileId, file.displayName)),
  );
  readonly commentCount = computed(() => fieldCommentsFrom(this.comments()).length);

  close(): void {
    this.panel()?.hideReveal();
    this.store.close();
    this.closed.emit();
  }

  label(status: string): string {
    return reviewStatusLabel(status);
  }

  tone(status: string): StatusTone {
    return reviewStatusTone(status);
  }

  dueDate(value: string | null): string {
    return formatDueDate(value);
  }

  async changeRevision(number: number): Promise<void> {
    await this.store.loadRevision(number);
  }

  isOpen(status: string): boolean {
    return isOpenReviewStatus(status);
  }

  canChangeDueDate(status: string): boolean {
    return canChangeReviewDueDate(status);
  }

  openAction(kind: ClientReviewAction): void {
    // Con el diálogo abierto el error se pinta dentro; se parte sin el de una acción anterior.
    this.store.dismissActionError();
    this.action.set(kind);
  }

  closeAction(): void {
    this.store.dismissActionError();
    this.action.set(null);
  }

  /** Entra en modo revisión: los comentarios se escriben en el drawer, sin modal encima. */
  beginReturn(): void {
    this.store.dismissActionError();
    this.requestChangesMode.set(true);
    this.tab.set('answers');
  }

  cancelReturn(): void {
    this.requestChangesMode.set(false);
    this.comments.set({});
  }

  sendReturn(): void {
    this.openAction('return');
  }

  async submitAction(result: FormReviewActionResult): Promise<void> {
    if (result.kind === 'archive') return;
    let ok = false;
    if (result.kind === 'return')
      ok = await this.store.returnForChanges(result.note ?? '', fieldCommentsFrom(this.comments()));
    else if (result.kind === 'complete') ok = await this.store.complete(result.note);
    else if (result.kind === 'cancel') ok = await this.store.cancel(result.note);
    else ok = await this.store.changeDueDate(result.dueAtUtc);
    if (!ok) return;
    this.toast.success(ACTION_MESSAGES[result.kind]);
    this.requestChangesMode.set(false);
    this.comments.set({});
    this.action.set(null);
  }
}
