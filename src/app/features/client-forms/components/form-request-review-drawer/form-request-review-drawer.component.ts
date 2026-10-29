import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  OnInit,
  Output,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import type { CustomerSummary } from '@core/customers/customer-summary.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { FormCheckboxControlComponent } from '@shared/ui/form-controls/form-checkbox-control.component';
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
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import type {
  FormProfileUpdateStatus,
  FormRequestRevisionSummary,
  FormSignatureStatus,
  StaffMemberOption,
} from '../../data-access/client-forms.model';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import { FormActionChipComponent } from '../../ui/form-action-chip/form-action-chip.component';
import { resendErrorMessage } from '../../utils/external-forms';
import { signatureStatusLabel, signatureStatusTone } from '../../utils/signature-status';
import { firstValueFrom } from 'rxjs';

type StaffDialog = 'responsible' | 'link' | null;

// Tope de recordatorios (O-5). Solo rotula el contador; el backend es la fuente de verdad del límite.
const MAX_REMINDERS = 5;
// Firma que ya no se completará: el backend deja el alta en Skipped.
const SIGNATURE_ENDED: FormSignatureStatus[] = ['Declined', 'Canceled', 'Expired', 'Failed'];

const ACTION_MESSAGES: Record<FormReviewAction, string> = {
  return: 'Changes requested',
  complete: 'Request completed',
  cancel: 'Request cancelled',
  archive: 'Request archived',
  dueDate: 'Due date updated',
};

