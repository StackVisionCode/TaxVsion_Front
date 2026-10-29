import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import {
  DropdownMenuComponent,
  MenuItemDirective,
} from '@shared/ui/dropdown-menu/dropdown-menu.component';
import {
  FilterChipsComponent,
  type FilterChipOption,
} from '@shared/ui/filter-chips/filter-chips.component';
import { LaunchOverlayComponent } from '@shared/ui/launch-overlay/launch-overlay.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { formatRelativeTime } from '@shared/utils/format.util';
import { runWithLaunch, type LaunchPhase } from '@shared/utils/launch.util';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { firstValueFrom } from 'rxjs';
import type {
  ActiveConsentNotice,
  AssignExternalFormRequestInput,
  AssignableFormTemplate,
  FormProspect,
  FormProspectSource,
  FormProspectStatus,
  FormRequestStatus,
} from '../../data-access/client-forms.model';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormProspectsStore } from '../../data-access/form-prospects.store';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import {
  SendExternalFormDialogComponent,
  type SendExternalFormPrefill,
} from '../../ui/send-external-form-dialog/send-external-form-dialog.component';
import {
  customerEmailConflict,
  externalErrorMessage,
  isEntryNotice,
  resendErrorMessage,
  type CustomerEmailConflict,
} from '../../utils/external-forms';
import { FormRequestReviewDrawerComponent } from '../form-request-review-drawer/form-request-review-drawer.component';

export type ProspectAction =
  | 'openRequest'
  | 'createClient'
  | 'sendForm'
  | 'resendLink'
  | 'markLost'
  | 'reopen'
  | 'openClient'
  | 'viewClient';

interface ProspectMenuItem {
  id: ProspectAction;
  label: string;
  icon: string;
  danger?: boolean;
}

type StatusFilter = FormProspectStatus | 'All';

const MENU: Record<ProspectAction, ProspectMenuItem> = {
  openRequest: { id: 'openRequest', label: 'Open request', icon: 'document-text-outline' },
  createClient: { id: 'createClient', label: 'Create client', icon: 'person-add-outline' },
  sendForm: { id: 'sendForm', label: 'Send another form', icon: 'paper-plane-outline' },
  resendLink: { id: 'resendLink', label: 'Resend link', icon: 'refresh-outline' },
  markLost: { id: 'markLost', label: 'Mark as lost', icon: 'close-circle-outline', danger: true },
  reopen: { id: 'reopen', label: 'Reopen', icon: 'arrow-undo-outline' },
  openClient: { id: 'openClient', label: 'Open client', icon: 'person-circle-outline' },
  viewClient: { id: 'viewClient', label: 'View existing client', icon: 'people-outline' },
};

// Estados cerrados: el email ya es de un cliente.
const CLIENT_STATUSES: readonly FormProspectStatus[] = ['Converted', 'Duplicate'];
const RESENDABLE: readonly FormRequestStatus[] = ['Pending', 'Returned'];

