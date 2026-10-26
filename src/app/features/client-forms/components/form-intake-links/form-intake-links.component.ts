import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import {
  DropdownMenuComponent,
  MenuItemDirective,
} from '@shared/ui/dropdown-menu/dropdown-menu.component';
import {
  FormSelectControlComponent,
  type FormControlOption,
} from '@shared/ui/form-controls/form-select-control.component';
import { earliestDueDate, formatDueDate } from '@shared/ui/form-review/form-review.format';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import type {
  FormIntakeLink,
  FormIntakeLinkStatus,
  FormTemplateVersionSummary,
} from '../../data-access/client-forms.model';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormIntakeLinksStore } from '../../data-access/form-intake-links.store';

type ConfirmKind = 'revoke' | 'regenerate';

/** Fin del día UTC elegido: el enlace sirve durante toda esa fecha. */
function expirationToUtc(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59Z` : null;
}

/** Enlaces de captación (P-14 flujo B): listar, crear y cambiar de estado. */
@Component({
  selector: 'app-form-intake-links',
  imports: [
    ConfirmDialogComponent,
    DropdownMenuComponent,
    FormSelectControlComponent,
    MenuItemDirective,
    ModalComponent,
    StateBlockComponent,
    StatusPillComponent,
  ],
  providers: [FormIntakeLinksStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="intake-links-heading">
      <div class="flex flex-wrap items-end justify-between gap-3 py-5">
        <div>
          <h2 id="intake-links-heading" class="text-xl font-bold text-gray-900">Intake links</h2>
          <p class="mt-1 text-sm text-gray-500">
            Public links where prospects verify their email and fill out a form.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-bold px-4 text-sm font-bold text-white hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="new-intake-link"
          [disabled]="!enabled()"
          (click)="openCreate()"
        >
          <ion-icon name="add-outline"></ion-icon>New intake link
        </button>
      </div>

      @if (!enabled()) {
        <div
          class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
          data-testid="intake-links-off"
        >
          Intake links are turned off for this office. They need bot protection (Turnstile) to be
          configured first. You can still pause or revoke existing links.
        </div>
      }

      @if (store.actionError() && !anyModalOpen()) {
        <div
          role="alert"
          class="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <span>{{ store.actionError() }}</span>
          <button type="button" aria-label="Dismiss error" (click)="store.dismissActionError()">
            <ion-icon name="close-outline"></ion-icon>
          </button>
        </div>
      }

      <div class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <app-state-block
          [loading]="store.loading()"
          [error]="store.error()"
          [empty]="!store.loading() && !store.error() && store.links().length === 0"
          emptyTitle="No intake links yet"
          [emptyMessage]="
            enabled()
              ? 'Create a link to collect information from people who are not clients yet.'
              : 'Intake links will be available once bot protection is configured.'
          "
          icon="link-outline"
          variant="inline"
          minHeight="16rem"
          (retry)="reload()"
        >
          <div class="overflow-x-auto">
            <table class="w-full min-w-[56rem] text-left">
              <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th class="px-5 py-3 font-semibold">Link</th>
                  <th class="px-5 py-3 font-semibold">Form</th>
                  <th class="px-5 py-3 font-semibold">Responsible</th>
                  <th class="px-5 py-3 font-semibold">Submissions</th>
                  <th class="px-5 py-3 font-semibold">Expires</th>
                  <th class="px-5 py-3 font-semibold">Status</th>
                  <th class="w-12 px-3 py-3"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (link of store.links(); track link.id) {
                  <tr>
                    <td class="px-5 py-4">
                      <p class="font-semibold text-gray-900">{{ link.name }}</p>
                      <p class="mt-0.5 text-xs text-gray-500">…{{ link.tokenLast4 }}</p>
                    </td>
                    <td class="px-5 py-4">
                      <p class="font-semibold text-gray-900">
                        {{ store.templateName(link.formTemplateId) }}
                      </p>
                      <p class="mt-0.5 text-xs text-gray-500">
                        {{ versionLabel(link) }}
                        @if (store.noticeTitle(link.entryNoticeId); as notice) {
                          · {{ notice }}
                        }
                      </p>
                    </td>
                    <td class="px-5 py-4 text-sm text-gray-700">
                      {{ store.responsibleName(link.responsibleUserId) }}
                    </td>
                    <td class="px-5 py-4 text-sm text-gray-700">
                      {{ link.submissionCount }} /
                      {{ link.maxSubmissions ?? 'No limit' }}
                      @if (limitReached(link)) {
                        <span class="ml-1 text-xs font-bold text-amber-700">Limit reached</span>
                      }
                    </td>
                    <td class="px-5 py-4 text-sm text-gray-700">
                      {{ link.expiresAtUtc ? expiration(link.expiresAtUtc) : 'Never' }}
                      @if (isExpired(link)) {
                        <span class="ml-1 text-xs font-bold text-red-700">Expired</span>
                      }
                    </td>
                    <td class="px-5 py-4">
                      <app-status-pill [tone]="statusTone(link.status)" [soft]="true" size="xs">{{
                        link.status
                      }}</app-status-pill>
                    </td>
                    <td class="px-3 py-4 text-right">
                      <app-dropdown-menu
                        [ariaLabel]="'Actions for ' + link.name"
                        [disabled]="store.busyId() != null"
                      >
                        @if (link.status !== 'Revoked') {
                          @if (enabled()) {
                            <button appMenuItem type="button" (click)="copyLink(link)">
                              <ion-icon name="copy-outline" class="text-base"></ion-icon> Copy link
                            </button>
                          }
                          @if (link.status === 'Active') {
                            <button appMenuItem type="button" (click)="change(link, 'pause')">
                              <ion-icon name="pause-outline" class="text-base"></ion-icon> Pause
                            </button>
                          }
                          @if (link.status === 'Paused' && enabled()) {
                            <button appMenuItem type="button" (click)="change(link, 'resume')">
                              <ion-icon name="play-outline" class="text-base"></ion-icon> Resume
                            </button>
                          }
                          @if (enabled() && !store.versionsForbidden()) {
                            <button appMenuItem type="button" (click)="openPin(link)">
                              <ion-icon name="git-branch-outline" class="text-base"></ion-icon>
                              Change version
                            </button>
                          }
                          @if (enabled()) {
                            <button appMenuItem type="button" (click)="askConfirm(link, 'regenerate')">
                              <ion-icon name="refresh-outline" class="text-base"></ion-icon>
                              Regenerate link
                            </button>
                          }
                          <button
                            appMenuItem
                            [danger]="true"
                            type="button"
                            (click)="askConfirm(link, 'revoke')"
                          >
                            <ion-icon name="ban-outline" class="text-base"></ion-icon> Revoke
                          </button>
                        } @else {
                          <p class="px-4 py-3 text-xs text-gray-500">Revoked links can't change.</p>
                        }
                      </app-dropdown-menu>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-state-block>
      </div>
    </section>

    <!-- Crear enlace -->
    <app-modal
      [isOpen]="createOpen()"
      heading="New intake link"
      subheading="Prospects see the entry notice, verify their email with a code and fill out the form."
      size="lg"
      (closed)="closeCreate()"
    >
      <form class="space-y-4 p-6" novalidate (submit)="create($event)">
        <label class="block text-sm font-semibold text-gray-700"
          >Internal name
          <input
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
            maxlength="120"
            required
            placeholder="Website intake 2026"
            [value]="name()"
            (input)="name.set(value($event))"
          />
        </label>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm font-semibold text-gray-700" for="intake-template"
              >Template</label
            >
            <div class="mt-1">
              <app-form-select-control
                [id]="'intake-template'"
                placeholder="Select a published template"
                [required]="true"
                [options]="templateOptions()"
                [value]="templateId()"
                (valueChange)="selectTemplate($event)"
              />
            </div>
          </div>
          <div>
            @if (store.versionsForbidden()) {
              <p class="block text-sm font-semibold text-gray-700">Version</p>
              <p
                class="mt-1 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600"
                data-testid="versions-forbidden"
              >
                You can't see template versions; the link uses the latest version.
              </p>
            } @else {
              <label class="block text-sm font-semibold text-gray-700" for="intake-version"
                >Version</label
              >
              <div class="mt-1">
                <app-form-select-control
                  [id]="'intake-version'"
                  placeholder="Latest published version"
                  [disabled]="!templateId()"
                  [options]="versionOptions(createVersions())"
                  [value]="versionId()"
                  (valueChange)="versionId.set($event)"
                />
              </div>
            }
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700" for="intake-responsible"
            >Responsible staff member</label
          >
          <p class="mt-0.5 text-xs text-gray-500">
            Reviews the submissions and gets the notifications. Needs permission to run this form's
            automations.
          </p>
          <div class="mt-1">
            <app-form-select-control
              [id]="'intake-responsible'"
              placeholder="Select a staff member"
              [required]="true"
              [options]="staffOptions()"
              [value]="responsibleId()"
              (valueChange)="responsibleId.set($event)"
            />
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700" for="intake-notice"
            >Entry notice</label
          >
          <p class="mt-0.5 text-xs text-gray-500">
            Shown above the email field: who collects the email and why.
          </p>
          @if (store.noticesFailed()) {
            <p role="alert" class="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              The entry notices couldn't be loaded. Try again later.
            </p>
          } @else if (noticeOptions().length === 0) {
            <p role="alert" class="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              There's no published identity verification notice. Publish one in consent notices
              first.
            </p>
          } @else {
            <div class="mt-1">
              <app-form-select-control
                [id]="'intake-notice'"
                placeholder="Select an entry notice"
                [required]="true"
                [options]="noticeOptions()"
                [value]="noticeKey()"
                (valueChange)="noticeKey.set($event)"
              />
            </div>
          }
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm font-semibold text-gray-700"
            >Submission limit <span class="font-normal text-gray-400">Optional</span>
            <input
              type="number"
              min="1"
              step="1"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
              placeholder="No limit"
              [value]="maxSubmissions()"
              (input)="maxSubmissions.set(value($event))"
            />
            @if (maxSubmissionsInvalid()) {
              <span class="mt-1 block text-xs font-normal text-red-700"
                >Enter a whole number greater than 0.</span
              >
            }
          </label>
          <label class="block text-sm font-semibold text-gray-700"
            >Expires on <span class="font-normal text-gray-400">Optional</span>
            <input
              type="date"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm"
              [min]="minExpiration"
              [value]="expiresOn()"
              (input)="expiresOn.set(value($event))"
            />
            <span class="mt-1 block text-xs font-normal text-gray-500"
              >The link works through the end of this day (UTC).</span
            >
          </label>
        </div>
        @if (store.actionError()) {
          <p role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {{ store.actionError() }}
          </p>
        }
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="closeCreate()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white disabled:opacity-50"
            [disabled]="!createReady() || store.busyId() != null"
          >
            {{ store.busyId() === 'new' ? 'Creating…' : 'Create link' }}
          </button>
        </div>
      </form>
    </app-modal>

    <!-- Fijar otra versión -->
    <app-modal
      [isOpen]="pinTarget() != null"
      heading="Change pinned version"
      [subheading]="pinTarget()?.name ?? ''"
      size="md"
      (closed)="closePin()"
    >
      <div class="space-y-4 p-6">
        <p class="text-sm text-gray-600">
          New prospects get the version you choose. Requests already started keep their version.
        </p>
        @if (store.versionsForbidden()) {
          <p class="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            You can't see template versions, so the pinned version can't be changed from here.
          </p>
        } @else {
          <div>
            <label class="block text-sm font-semibold text-gray-700" for="pin-version"
              >Version</label
            >
            <div class="mt-1">
              <app-form-select-control
                [id]="'pin-version'"
                placeholder="Select a version"
                [options]="versionOptions(pinVersions())"
                [value]="pinVersionId()"
                (valueChange)="pinVersionId.set($event)"
              />
            </div>
          </div>
        }
        @if (store.actionError()) {
          <p role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {{ store.actionError() }}
          </p>
        }
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="closePin()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white disabled:opacity-50"
            [disabled]="
              !pinVersionId() ||
              pinVersionId() === pinTarget()?.formTemplateVersionId ||
              store.busyId() != null
            "
            (click)="pin()"
          >
            {{ store.busyId() ? 'Saving…' : 'Pin version' }}
          </button>
        </div>
      </div>
    </app-modal>

    <!-- Enlace completo: solo en memoria mientras el modal está abierto -->
    <app-modal
      [isOpen]="store.revealed() != null"
      heading="Intake link"
      subheading="Anyone with this link can start the form. Share it where prospects can find it."
      size="md"
      (closed)="store.clearRevealed()"
    >
      <div class="space-y-4 p-6">
        <div class="flex flex-wrap items-center gap-2">
          <label class="sr-only" for="intake-link-url">Intake link</label>
          <input
            id="intake-link-url"
            readonly
            class="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-50 px-3 font-mono text-xs text-gray-800"
            data-testid="intake-link-url"
            [value]="store.revealed()?.url ?? ''"
            (focus)="selectAll($event)"
          />
          <button
            type="button"
            class="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-bold px-4 text-sm font-bold text-white hover:bg-brand-ink"
            (click)="copyRevealed()"
          >
            <ion-icon name="copy-outline"></ion-icon>Copy
          </button>
        </div>
        <div class="flex justify-end">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="store.clearRevealed()"
          >
            Done
          </button>
        </div>
      </div>
    </app-modal>

    <app-confirm-dialog
      [isOpen]="confirmTarget() != null"
      [heading]="confirmKind() === 'revoke' ? 'Revoke intake link?' : 'Regenerate intake link?'"
      [message]="
        confirmKind() === 'revoke'
          ? 'The link stops working for good and cannot be turned back on. Requests already started are not affected.'
          : 'A new link is created and the current one stops working right away. Update it anywhere you shared it.'
      "
      [confirmLabel]="confirmKind() === 'revoke' ? 'Revoke' : 'Regenerate'"
      [tone]="confirmKind() === 'revoke' ? 'danger' : 'primary'"
      [busy]="store.busyId() != null"
      (cancelled)="closeConfirm()"
      (confirmed)="confirm()"
    >
      @if (store.actionError()) {
        <p role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ store.actionError() }}
        </p>
      }
    </app-confirm-dialog>
  `,
})
export class FormIntakeLinksComponent implements OnInit, OnDestroy {
  readonly store = inject(FormIntakeLinksStore);
  private readonly availability = inject(ClientFormsAvailabilityStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly toast = inject(ToastService);

  readonly enabled = this.availability.intakeLinksEnabled;
  readonly minExpiration = earliestDueDate();

  readonly createOpen = signal(false);
  readonly name = signal('');
  readonly templateId = signal('');
  readonly versionId = signal('');
  readonly responsibleId = signal('');
  readonly noticeKey = signal('');
  readonly maxSubmissions = signal('');
  readonly expiresOn = signal('');
  readonly createVersions = signal<FormTemplateVersionSummary[]>([]);

  readonly pinTarget = signal<FormIntakeLink | null>(null);
  readonly pinVersionId = signal('');
  readonly pinVersions = signal<FormTemplateVersionSummary[]>([]);

  readonly confirmTarget = signal<FormIntakeLink | null>(null);
  readonly confirmKind = signal<ConfirmKind>('revoke');

  readonly anyModalOpen = computed(
    () => this.createOpen() || this.pinTarget() != null || this.confirmTarget() != null,
  );
  readonly templateOptions = computed<FormControlOption[]>(() =>
    this.store.templates().map((item) => ({
      value: item.templateId,
      label: `${item.name} · v${item.latestVersionNumber}`,
    })),
  );
  readonly staffOptions = computed<FormControlOption[]>(() =>
    this.store.staff().map((item) => ({ value: item.userId, label: `${item.name} · ${item.email}` })),
  );
  readonly noticeOptions = computed<FormControlOption[]>(() =>
    this.store.entryNotices().map((item) => ({
      value: item.key,
      label: `${item.title} · v${item.versionNumber}`,
    })),
  );
  readonly maxSubmissionsInvalid = computed(() => {
    const raw = this.maxSubmissions().trim();
    if (!raw) return false;
    const parsed = Number(raw);
    return !Number.isInteger(parsed) || parsed < 1;
  });
  readonly createReady = computed(
    () =>
      this.enabled() &&
      !!this.name().trim() &&
      !!this.templateId() &&
      !!this.responsibleId() &&
      this.noticeOptions().some((option) => option.value === this.noticeKey()) &&
      !this.maxSubmissionsInvalid(),
  );

  ngOnInit(): void {
    void this.store.load();
  }

  ngOnDestroy(): void {
    // El enlace completo no sobrevive a la pestaña.
    this.store.clearRevealed();
  }

  reload(): void {
    void this.store.load();
  }

  versionLabel(link: FormIntakeLink): string {
    const number = this.store.versionNumber(link);
    return number ? `Version ${number}` : 'Pinned version';
  }

  versionOptions(versions: readonly FormTemplateVersionSummary[]): FormControlOption[] {
    return versions.map((item) => ({
      value: item.id,
      label: `Version ${item.versionNumber} · ${item.title}`,
    }));
  }

  statusTone(status: FormIntakeLinkStatus): StatusTone {
    if (status === 'Active') return 'success';
    if (status === 'Paused') return 'warning';
    return 'muted';
  }

  expiration(value: string): string {
    return formatDueDate(value);
  }

  isExpired(link: FormIntakeLink): boolean {
    const expires = parseUtcDateOrNull(link.expiresAtUtc);
    return link.status !== 'Revoked' && !!expires && expires.getTime() <= Date.now();
  }

  limitReached(link: FormIntakeLink): boolean {
    return link.maxSubmissions != null && link.submissionCount >= link.maxSubmissions;
  }

  openCreate(): void {
    if (!this.enabled()) return;
    this.store.dismissActionError();
    this.name.set('');
    this.templateId.set('');
    this.versionId.set('');
    this.responsibleId.set('');
    const notices = this.store.entryNotices();
    this.noticeKey.set(notices.length === 1 ? notices[0].key : '');
    this.maxSubmissions.set('');
    this.expiresOn.set('');
    this.createVersions.set([]);
    this.createOpen.set(true);
  }

  closeCreate(): void {
    if (this.store.busyId() === 'new') return;
    this.store.dismissActionError();
    this.createOpen.set(false);
  }

  async selectTemplate(templateId: string): Promise<void> {
    this.templateId.set(templateId);
    this.versionId.set('');
    this.createVersions.set(templateId ? await this.store.loadVersions(templateId) : []);
  }

  async create(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.createReady()) return;
    const max = this.maxSubmissions().trim();
    const created = await this.store.create({
      name: this.name().trim(),
      formTemplateId: this.templateId(),
      formTemplateVersionId: this.versionId() || null,
      entryNoticeKey: this.noticeKey(),
      expiresAtUtc: expirationToUtc(this.expiresOn()),
      maxSubmissions: max ? Number(max) : null,
      responsibleUserId: this.responsibleId(),
    });
    if (!created) return;
    this.createOpen.set(false);
    this.toast.success('Intake link created');
  }

