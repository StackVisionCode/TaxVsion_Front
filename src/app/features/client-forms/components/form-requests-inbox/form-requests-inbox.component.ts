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
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import {
  FilterChipsComponent,
  type FilterChipOption,
} from '@shared/ui/filter-chips/filter-chips.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent, type SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type {
  AssignExternalFormRequestInput,
  AssignableFormTemplate,
  ActiveConsentNotice,
  FormRequestInboxView,
  FormRequestListItem,
  FormRequestStatus,
} from '../../data-access/client-forms.model';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormRequestsStore } from '../../data-access/form-requests.store';
import { FormActionChipComponent } from '../../ui/form-action-chip/form-action-chip.component';
import { SendExternalFormDialogComponent } from '../../ui/send-external-form-dialog/send-external-form-dialog.component';
import { externalErrorMessage, isEntryNotice } from '../../utils/external-forms';
import { FormRequestReviewDrawerComponent } from '../form-request-review-drawer/form-request-review-drawer.component';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-form-requests-inbox',
  imports: [
    FilterChipsComponent,
    FormActionChipComponent,
    FormRequestReviewDrawerComponent,
    PaginationComponent,
    SearchInputComponent,
    SegmentedComponent,
    SendExternalFormDialogComponent,
    StateBlockComponent,
    StatusPillComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="requests-heading">
      <div class="flex flex-wrap items-end justify-between gap-3 py-5">
        <div>
          <h2 id="requests-heading" class="text-xl font-bold text-gray-900">Submission inbox</h2>
          <p class="mt-1 text-sm text-gray-500">
            Review client and external submissions without losing async action status.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm font-semibold text-gray-600">{{ store.total() }} requests</span>
          @if (canSendExternal()) {
            <button
              type="button"
              class="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-bold px-4 text-sm font-bold text-white hover:bg-brand-ink"
              (click)="openSendExternal()"
            >
              <ion-icon name="paper-plane-outline"></ion-icon>Send to external email
            </button>
          }
        </div>
      </div>

      <div class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div class="space-y-4 border-b border-gray-200 p-4">
          <app-segmented
            [options]="views"
            [value]="activeView()"
            (valueChange)="changeView($event)"
          />
          <div class="flex flex-wrap items-center gap-3">
            <app-search-input
              class="min-w-64 flex-1"
              widthClass="w-full"
              placeholder="Search participant or form"
              [debounceMs]="300"
              [value]="search()"
              (valueChange)="changeSearch($event)"
            />
            <select
              class="min-h-10 rounded-full border border-gray-300 bg-white px-3 text-sm"
              aria-label="Template"
              (change)="changeTemplate($event)"
            >
              <option value="" [selected]="!templateFilter()">All templates</option>
              @for (template of templates(); track template.templateId) {
                <option
                  [value]="template.templateId"
                  [selected]="template.templateId === templateFilter()"
                >
                  {{ template.name }}
                </option>
              }
            </select>
            <label
              class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700"
            >
              <input type="checkbox" [checked]="overdue()" (change)="changeOverdue($event)" />
              Overdue only
            </label>
          </div>
          <app-filter-chips
            [options]="statusOptions()"
            [value]="activeStatus()"
            [collapseAfter]="null"
            size="sm"
            (valueChange)="changeStatus($event)"
          />
        </div>

        <app-state-block
          [loading]="store.loading()"
          [error]="store.error()"
          [empty]="!store.loading() && !store.error() && store.items().length === 0"
          emptyTitle="No submissions match this view"
          emptyMessage="Try another view or remove a filter."
          icon="file-tray-outline"
          variant="inline"
          minHeight="18rem"
          (retry)="reload()"
        >
          <div class="overflow-x-auto">
            <table class="w-full min-w-[58rem] text-left">
              <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th class="px-5 py-3 font-semibold">Participant</th>
                  <th class="px-5 py-3 font-semibold">Form</th>
                  <th class="px-5 py-3 font-semibold">Received</th>
                  <th class="px-5 py-3 font-semibold">Status</th>
                  <th class="px-5 py-3 font-semibold">Actions</th>
                  <th class="w-12 px-3 py-3"><span class="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (item of store.items(); track item.id) {
                  <tr class="cursor-pointer hover:bg-gray-50" (click)="open(item)">
                    <td class="px-5 py-4">
                      <p class="font-semibold text-gray-900">{{ item.displayName }}</p>
                      <p class="mt-0.5 text-xs text-gray-500">
                        {{ item.maskedEmail || participantLabel(item) }}
                      </p>
                    </td>
                    <td class="px-5 py-4">
                      <p class="font-semibold text-gray-900">{{ item.templateName }}</p>
                      <p class="mt-0.5 text-xs text-gray-500">
                        {{ item.title }} · v{{ item.versionNumber }}
                      </p>
                    </td>
                    <td class="px-5 py-4 text-sm text-gray-600">
                      {{
                        dateTime(
                          item.receivedAtUtc || item.lastSubmittedAtUtc || item.requestedAtUtc
                        )
                      }}
                    </td>
                    <td class="px-5 py-4">
                      <app-status-pill [tone]="statusTone(item.status)" [soft]="true" size="xs">{{
                        statusLabel(item.status)
                      }}</app-status-pill>
                      @if (item.isOverdue) {
                        <span class="ml-2 text-xs font-bold text-red-700">Overdue</span>
                      }
                    </td>
                    <td class="px-5 py-4" (click)="$event.stopPropagation()">
                      <div class="flex max-w-sm flex-wrap gap-2">
                        @for (run of item.actionRuns; track run.id) {
                          <app-form-action-chip [run]="run" (retried)="retry(item, $event)" />
                        } @empty {
                          <span class="text-xs text-gray-400">No actions</span>
                        }
                      </div>
                    </td>
                    <td class="px-3 py-4 text-right">
                      <ion-icon name="chevron-forward-outline" class="text-gray-400"></ion-icon>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="border-t border-gray-100 px-5 py-3">
            <app-pagination
              [currentPage]="store.filters().page || 1"
              [pageSize]="store.filters().pageSize || 25"
              [totalItems]="store.total()"
              (pageChange)="changePage($event)"
            />
          </div>
        </app-state-block>
      </div>
    </section>

    <app-form-request-review-drawer (closed)="clearRequestParam()" />

    <app-send-external-form-dialog
      [isOpen]="sendExternalOpen()"
      [templates]="templates()"
      [notices]="entryNotices()"
      [noticesLoading]="noticesLoading()"
      [noticesError]="noticesError()"
      [busy]="sendingExternal()"
      [error]="sendExternalError()"
      [canAssignToClient]="canAssignToClient()"
      (closed)="closeSendExternal()"
      (sent)="sendExternal($event)"
      (assignToClient)="assignToClient($event)"
    />
  `,
})
export class FormRequestsInboxComponent implements OnInit {
  readonly store = inject(FormRequestsStore);
  private readonly service = inject(FormRequestsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly access = inject(AccessStore);
  private readonly availability = inject(ClientFormsAvailabilityStore);
  private readonly toast = inject(ToastService);

  readonly views: readonly SegmentedOption<FormRequestInboxView>[] = [
    { id: 'NeedsAction', label: 'Needs action' },
    { id: 'All', label: 'All' },
    { id: 'Clients', label: 'Clients' },
    { id: 'External', label: 'External' },
  ];
  readonly activeView = signal<FormRequestInboxView>('NeedsAction');
  readonly activeStatus = signal<FormRequestStatus | 'All'>('All');
  readonly search = signal('');
  readonly overdue = signal(false);
  readonly templates = signal<AssignableFormTemplate[]>([]);
  readonly sendExternalOpen = signal(false);
  readonly sendingExternal = signal(false);
  readonly sendExternalError = signal<string | null>(null);
  readonly notices = signal<ActiveConsentNotice[]>([]);
  readonly noticesLoading = signal(false);
  readonly noticesError = signal<string | null>(null);
  readonly entryNotices = computed(() => this.notices().filter(isEntryNotice));
  // Permiso + sub-flag de la oficina (X-3); el backend vuelve a decidir al enviar.
  readonly canSendExternal = computed(
    () =>
      this.access.can('tasks.form_requests.send_external') &&
      this.availability.externalParticipantsEnabled(),
  );
  readonly canAssignToClient = computed(() => this.access.can('tasks.form_requests.manage'));
  readonly templateFilter = signal('');
  private initialized = false;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (!this.initialized) return;
      const id = this.requestId(params);
      if (id && id !== this.store.detail()?.request.id) void this.store.open(id);
    });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.store.load(), this.store.loadStatusCounts(), this.loadTemplates()]);
    this.initialized = true;
    const id = this.requestId(this.route.snapshot.queryParamMap);
    if (id) await this.store.open(id);
  }

  statusOptions(): FilterChipOption<FormRequestStatus | 'All'>[] {
    const counts = this.store.statusCounts();
    return [
      { id: 'All', label: 'All' },
      { id: 'Submitted', label: 'Needs review', count: counts.Submitted },
      { id: 'Pending', label: 'Pending', count: counts.Pending },
      { id: 'Returned', label: 'Returned', count: counts.Returned },
      { id: 'Completed', label: 'Completed', count: counts.Completed },
      { id: 'Cancelled', label: 'Cancelled', count: counts.Cancelled },
    ];
  }

  reload(): void {
    void this.store.load();
  }

  changeView(view: FormRequestInboxView): void {
    this.activeView.set(view);
    void this.store.setView(view);
  }

  changeStatus(status: FormRequestStatus | 'All'): void {
    this.activeStatus.set(status);
    void this.store.setStatuses(status === 'All' ? undefined : [status]);
  }

  changeSearch(search: string): void {
    this.search.set(search);
    void this.store.load({ search: search.trim() || undefined, page: 1 });
  }

  changeTemplate(event: Event): void {
    this.templateFilter.set(this.value(event));
    void this.store.load({ templateId: this.value(event) || undefined, page: 1 });
  }

  changeOverdue(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.overdue.set(checked);
    void this.store.load({ overdue: checked || undefined, page: 1 });
  }

  changePage(page: number): void {
    void this.store.load({ page });
  }

  open(item: FormRequestListItem): void {
    if (item.participant.customerId) {
      void this.router.navigate(['/clients', item.participant.customerId], {
        queryParams: { tab: 'work', formRequestId: item.id },
      });
      return;
    }
    void this.store.open(item.id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { requestId: item.id },
      queryParamsHandling: 'merge',
    });
  }

  async openSendExternal(): Promise<void> {
    this.sendExternalError.set(null);
    this.sendExternalOpen.set(true);
    if (this.notices().length) return;
    this.noticesLoading.set(true);
    this.noticesError.set(null);
    try {
      this.notices.set(await firstValueFrom(this.service.entryNotices()));
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

  closeSendExternal(): void {
    if (this.sendingExternal()) return;
    this.sendExternalOpen.set(false);
    this.sendExternalError.set(null);
  }

  async sendExternal(input: AssignExternalFormRequestInput): Promise<void> {
    if (this.sendingExternal()) return;
    this.sendingExternal.set(true);
    this.sendExternalError.set(null);
    try {
      await firstValueFrom(this.service.assignExternal(input));
      this.sendExternalOpen.set(false);
      this.toast.success(`Form sent to ${input.email}`);
      // La request nueva queda en External; sin filtros para que se vea seguro.
      this.activeView.set('External');
      this.activeStatus.set('All');
      this.search.set('');
      this.overdue.set(false);
      this.templateFilter.set('');
      await Promise.all([
        this.store.load({
          view: 'External',
          page: 1,
          statuses: undefined,
          templateId: undefined,
          search: undefined,
          overdue: undefined,
        }),
        this.store.loadStatusCounts(),
      ]);
    } catch (error) {
      this.sendExternalError.set(externalErrorMessage(error));
    } finally {
      this.sendingExternal.set(false);
    }
  }

  /** Abre el perfil del cliente con el diálogo de asignar (contrato por query params del perfil). */
  assignToClient(target: { customerId: string; templateId: string | null }): void {
    this.sendExternalOpen.set(false);
    void this.router.navigate(['/clients', target.customerId], {
      queryParams: { tab: 'work', assignForm: '1', assignTemplateId: target.templateId },
    });
  }

  async retry(item: FormRequestListItem, runId: string): Promise<void> {
    await this.store.open(item.id);
    await this.store.retryAction(runId);
  }

  clearRequestParam(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { requestId: null, formRequestId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  participantLabel(item: FormRequestListItem): string {
    return item.participant.kind === 'External' ? 'External participant' : 'Client';
  }

  statusLabel(status: FormRequestStatus): string {
    return status === 'Submitted' ? 'Needs review' : status;
  }

  statusTone(status: FormRequestStatus): StatusTone {
    if (status === 'Completed') return 'success';
    if (status === 'Submitted') return 'warning';
    if (status === 'Returned') return 'info';
    if (status === 'Cancelled') return 'muted';
    return 'neutral';
  }

  dateTime(value: string): string {
    const date = parseUtcDate(value);
    return date
      ? date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : value;
  }

  value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  private async loadTemplates(): Promise<void> {
    try {
      this.templates.set(await firstValueFrom(this.service.assignableTemplates()));
    } catch {
      this.templates.set([]);
    }
  }

  private requestId(params: { get(name: string): string | null }): string | null {
    return params.get('requestId') ?? params.get('formRequestId');
  }
}