/** Pestaña Prospects: participantes externos ("leads-lite") con sus acciones de fila. */
@Component({
  selector: 'app-form-prospects',
  imports: [
    ConfirmDialogComponent,
    DropdownMenuComponent,
    FilterChipsComponent,
    FormRequestReviewDrawerComponent,
    LaunchOverlayComponent,
    MenuItemDirective,
    PaginationComponent,
    SearchInputComponent,
    SendExternalFormDialogComponent,
    SkeletonComponent,
    StateBlockComponent,
    StatusPillComponent,
    TooltipDirective,
  ],
  providers: [FormProspectsStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="prospects-heading">
      <div class="flex flex-wrap items-end justify-between gap-3 py-5">
        <div>
          <h2 id="prospects-heading" class="text-xl font-bold text-gray-900">Prospects</h2>
          <p class="mt-1 text-sm text-gray-500">
            People who received or filled out a form but aren't clients yet.
          </p>
        </div>
        <span class="text-sm font-semibold text-gray-600">{{ store.total() }} prospects</span>
      </div>

      <div class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div class="space-y-4 border-b border-gray-200 p-4">
          <app-search-input
            class="block"
            widthClass="w-full"
            placeholder="Search name or email"
            ariaLabel="Search prospects"
            [debounceMs]="300"
            [value]="search()"
            (valueChange)="changeSearch($event)"
          />
          <app-filter-chips
            ariaLabel="Prospect status"
            [options]="statusOptions"
            [value]="activeStatus()"
            [collapseAfter]="null"
            size="sm"
            (valueChange)="changeStatus($event)"
          />
        </div>

        @if (store.actionError() && !lostTarget()) {
          <div
            class="flex items-start justify-between gap-3 border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-800"
            role="alert"
            data-testid="prospect-action-error"
          >
            <p>{{ store.actionError() }}</p>
            <button
              type="button"
              class="shrink-0 text-red-700 hover:text-red-900"
              aria-label="Dismiss"
              appTooltip="Dismiss"
              (click)="store.dismissActionError()"
            >
              <ion-icon name="close-outline" class="text-base"></ion-icon>
            </button>
          </div>
        }

        @if (!store.loaded() && store.loading()) {
          <div class="p-4"><app-skeleton variant="rows" [rows]="6" minHeight="18rem" /></div>
        } @else {
          <app-state-block
            [error]="store.error()"
            [empty]="!store.error() && store.items().length === 0"
            [emptyTitle]="hasFilters() ? 'No prospects match' : 'No prospects yet'"
            [emptyMessage]="
              hasFilters()
                ? 'Try another search or status.'
                : 'People you send forms to by email, or who use an intake link, show up here.'
            "
            icon="people-outline"
            variant="inline"
            minHeight="18rem"
            (retry)="reload()"
          >
            <div class="overflow-x-auto transition-opacity" [class.opacity-60]="store.loading()">
              <table class="w-full min-w-[60rem] text-left">
                <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th class="px-5 py-3 font-semibold">Prospect</th>
                    <th class="w-44 px-5 py-3 font-semibold">Status</th>
                    <th class="px-5 py-3 font-semibold">Source</th>
                    <th class="px-5 py-3 font-semibold">Latest request</th>
                    <th class="whitespace-nowrap px-5 py-3 font-semibold">Last activity</th>
                    <th class="w-24 px-3 py-3"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  @for (item of store.items(); track item.participantId) {
                    <tr
                      class="hover:bg-gray-50"
                      [class.cursor-pointer]="item.latestRequest != null"
                      [attr.data-prospect]="item.participantId"
                      (click)="openRequest(item)"
                    >
                      <td class="px-5 py-4">
                        <p class="font-semibold text-gray-900">{{ item.fullName || item.email }}</p>
                        @if (item.fullName) {
                          <p class="mt-0.5 text-xs text-gray-500">{{ item.email }}</p>
                        }
                      </td>
                      <td class="px-5 py-4">
                        <app-status-pill [tone]="statusTone(item.status)" [soft]="true" size="xs">{{
                          item.status
                        }}</app-status-pill>
                        @if (item.status === 'Lost' && item.lostReason) {
                          <p class="mt-1 max-w-36 truncate text-xs text-gray-500" [appTooltip]="item.lostReason">
                            {{ item.lostReason }}
                          </p>
                        }
                      </td>
                      <td class="px-5 py-4">
                        <span
                          class="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700"
                        >
                          <ion-icon [name]="sourceIcon(item.source)" class="text-sm"></ion-icon>
                          {{ sourceLabel(item.source) }}
                        </span>
                      </td>
                      <td class="px-5 py-4">
                        @if (item.latestRequest; as latest) {
                          <p class="font-semibold text-gray-900">{{ latest.title }}</p>
                          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <app-status-pill [tone]="requestTone(latest.status)" [soft]="true" size="xs">{{
                              requestLabel(latest.status)
                            }}</app-status-pill>
                            <span>{{ latest.templateName }}</span>
                            @if (item.requestCount > 1) {
                              <span>· {{ item.requestCount }} requests</span>
                            }
                          </div>
                        } @else {
                          <span class="text-xs text-gray-400">No requests</span>
                        }
                      </td>
                      <td class="px-5 py-4 text-sm text-gray-600">
                        <span [appTooltip]="absolute(item.lastActivityAtUtc)">{{
                          relative(item.lastActivityAtUtc)
                        }}</span>
                      </td>
                      <td class="px-3 py-4" (click)="$event.stopPropagation()">
                        <div class="flex items-center justify-end gap-1">
                          @if (item.latestRequest) {
                            <button
                              type="button"
                              class="grid h-8 w-8 place-items-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                              aria-label="Open request"
                              appTooltip="Open request"
                              (click)="openRequest(item)"
                            >
                              <ion-icon name="document-text-outline" class="text-base"></ion-icon>
                            </button>
                          }
                          @if (menuFor(item); as menu) {
                            @if (menu.length) {
                              <app-dropdown-menu
                                panelClass="w-56"
                                [ariaLabel]="'Actions for ' + (item.fullName || item.email)"
                                [disabled]="store.busyId() === item.participantId"
                              >
                                <button
                                  menuTrigger
                                  type="button"
                                  class="grid h-8 w-8 place-items-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
                                  [attr.aria-label]="'Actions for ' + (item.fullName || item.email)"
                                  aria-haspopup="menu"
                                  appTooltip="More actions"
                                  [disabled]="store.busyId() === item.participantId"
                                >
                                  <ion-icon name="ellipsis-horizontal-outline" class="text-base"></ion-icon>
                                </button>
                                @for (action of menu; track action.id) {
                                  <button
                                    appMenuItem
                                    type="button"
                                    [danger]="!!action.danger"
                                    [attr.data-action]="action.id"
                                    (click)="run(action.id, item)"
                                  >
                                    <ion-icon [name]="action.icon" class="text-base"></ion-icon>
                                    {{ action.label }}
                                  </button>
                                }
                              </app-dropdown-menu>
                            }
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="border-t border-gray-100 px-5 py-3">
              <app-pagination
                [currentPage]="store.filters().page"
                [pageSize]="store.filters().size"
                [totalItems]="store.total()"
                (pageChange)="store.goToPage($event)"
              />
            </div>
          </app-state-block>
        }
      </div>
    </section>

    <app-form-request-review-drawer (closed)="reload()" />

    <app-confirm-dialog
      [isOpen]="lostTarget() != null"
      heading="Mark as lost?"
      [message]="lostMessage()"
      confirmLabel="Mark as lost"
      icon="close-circle-outline"
      [busy]="store.busyId() != null"
      busyLabel="Saving…"
      (cancelled)="closeLost()"
      (confirmed)="confirmLost()"
    >
      <label class="block text-left text-sm font-semibold text-gray-700" for="prospect-lost-reason"
        >Reason <span class="font-normal text-gray-400">Optional</span></label
      >
      <textarea
        id="prospect-lost-reason"
        class="mt-1 w-full rounded-2xl border border-gray-300 p-3 text-sm"
        rows="3"
        maxlength="500"
        [value]="lostReason()"
        (input)="lostReason.set($any($event.target).value)"
      ></textarea>
      @if (store.actionError()) {
        <p role="alert" class="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ store.actionError() }}
        </p>
      }
    </app-confirm-dialog>

    <app-confirm-dialog
      [isOpen]="resendTarget() != null"
      heading="Resend access link?"
      [message]="resendMessage()"
      confirmLabel="Resend link"
      tone="primary"
      icon="paper-plane-outline"
      [busy]="resending()"
      busyLabel="Sending…"
      (cancelled)="closeResend()"
      (confirmed)="confirmResend()"
    >
      @if (resendError()) {
        <p role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {{ resendError() }}
        </p>
      }
    </app-confirm-dialog>

    <app-send-external-form-dialog
      [isOpen]="sendOpen()"
      [prefill]="sendPrefill()"
      [templates]="templates()"
      [notices]="entryNotices()"
      [noticesLoading]="noticesLoading()"
      [noticesError]="noticesError()"
      [busy]="sending()"
      [error]="sendError()"
      [conflict]="sendConflict()"
      [canAssignToClient]="canManage()"
      (closed)="closeSend()"
      (sent)="send($event)"
      (assignToClient)="assignToClient($event)"
    />

    <app-launch-overlay
      [variant]="launchVariant()"
      [phase]="launch()"
      [workingCaption]="launchCaption()"
      [doneCaption]="launchDone()"
    />
  `,
})
export class FormProspectsComponent implements OnInit {
  readonly store = inject(FormProspectsStore);
  private readonly requestsStore = inject(FormRequestsStore);
  private readonly requests = inject(FormRequestsService);
  private readonly access = inject(AccessStore);
  private readonly availability = inject(ClientFormsAvailabilityStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly statusOptions: readonly FilterChipOption<StatusFilter>[] = [
    { id: 'All', label: 'All' },
    { id: 'Invited', label: 'Invited' },
    { id: 'Verified', label: 'Verified' },
    { id: 'Submitted', label: 'Submitted' },
    { id: 'Converted', label: 'Converted' },
    { id: 'Duplicate', label: 'Duplicate' },
    { id: 'Lost', label: 'Lost' },
  ];
  readonly activeStatus = signal<StatusFilter>('All');
  readonly search = signal('');

  // Permiso + sub-flag de la oficina (X-3), igual que la bandeja; el backend vuelve a decidir.
  readonly canSendExternal = computed(
    () =>
      this.access.can('tasks.form_requests.send_external') &&
      this.availability.externalParticipantsEnabled(),
  );
  // Lost/Reopen usan el mismo permiso que las acciones externas en el backend.
  readonly canManage = computed(() => this.access.can('tasks.form_requests.send_external'));

  readonly lostTarget = signal<FormProspect | null>(null);
  readonly lostReason = signal('');
  readonly resendTarget = signal<FormProspect | null>(null);
  readonly resending = signal(false);
  readonly resendError = signal<string | null>(null);

  readonly sendOpen = signal(false);
  readonly sendPrefill = signal<SendExternalFormPrefill | null>(null);
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly sendConflict = signal<CustomerEmailConflict | null>(null);
  readonly templates = signal<AssignableFormTemplate[]>([]);
  private readonly notices = signal<ActiveConsentNotice[]>([]);
  readonly entryNotices = computed(() => this.notices().filter(isEntryNotice));
  readonly noticesLoading = signal(false);
  readonly noticesError = signal<string | null>(null);
  private templatesLoaded = false;

  readonly launch = signal<LaunchPhase>('idle');
  readonly launchVariant = signal<'send' | 'create'>('send');
  readonly launchCaption = signal('');
  readonly launchDone = signal('');

  ngOnInit(): Promise<void> {
    return this.store.load();
  }

  reload(): void {
    void this.store.load();
  }

  hasFilters(): boolean {
    return this.activeStatus() !== 'All' || this.search().trim() !== '';
  }

  changeStatus(status: StatusFilter): void {
    this.activeStatus.set(status);
    void this.store.setStatus(status === 'All' ? null : status);
  }

  changeSearch(search: string): void {
    this.search.set(search);
    void this.store.setSearch(search);
  }

  /** Acciones del menú según estado y permisos ("Open request" va además como botón de icono). */
  availableActions(item: FormProspect): ProspectAction[] {
    const actions: ProspectAction[] = [];
    const isClient = CLIENT_STATUSES.includes(item.status);
    const latest = item.latestRequest;
    if (latest) actions.push('openRequest');
    if (item.status === 'Converted' && item.customerId) actions.push('openClient');
    if (item.status === 'Duplicate' && item.duplicateOfCustomerId) actions.push('viewClient');
    if (item.canCreateClient && item.createClientRequestId && !isClient && item.status !== 'Lost')
      actions.push('createClient');
    if (this.canSendExternal() && !isClient && item.status !== 'Lost') {
      actions.push('sendForm');
      // Solo requests dirigidas (las de captación no tienen enlace personal) y editables.
      if (item.source === 'DirectedRequest' && latest && RESENDABLE.includes(latest.status))
        actions.push('resendLink');
    }
    if (this.canManage()) {
      if (item.status === 'Lost') actions.push('reopen');
      else if (!isClient) actions.push('markLost');
    }
    return actions;
  }

  menuFor(item: FormProspect): ProspectMenuItem[] {
    return this.availableActions(item).map((id) => MENU[id]);
  }

  run(action: ProspectAction, item: FormProspect): void {
    switch (action) {
      case 'openRequest':
        return this.openRequest(item);
      case 'createClient':
        void this.createClient(item);
        return;
      case 'sendForm':
        void this.openSend(item);
        return;
      case 'resendLink':
        return this.openResend(item);
      case 'markLost':
        return this.openLost(item);
      case 'reopen':
        void this.reopen(item);
        return;
      case 'openClient':
        void this.router.navigate(['/clients', item.customerId]);
        return;
      case 'viewClient':
        void this.router.navigate(['/clients', item.duplicateOfCustomerId]);
        return;
    }
  }

  // Mismo drawer de revisión que la bandeja, abierto en esta pestaña.
  openRequest(item: FormProspect): void {
    const id = item.latestRequest?.id;
    if (id) void this.requestsStore.open(id);
  }

  async createClient(item: FormProspect): Promise<void> {
    this.launchVariant.set('create');
    this.launchCaption.set(`Creating client for ${this.displayName(item)}…`);
    this.launchDone.set('Client creation requested');
    await runWithLaunch(this.launch, () => this.store.createClient(item));
  }

  openLost(item: FormProspect): void {
    this.store.dismissActionError();
    this.lostReason.set('');
    this.lostTarget.set(item);
  }

  closeLost(): void {
    if (this.store.busyId()) return;
    this.store.dismissActionError();
    this.lostTarget.set(null);
  }

  lostMessage(): string {
    const item = this.lostTarget();
    return item
      ? `${this.displayName(item)} moves to Lost. You can reopen the prospect later.`
      : '';
  }

  async confirmLost(): Promise<void> {
    const item = this.lostTarget();
    if (!item) return;
    if (await this.store.markLost(item.participantId, this.lostReason())) {
      this.lostTarget.set(null);
      this.toast.success('Prospect marked as lost');
    }
  }

  async reopen(item: FormProspect): Promise<void> {
    if (await this.store.reopen(item.participantId)) this.toast.success('Prospect reopened');
  }

  openResend(item: FormProspect): void {
    this.resendError.set(null);
    this.resendTarget.set(item);
  }

  closeResend(): void {
    if (this.resending()) return;
    this.resendTarget.set(null);
    this.resendError.set(null);
  }

  resendMessage(): string {
    const email = this.resendTarget()?.email;
    return `We'll email a new link${email ? ` to ${email}` : ''}. The previous link stops working right away. Each request allows up to 5 links.`;
  }

  async confirmResend(): Promise<void> {
    const id = this.resendTarget()?.latestRequest?.id;
    if (!id || this.resending()) return;
    this.resending.set(true);
    this.resendError.set(null);
    try {
      await firstValueFrom(this.requests.resendExternalAccess(id));
      this.resendTarget.set(null);
      this.toast.success('Access link resent');
      this.reload();
    } catch (error) {
      this.resendError.set(resendErrorMessage(error));
    } finally {
      this.resending.set(false);
    }
  }

  async openSend(item: FormProspect): Promise<void> {
    this.sendError.set(null);
    this.sendConflict.set(null);
    this.sendPrefill.set({ email: item.email, fullName: item.fullName });
    this.sendOpen.set(true);
    await Promise.all([this.loadTemplates(), this.loadNotices()]);
  }

  closeSend(): void {
    if (this.sending()) return;
    this.sendOpen.set(false);
    this.sendError.set(null);
    this.sendConflict.set(null);
  }

  async send(input: AssignExternalFormRequestInput): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    this.sendError.set(null);
    this.sendConflict.set(null);
    this.launchVariant.set('send');
    this.launchCaption.set(`Sending to ${input.email}…`);
    this.launchDone.set(`Sent to ${input.email}`);
    try {
      await runWithLaunch(
        this.launch,
        async () => {
          try {
            await firstValueFrom(this.requests.assignExternal(input));
            return true;
          } catch (error) {
            const conflict = customerEmailConflict(error);
            if (conflict) this.sendConflict.set(conflict);
            else this.sendError.set(externalErrorMessage(error));
            return false;
          }
        },
        {
          onDone: () => {
            this.sendOpen.set(false);
            this.reload();
          },
        },
      );
    } finally {
      this.sending.set(false);
    }
  }

  /** Mismo contrato por query params del perfil que usa la bandeja. */
  assignToClient(target: { customerId: string; templateId: string | null }): void {
    this.sendOpen.set(false);
    void this.router.navigate(['/clients', target.customerId], {
      queryParams: { tab: 'work', assignForm: '1', assignTemplateId: target.templateId },
    });
  }

  statusTone(status: FormProspectStatus): StatusTone {
    switch (status) {
      case 'Verified':
        return 'info';
      case 'Submitted':
        return 'warning';
      case 'Converted':
        return 'success';
      case 'Duplicate':
        return 'brand';
      case 'Lost':
        return 'muted';
      default:
        return 'neutral';
    }
  }

  requestLabel(status: FormRequestStatus): string {
    return status === 'Submitted' ? 'Needs review' : status;
  }

  requestTone(status: FormRequestStatus): StatusTone {
    if (status === 'Completed') return 'success';
    if (status === 'Submitted') return 'warning';
    if (status === 'Returned') return 'info';
    if (status === 'Cancelled') return 'muted';
    return 'neutral';
  }

  sourceLabel(source: FormProspectSource): string {
    return source === 'IntakeLink' ? 'Intake link' : 'Sent by email';
  }

  sourceIcon(source: FormProspectSource): string {
    return source === 'IntakeLink' ? 'link-outline' : 'mail-outline';
  }

  relative(value: string): string {
    return formatRelativeTime(value);
  }

  absolute(value: string): string {
    const date = parseUtcDateOrNull(value);
    return date
      ? date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';
  }

  private displayName(item: FormProspect): string {
    return item.fullName || item.email;
  }

  private async loadTemplates(): Promise<void> {
    if (this.templatesLoaded) return;
    try {
      this.templates.set(await firstValueFrom(this.requests.assignableTemplates()));
      this.templatesLoaded = true;
    } catch {
      this.templates.set([]);
    }
  }

  private async loadNotices(): Promise<void> {
    if (this.notices().length) return;
    this.noticesLoading.set(true);
    this.noticesError.set(null);
    try {
      this.notices.set(await firstValueFrom(this.requests.entryNotices()));
    } catch (error) {
      this.noticesError.set(
        error instanceof HttpErrorResponse && error.status === 403
          ? "You don't have access to the entry notices."
          : externalErrorMessage(error),
      );
    } finally {
      this.noticesLoading.set(false);
    }
  }
}