  async change(link: FormIntakeLink, action: 'pause' | 'resume'): Promise<void> {
    if (await this.store.change(link, action))
      this.toast.success(action === 'pause' ? 'Intake link paused' : 'Intake link resumed');
  }

  async copyLink(link: FormIntakeLink): Promise<void> {
    await this.store.reveal(link);
  }

  async copyRevealed(): Promise<void> {
    const url = this.store.revealed()?.url;
    if (!url) return;
    if (await this.clipboard.copy(url)) this.toast.success('Link copied');
    else this.toast.error("The link couldn't be copied. Select it and copy it manually.");
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  async openPin(link: FormIntakeLink): Promise<void> {
    this.store.dismissActionError();
    this.pinTarget.set(link);
    this.pinVersionId.set(link.formTemplateVersionId);
    this.pinVersions.set(await this.store.loadVersions(link.formTemplateId));
  }

  closePin(): void {
    if (this.store.busyId()) return;
    this.store.dismissActionError();
    this.pinTarget.set(null);
  }

  async pin(): Promise<void> {
    const target = this.pinTarget();
    if (!target || !this.pinVersionId()) return;
    const link = this.store.links().find((item) => item.id === target.id) ?? target;
    if (!(await this.store.pinVersion(link, this.pinVersionId()))) return;
    this.pinTarget.set(null);
    this.toast.success('Pinned version updated');
  }

  askConfirm(link: FormIntakeLink, kind: ConfirmKind): void {
    this.store.dismissActionError();
    this.confirmKind.set(kind);
    this.confirmTarget.set(link);
  }

  closeConfirm(): void {
    if (this.store.busyId()) return;
    this.store.dismissActionError();
    this.confirmTarget.set(null);
  }

  async confirm(): Promise<void> {
    const target = this.confirmTarget();
    if (!target) return;
    // Siempre con el rowVersion vigente de la lista.
    const link = this.store.links().find((item) => item.id === target.id) ?? target;
    const kind = this.confirmKind();
    const ok = await this.store.change(link, kind === 'revoke' ? 'revoke' : 'regenerate-token');
    if (!ok) return;
    this.confirmTarget.set(null);
    this.toast.success(kind === 'revoke' ? 'Intake link revoked' : 'New link generated');
  }
}