@Component({
  selector: 'app-form-request-review-drawer',
  imports: [
    ConfirmDialogComponent,
    CustomerPickerComponent,
    DrawerComponent,
    FormCheckboxControlComponent,
    FormActionChipComponent,
    FormReviewActionDialogComponent,
    FormReviewPanelComponent,
    ModalComponent,
    StateBlockComponent,
    StatusPillComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer
      [isOpen]="store.detail() != null || store.detailLoading()"
      [heading]="store.detail()?.request?.title || 'Form request'"
      [subheading]="drawerSubheading()"
      width="xl"
      bodyClass="p-0"
      (closed)="close()"
    >
      @if (store.detailLoading() && !store.detail()) {
        <app-state-block [loading]="true" loadingText="Loading request…" />
      } @else if (store.detail(); as detail) {
        <div class="border-b border-gray-200 px-6 py-4">
          <div class="flex flex-wrap items-center gap-2">
            <app-status-pill [tone]="statusTone(detail.request.status)" [soft]="true">
              {{ statusLabel(detail.request.status) }}
            </app-status-pill>
            @if (isOverdue()) {
              <app-status-pill tone="danger" [soft]="true" data-testid="overdue-pill">
                Overdue
              </app-status-pill>
            }
            <span class="text-xs font-semibold text-gray-500"
              >Revision {{ selectedRevisionNumber() }}</span
            >
            @if (signatureLabel(); as label) {
              <app-status-pill
                [tone]="signatureTone()"
                [soft]="true"
                data-testid="signature-status"
                >{{ label }}</app-status-pill
              >
            }
            <span class="ml-auto text-xs text-gray-500"
              >{{ detail.progressPercent }}% complete</span
            >
          </div>
          @if (store.actionError() && !modalOpen()) {
            <div
              class="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              role="alert"
            >
              <span>{{ store.actionError() }}</span>
              <button
                type="button"
                class="-m-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-red-100"
                aria-label="Dismiss error"
                (click)="store.dismissActionError()"
              >
                <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
              </button>
            </div>
          }
          @if (store.processingTimedOut()) {
            <p
              class="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              role="status"
            >
              Still processing. You can close this panel and check again later.
            </p>
          }
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div class="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <p class="text-xs font-semibold uppercase text-gray-500">Participant</p>
              <p class="mt-1 font-semibold text-gray-900">{{ participantName() }}</p>
              @if (participantEmail()) {
                <p class="text-xs text-gray-500">{{ participantEmail() }}</p>
              }
            </div>
            <div class="rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <p class="text-xs font-semibold uppercase text-gray-500">Due date</p>
              <p class="mt-1 font-semibold text-gray-900">
                {{ dueDate(detail.request.dueAtUtc) || 'No due date' }}
              </p>
              <p class="mt-2 text-xs font-semibold text-gray-500" data-testid="reminder-count">
                Reminders sent: {{ detail.request.reminderCount ?? 0 }}/{{ maxReminders }}
              </p>
              <div class="mt-1 flex items-center gap-3">
                @if (canManage() && canChangeDueDate(detail.request.status)) {
                  <button
                    type="button"
                    class="text-xs font-bold text-brand-bold"
                    (click)="openDialog('dueDate')"
                  >
                    Change
                  </button>
                }
                @if (canSendReminder()) {
                  <button
                    type="button"
                    class="text-xs font-bold text-brand-bold disabled:opacity-50"
                    data-testid="send-reminder"
                    [disabled]="store.actionBusy()"
                    (click)="openReminder()"
                  >
                    Send reminder
                  </button>
                }
              </div>
            </div>
          </div>
        </div>

        @if (detail.actionRuns.length || detail.customerLink.status === 'Blocked' || waitsForSignature()) {
          <section
            class="border-b border-gray-200 bg-gray-50 px-6 py-4"
            aria-labelledby="automation-heading"
          >
            <div class="flex items-center justify-between gap-3">
              <h3 id="automation-heading" class="text-sm font-bold text-gray-900">Automation</h3>
              @if (
                canStartOnboarding() &&
                detail.customerLink.status === 'None' &&
                !hasCustomerAction() &&
                !waitsForSignature()
              ) {
                <button
                  type="button"
                  class="text-xs font-bold text-brand-bold"
                  [disabled]="store.actionBusy()"
                  (click)="startOnboarding()"
                >
                  Start onboarding
                </button>
              }
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              @if (waitsForSignature()) {
                <p class="flex items-center gap-2 text-xs text-gray-600" data-testid="waiting-signature">
                  <app-status-pill tone="warning" [soft]="true" size="xs">Waiting for signature</app-status-pill>
                  Create client runs after the participant signs.
                </p>
              }
              @for (run of detail.actionRuns; track run.id) {
                <app-form-action-chip [run]="run" (retried)="retryAction($event)" />
                @if (run.existingCustomerId && canReview()) {
                  <button
                    type="button"
                    class="text-xs font-bold text-brand-bold"
                    (click)="prepareExistingCustomer(run.existingCustomerId)"
                  >
                    Review match
                  </button>
                }
              }
              @if (detail.customerLink.status === 'Blocked') {
                <button
                  type="button"
                  class="text-xs font-bold text-red-700"
                  [disabled]="store.actionBusy()"
                  (click)="retryCustomerLink()"
                >
                  Retry client link
                </button>
              }
            </div>
          </section>
        }

        @if (summaryRevision(); as summary) {
          <section class="border-b border-gray-200 bg-gray-50 px-6 py-4" aria-labelledby="summary-heading">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 id="summary-heading" class="text-sm font-bold text-gray-900">Submission summary</h3>
                <p class="mt-0.5 text-xs text-gray-600">
                  @switch (summary.pdfStatus) {
                    @case ('Ready') { A PDF copy of the submitted information. }
                    @case ('Failed') { The summary could not be generated. }
                    @default { The summary is being generated… }
                  }
                </p>
              </div>
              @if (summary.pdfStatus === 'Ready' && summary.pdfFileId) {
                <button
                  type="button"
                  class="min-h-10 rounded-full border border-gray-300 px-3 text-sm font-semibold"
                  data-testid="download-summary"
                  (click)="downloadSummary()"
                >
                  Download summary
                </button>
              } @else if (summary.pdfStatus === 'Failed' && canReview()) {
                <button
                  type="button"
                  class="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-700"
                  data-testid="retry-summary"
                  [disabled]="store.actionBusy()"
                  (click)="retrySummary()"
                >
                  Retry
                </button>
              }
            </div>
          </section>
        }

        @if (showApplyProfile()) {
          <section
            class="border-b border-gray-200 bg-gray-50 px-6 py-4"
            aria-labelledby="apply-profile-heading"
          >
            <div class="flex items-center justify-between gap-3">
              <h3 id="apply-profile-heading" class="text-sm font-bold text-gray-900">
                Apply to client profile
              </h3>
              @if (profileStatus() !== 'None') {
                <app-status-pill [tone]="profileStatusTone()" [soft]="true">
                  {{ profileStatusLabel() }}
                </app-status-pill>
              }
            </div>

            @if (profileStatus() === 'Processing') {
              <p class="mt-2 text-xs text-gray-600">
                The approved answers are being applied to the client profile…
              </p>
            } @else {
              <p class="mt-1 text-xs text-gray-600">
                Choose which answers to copy to the client's profile. Nothing is applied until you
                select fields and confirm.
              </p>
              @if (store.profileFieldsLoading()) {
                <p class="mt-2 text-xs text-gray-500">Loading fields…</p>
              } @else if (store.profileFields().length === 0) {
                <p class="mt-2 text-xs text-gray-500">This form has no fields mapped to the profile.</p>
              } @else {
                <div class="mt-3 space-y-2">
                  @for (field of nonTaxProfileFields(); track field.componentId) {
                    <app-form-checkbox-control
                      [id]="'apply-' + field.componentId"
                      [checked]="isFieldSelected(field.componentId)"
                      [disabled]="store.actionBusy() || (field.requiresAdmin && !isAdmin())"
                      (checkedChange)="toggleField(field.componentId, $event)"
                    >
                      {{ field.label }} → {{ field.targetDisplayName }}
                      @if (field.requiresAdmin && !isAdmin()) {
                        <span class="text-xs text-gray-500"> (admin only)</span>
                      }
                    </app-form-checkbox-control>
                  }
                  @if (taxProfileField(); as taxField) {
                    @if (isAdmin()) {
                      <app-form-checkbox-control
                        [id]="'apply-tax-identifier'"
                        [checked]="includeTaxIdentifier()"
                        [disabled]="store.actionBusy()"
                        (checkedChange)="includeTaxIdentifier.set($event)"
                      >
                        {{ taxField.label }} → {{ taxField.targetDisplayName }} (masked)
                      </app-form-checkbox-control>
                    }
                  }
                </div>
                <div class="mt-3">
                  <button
                    type="button"
                    class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-semibold text-white disabled:opacity-50"
                    data-testid="apply-profile"
                    [disabled]="store.actionBusy() || !hasProfileSelection()"
                    (click)="applyProfile()"
                  >
                    Apply to profile
                  </button>
                </div>
              }
            }

            @if (profileOutcomes().length) {
              <ul class="mt-3 space-y-1 text-xs">
                @for (outcome of profileOutcomes(); track outcome.target) {
                  <li [class.text-green-700]="outcome.applied" [class.text-red-700]="!outcome.applied">
                    {{ outcome.target }} —
                    {{ outcome.applied ? 'applied' : (outcome.failureCode || 'not applied') }}
                  </li>
                }
              </ul>
            }
          </section>
        }

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
          @if (canResendAccess()) {
            <button
              type="button"
              class="mr-auto min-h-10 rounded-full border border-gray-300 px-3 text-sm font-semibold"
              data-testid="resend-access"
              (click)="openResend()"
            >
              Resend link
            </button>
          }
          <!-- Assign sigue en Completed: un run reintentable avisa al responsable (P-19). -->
          @if (canManage() && detail.request.status !== 'Cancelled') {
            <button
              type="button"
              class="min-h-10 rounded-full border border-gray-300 px-3 text-sm font-semibold"
              (click)="openDialog('responsible')"
            >
              Assign
            </button>
          }
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
              (click)="openDialog('complete')"
            >
              Complete
            </button>
          }
          @if (canManage() && isOpen(detail.request.status)) {
            <button
              type="button"
              class="min-h-10 rounded-full border border-red-200 px-3 text-sm font-semibold text-red-700"
              (click)="openDialog('cancel')"
            >
              Cancel
            </button>
            <button
              type="button"
              class="min-h-10 rounded-full border border-gray-300 px-3 text-sm font-semibold"
              (click)="openDialog('archive')"
            >
              Archive
            </button>
          }
          }
        }
      </div>
    </app-drawer>

    <app-form-review-action-dialog
      [kind]="action()"
      [busy]="store.actionBusy()"
      [dueAtUtc]="store.detail()?.request?.dueAtUtc ?? null"
      [commentCount]="commentCount()"
      [error]="action() ? store.actionError() : null"
      (confirmed)="submitAction($event)"
      (closed)="closeAction()"
    />

    <app-confirm-dialog
      [isOpen]="resendOpen()"
      heading="Resend access link?"
      [message]="resendMessage()"
      confirmLabel="Resend link"
      tone="primary"
      icon="paper-plane-outline"
      [busy]="resending()"
      busyLabel="Sending…"
      (cancelled)="closeResend()"
      (confirmed)="resendAccess()"
    >
      @if (resendError()) {
        <p role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ resendError() }}
        </p>
      }
    </app-confirm-dialog>

    <app-confirm-dialog
      [isOpen]="reminderOpen()"
      heading="Send a reminder?"
      [message]="reminderMessage()"
      confirmLabel="Send reminder"
      tone="primary"
      icon="notifications-outline"
      [busy]="store.actionBusy()"
      busyLabel="Sending…"
      (cancelled)="closeReminder()"
      (confirmed)="sendReminder()"
    >
      @if (store.actionError()) {
        <p role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ store.actionError() }}
        </p>
      }
    </app-confirm-dialog>

    <app-modal
      [isOpen]="dialog() != null"
      [heading]="dialog() === 'link' ? 'Link to existing client' : 'Assign responsible'"
      size="md"
      (closed)="closeDialog()"
    >
      <div class="space-y-4 p-6">
        @if (store.actionError()) {
          <p
            role="alert"
            class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {{ store.actionError() }}
          </p>
        }
        @if (dialog() === 'link') {
          <p class="text-sm text-gray-600">
            Choose the existing client that should own this submission.
          </p>
          <app-customer-picker
            [selectedId]="selectedCustomerId()"
            (selectedChange)="selectCustomer($event)"
          />
        } @else {
          <label class="block text-sm font-semibold text-gray-700"
            >Responsible staff member
            <select
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
              [value]="selectedStaffId()"
              (change)="selectedStaffId.set(value($event))"
            >
              <option value="">Select a staff member</option>
              @for (member of staff(); track member.userId) {
                <option [value]="member.userId" [selected]="member.userId === selectedStaffId()">{{ member.name }} · {{ member.email }}</option>
              }
            </select>
          </label>
        }
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="closeDialog()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white disabled:opacity-50"
            [disabled]="!dialogReady() || store.actionBusy()"
            (click)="submitDialog()"
          >
            {{ store.actionBusy() ? 'Saving…' : 'Confirm' }}
          </button>
        </div>
      </div>
    </app-modal>
  `,
})
export class FormRequestReviewDrawerComponent implements OnInit {
  readonly store = inject(FormRequestsStore);
  private readonly service = inject(FormRequestsService);
  private readonly access = inject(AccessStore);
  private readonly cloud = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);
  private readonly availability = inject(ClientFormsAvailabilityStore);
  private readonly panel = viewChild(FormReviewPanelComponent);

  @Output() readonly closed = new EventEmitter<void>();

  readonly tab = signal<FormReviewTab>('answers');
  readonly action = signal<FormReviewAction | null>(null);
  readonly dialog = signal<StaffDialog>(null);
  readonly selectedCustomerId = signal<string | null>(null);
  readonly selectedStaffId = signal('');
  readonly staff = signal<StaffMemberOption[]>([]);
  readonly requestChangesMode = signal(false);
  readonly comments = signal<Record<string, string>>({});
  readonly resendOpen = signal(false);
  readonly resending = signal(false);
  readonly resendError = signal<string | null>(null);
  readonly reminderOpen = signal(false);
  readonly maxReminders = MAX_REMINDERS;

  // P-13 — selección del checklist "apply to client profile".
  readonly selectedProfileFields = signal<string[]>([]);
  readonly includeTaxIdentifier = signal(false);
  private loadedProfileFor: string | null = null;
  // Carga el checklist y reinicia la selección al abrir una request Completed distinta.
  private readonly profileFieldsEffect = effect(() => {
    const detail = this.store.detail();
    if (!detail || detail.request.status !== 'Completed' || !this.canApplyProfile()) return;
    if (detail.request.id === this.loadedProfileFor) return;
    this.loadedProfileFor = detail.request.id;
    this.selectedProfileFields.set([]);
    this.includeTaxIdentifier.set(false);
    void this.store.loadProfileFields();
  });

  // Computed sobre AccessStore: reaccionan si los permisos cambian en vivo.
  readonly canReview = computed(() => this.access.can('tasks.form_requests.review'));
  readonly canManage = computed(() => this.access.can('tasks.form_requests.manage'));
  readonly canReveal = computed(() => this.access.can('tasks.form_submissions.reveal'));
  readonly canStartOnboarding = computed(
    () =>
      this.canReview() &&
      this.access.can('customers.manage') &&
      this.store.detail()?.request.participant.kind === 'External',
  );

  // P-13 — aplicar al perfil: requiere apply_profile + manage; el SSN y lo fiscal solo si es admin.
  readonly isAdmin = this.access.isAdmin;
  readonly canApplyProfile = computed(
    () => this.canManage() && this.access.can('tasks.form_requests.apply_profile'),
  );
  readonly profileStatus = computed<FormProfileUpdateStatus>(
    () => this.store.detail()?.request.profileUpdateStatus ?? 'None',
  );
  readonly profileOutcomes = computed(
    () => this.store.detail()?.request.profileUpdateOutcomes ?? [],
  );
  readonly nonTaxProfileFields = computed(() =>
    this.store.profileFields().filter((field) => !field.isTaxId),
  );
  readonly taxProfileField = computed(
    () => this.store.profileFields().find((field) => field.isTaxId) ?? null,
  );
  readonly hasProfileSelection = computed(
    () => this.selectedProfileFields().length > 0 || this.includeTaxIdentifier(),
  );
  readonly showApplyProfile = computed(() => {
    const detail = this.store.detail();
    return (
      !!detail &&
      detail.request.status === 'Completed' &&
      this.canApplyProfile() &&
      (this.store.profileFields().length > 0 || this.profileStatus() !== 'None')
    );
  });

  // Solo requests dirigidas a un externo (las de captación no tienen enlace personal) y editables
  // por él: Pending o Returned. Un backend previo sin `origin` cuenta como dirigida. Máximo 5 emisiones.
  readonly canResendAccess = computed(() => {
    const request = this.store.detail()?.request;
    return (
      !!request &&
      request.participant.kind === 'External' &&
      request.origin !== 'IntakeLink' &&
      (request.status === 'Pending' || request.status === 'Returned') &&
      this.access.can('tasks.form_requests.send_external') &&
      this.availability.externalParticipantsEnabled()
    );
  });

  // Recordatorio manual: solo quien gestiona, y mientras la request sigue abierta (Pending o Returned).
  readonly canSendReminder = computed(() => {
    const status = this.store.detail()?.request.status;
    return this.canManage() && (status === 'Pending' || status === 'Returned');
  });

  // Vencida: fecha límite pasada y request abierta. Se parsea como UTC para no correr la fecha.
  readonly isOverdue = computed(() => {
    const request = this.store.detail()?.request;
    if (!request || !this.isOpen(request.status)) return false;
    const due = parseUtcDateOrNull(request.dueAtUtc);
    return due != null && due.getTime() < Date.now();
  });

  readonly revealValue = (sensitiveAnswerId: string) => this.store.reveal(sensitiveAnswerId);
  readonly viewerFiles = computed<FileViewerItem[]>(() =>
    (this.store.detail()?.attachments ?? [])
      .filter((file) => file.status === 'Available')
      .map((file) => this.cloud.viewerItemForId(file.fileId, file.displayName)),
  );
  readonly selectedRevisionNumber = computed(
    () => this.store.revision()?.number ?? this.store.detail()?.request.currentRevisionNumber ?? 0,
  );
  // Submission summary (P-11): la revisión completada y el estado de su PDF para el drawer.
  readonly summaryRevision = computed<FormRequestRevisionSummary | null>(() => {
    const detail = this.store.detail();
    if (!detail || detail.request.status !== 'Completed') return null;
    return detail.revisions.find((r) => r.number === detail.request.currentRevisionNumber) ?? null;
  });
  // P-18 — firma de la revisión seleccionada; `None`/ausente se ocultan.
  readonly signatureStatus = computed<FormSignatureStatus>(() => {
    const detail = this.store.detail();
    if (!detail) return 'None';
    const number = this.selectedRevisionNumber();
    return (
      detail.revisions.find((r) => r.number === number)?.signatureStatus ??
      this.store.revision()?.signatureStatus ??
      'None'
    );
  });
  // Alta de cliente configurada para esperar la firma y aún sin run: se avisa en vez de ofrecer el arranque manual.
  readonly waitsForSignature = computed(() => {
    const detail = this.store.detail();
    if (
      !detail ||
      detail.request.participant.kind !== 'External' ||
      detail.customerLink.status !== 'None' ||
      this.hasCustomerAction()
    )
      return false;
    const current = detail.revisions.find((r) => r.number === detail.request.currentRevisionNumber);
    if (current?.signatureStatus && SIGNATURE_ENDED.includes(current.signatureStatus)) return false;
    return (detail.definition.actions ?? []).some(
      (action) =>
        action.type === 'createCustomer' &&
        action.trigger === 'onSubmit' &&
        action.config?.['waitFor'] === 'signatureCompleted',
    );
  });
  readonly commentCount = computed(() => fieldCommentsFrom(this.comments()).length);
  // Con un modal abierto el error se pinta dentro de él, no detrás.
  readonly modalOpen = computed(() => this.action() != null || this.dialog() != null);

  async ngOnInit(): Promise<void> {
    if (this.canManage()) {
      try {
        this.staff.set(await firstValueFrom(this.service.activeStaff()));
      } catch {
        this.staff.set([]);
      }
    }
  }

  close(): void {
    this.panel()?.hideReveal();
    this.store.close();
    this.closed.emit();
  }

  drawerSubheading(): string {
    const detail = this.store.detail();
    return detail ? `${this.participantName()} · Version ${detail.request.versionNumber}` : '';
  }

  participantName(): string {
    const detail = this.store.detail();
    return (
      this.store.selectedItem()?.displayName ||
      detail?.displayName ||
      (detail?.request.participant.kind === 'External' ? 'External participant' : 'Client submission')
    );
  }

  participantEmail(): string | null {
    // La fila puede venir sin email: se cae al del detalle.
    return this.store.selectedItem()?.maskedEmail ?? this.store.detail()?.maskedEmail ?? null;
  }

  isOpen(status: string): boolean {
    return isOpenReviewStatus(status);
  }

  canChangeDueDate(status: string): boolean {
    return canChangeReviewDueDate(status);
  }

  statusLabel(status: string): string {
    return reviewStatusLabel(status);
  }

  statusTone(status: string): StatusTone {
    return reviewStatusTone(status);
  }

  dueDate(value: string | null): string {
    return formatDueDate(value);
  }

  signatureLabel(): string | null {
    return signatureStatusLabel(this.signatureStatus());
  }

  signatureTone(): StatusTone {
    return signatureStatusTone(this.signatureStatus());
  }

  async changeRevision(number: number): Promise<void> {
    await this.store.loadRevision(number);
  }

  openDialog(kind: FormReviewAction | Exclude<StaffDialog, null>): void {
    this.store.dismissActionError();
    if (kind === 'responsible' || kind === 'link') {
      this.selectedStaffId.set(this.store.detail()?.request.responsibleUserId ?? '');
      this.dialog.set(kind);
    } else {
      this.action.set(kind);
    }
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
    this.openDialog('return');
  }

  async submitAction(result: FormReviewActionResult): Promise<void> {
    let success = false;
    if (result.kind === 'return')
      success = await this.store.returnForChanges(
        result.note ?? '',
        fieldCommentsFrom(this.comments()),
      );
    else if (result.kind === 'complete') success = await this.store.complete(result.note);
    else if (result.kind === 'cancel') success = await this.store.cancel(result.note);
    else if (result.kind === 'archive') success = await this.store.archive(result.note);
    else success = await this.store.changeDueDate(result.dueAtUtc);
    if (!success) return;
    this.toast.success(ACTION_MESSAGES[result.kind]);
    this.requestChangesMode.set(false);
    this.comments.set({});
    this.action.set(null);
  }

  closeAction(): void {
    // El error ya se vio dentro del diálogo; no reaparece en el drawer.
    this.store.dismissActionError();
    this.action.set(null);
  }

  closeDialog(): void {
    this.store.dismissActionError();
    this.dialog.set(null);
  }

  dialogReady(): boolean {
    if (this.dialog() === 'responsible') return this.selectedStaffId().length > 0;
    if (this.dialog() === 'link') return this.selectedCustomerId() != null;
    return false;
  }

  async submitDialog(): Promise<void> {
    const kind = this.dialog();
    let success = false;
    if (kind === 'responsible')
      success = await this.store.assignResponsible(this.selectedStaffId());
    else if (kind === 'link' && this.selectedCustomerId())
      success = await this.store.linkCustomer(this.selectedCustomerId()!);
    if (!success) return;
    this.toast.success(kind === 'responsible' ? 'Responsible staff updated' : 'Client linked');
    this.closeDialog();
  }

  resendMessage(): string {
    const email = this.participantEmail();
    return `We'll email a new link${email ? ` to ${email}` : ''}. The previous link stops working right away. Each request allows up to 5 links.`;
  }

  openResend(): void {
    this.resendError.set(null);
    this.resendOpen.set(true);
  }

  closeResend(): void {
    if (this.resending()) return;
    this.resendOpen.set(false);
    this.resendError.set(null);
  }

  async resendAccess(): Promise<void> {
    const id = this.store.detail()?.request.id;
    if (!id || this.resending()) return;
    this.resending.set(true);
    this.resendError.set(null);
    try {
      await firstValueFrom(this.service.resendExternalAccess(id));
      this.resendOpen.set(false);
      this.toast.success('Access link resent');
    } catch (error) {
      this.resendError.set(resendErrorMessage(error));
    } finally {
      this.resending.set(false);
    }
  }

  reminderMessage(): string {
    const count = this.store.detail()?.request.reminderCount ?? 0;
    return `We'll email the client a reminder. Reminders sent so far: ${count}/${this.maxReminders}.`;
  }

  openReminder(): void {
    this.store.dismissActionError();
    this.reminderOpen.set(true);
  }

  closeReminder(): void {
    if (this.store.actionBusy()) return;
    this.store.dismissActionError();
    this.reminderOpen.set(false);
  }

  async sendReminder(): Promise<void> {
    if (await this.store.sendReminder()) {
      this.reminderOpen.set(false);
      this.toast.success('Reminder sent');
    }
    // En 409 (tope alcanzado) el store deja el mensaje y el diálogo lo muestra.
  }

  hasCustomerAction(): boolean {
    return (
      this.store.detail()?.actionRuns.some((run) => run.actionType === 'CreateCustomer') ?? false
    );
  }

  async startOnboarding(): Promise<void> {
    if (await this.store.startCustomerCreation()) this.toast.info('Client creation requested');
  }

  async retryAction(runId: string): Promise<void> {
    if (await this.store.retryAction(runId)) this.toast.info('Action retry requested');
  }

  async retryCustomerLink(): Promise<void> {
    if (await this.store.retryCustomerLink()) this.toast.info('Client link retry requested');
  }

  async downloadSummary(): Promise<void> {
    const fileId = this.summaryRevision()?.pdfFileId;
    if (!fileId) return;
    try {
      const res = await firstValueFrom(this.cloud.getDownloadUrl(fileId));
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch {
      this.toast.error('Could not open the summary');
    }
  }

  async retrySummary(): Promise<void> {
    if (await this.store.retrySummary()) this.toast.info('Summary retry requested');
  }

  isFieldSelected(componentId: string): boolean {
    return this.selectedProfileFields().includes(componentId);
  }

  toggleField(componentId: string, checked: boolean): void {
    const current = this.selectedProfileFields();
    this.selectedProfileFields.set(
      checked ? [...current, componentId] : current.filter((id) => id !== componentId),
    );
  }

  async applyProfile(): Promise<void> {
    const ids = new Set(this.selectedProfileFields());
    // El taxId se aplica solo con su checkbox, pero su componentId debe ir para que el backend lo arme.
    if (this.includeTaxIdentifier()) {
      const tax = this.taxProfileField();
      if (tax) ids.add(tax.componentId);
    }
    if (ids.size === 0 && !this.includeTaxIdentifier()) return;
    const applied = await this.store.applyProfileUpdate({
      componentIds: [...ids],
      includeTaxIdentifier: this.includeTaxIdentifier(),
    });
    if (applied) this.toast.info('Profile update requested');
  }

  profileStatusLabel(): string {
    switch (this.profileStatus()) {
      case 'Processing':
        return 'Processing';
      case 'Applied':
        return 'Applied';
      case 'PartiallyApplied':
        return 'Partially applied';
      case 'Rejected':
        return 'Rejected';
      default:
        return '';
    }
  }

  profileStatusTone(): StatusTone {
    switch (this.profileStatus()) {
      case 'Applied':
        return 'success';
      case 'PartiallyApplied':
        return 'warning';
      case 'Rejected':
        return 'danger';
      default:
        return 'info';
    }
  }

  prepareExistingCustomer(customerId: string): void {
    this.selectedCustomerId.set(customerId);
    this.openDialog('link');
  }

  selectCustomer(customer: CustomerSummary | null): void {
    this.selectedCustomerId.set(customer?.id ?? null);
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }
}
