import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { Observable, firstValueFrom, forkJoin } from 'rxjs';
import type {
  FormFieldComment,
  FormRequestFilters,
  FormRequestInboxView,
  FormRequestListItem,
  FormRequestRevision,
  FormRequestStatus,
  StaffFormRequestDetail,
} from './client-forms.model';
import { FormRequestsService } from './form-requests.service';

const POLL_INTERVAL_MS = 5_000;
const POLL_LIMIT = 24;

@Injectable()
export class FormRequestsStore implements OnDestroy {
  private readonly service = inject(FormRequestsService);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollAttempts = 0;

  private readonly _items = signal<FormRequestListItem[]>([]);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _filters = signal<FormRequestFilters>({
    view: 'NeedsAction',
    page: 1,
    pageSize: 25,
  });
  private readonly _detail = signal<StaffFormRequestDetail | null>(null);
  private readonly _selectedItem = signal<FormRequestListItem | null>(null);
  private readonly _detailLoading = signal(false);
  private readonly _actionBusy = signal(false);
  private readonly _actionError = signal<string | null>(null);
  private readonly _revision = signal<FormRequestRevision | null>(null);
  private readonly _previousRevision = signal<FormRequestRevision | null>(null);
  private readonly _processingTimedOut = signal(false);
  private readonly _statusCounts = signal<Record<FormRequestStatus, number>>({
    Pending: 0,
    Submitted: 0,
    Returned: 0,
    Completed: 0,
    Cancelled: 0,
  });

  readonly items = this._items.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly detail = this._detail.asReadonly();
  readonly selectedItem = this._selectedItem.asReadonly();
  readonly detailLoading = this._detailLoading.asReadonly();
  readonly actionBusy = this._actionBusy.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly revision = this._revision.asReadonly();
  readonly previousRevision = this._previousRevision.asReadonly();
  readonly processingTimedOut = this._processingTimedOut.asReadonly();
  readonly statusCounts = this._statusCounts.asReadonly();
  readonly hasRequestedActions = computed(
    () => this._detail()?.actionRuns.some((run) => run.status === 'Requested') ?? false,
  );

  async load(patch: Partial<FormRequestFilters> = {}): Promise<void> {
    const next = { ...this._filters(), ...patch };
    this._filters.set(next);
    this._loading.set(true);
    this._error.set(null);
    try {
      const page = await firstValueFrom(this.service.list(next));
      this._items.set(page.items ?? []);
      this._total.set(page.totalCount ?? 0);
    } catch (error) {
      this._error.set(toApiError(error).message);
    } finally {
      this._loading.set(false);
    }
  }

  setView(view: FormRequestInboxView): Promise<void> {
    return this.load({ view, page: 1 });
  }

  setStatuses(statuses: readonly FormRequestStatus[] | undefined): Promise<void> {
    return this.load({ statuses, page: 1 });
  }

  async loadStatusCounts(): Promise<void> {
    const statuses: FormRequestStatus[] = [
      'Pending',
      'Submitted',
      'Returned',
      'Completed',
      'Cancelled',
    ];
    try {
      const pages = await firstValueFrom(
        forkJoin(
          statuses.map((status) =>
            this.service.list({ view: 'All', statuses: [status], page: 1, pageSize: 1 }),
          ),
        ),
      );
      this._statusCounts.set(
        Object.fromEntries(
          statuses.map((status, index) => [status, pages[index].totalCount ?? 0]),
        ) as Record<FormRequestStatus, number>,
      );
    } catch {
      // Los contadores son auxiliares; la bandeja sigue operativa si fallan.
    }
  }

  async open(id: string): Promise<void> {
    this.stopPolling();
    this._detailLoading.set(true);
    this._actionError.set(null);
    this._processingTimedOut.set(false);
    const listed = this._items().find((item) => item.id === id);
    this._selectedItem.set(
      listed ?? (this._selectedItem()?.id === id ? this._selectedItem() : null),
    );
    try {
      const detail = await firstValueFrom(this.service.get(id));
      this._detail.set(detail);
      await this.loadRevision(detail.request.currentRevisionNumber);
      this.startPollingIfNeeded();
    } catch (error) {
      this._actionError.set(toApiError(error).message);
      this._detail.set(null);
    } finally {
      this._detailLoading.set(false);
    }
  }

  close(): void {
    this.stopPolling();
    this._detail.set(null);
    this._selectedItem.set(null);
    this._revision.set(null);
    this._previousRevision.set(null);
    this._actionError.set(null);
    this._processingTimedOut.set(false);
  }

  async loadRevision(number: number): Promise<void> {
    const detail = this._detail();
    if (!detail || number < 1) {
      this._revision.set(null);
      this._previousRevision.set(null);
      return;
    }
    const current = await firstValueFrom(this.service.revision(detail.request.id, number));
    this._revision.set(current);
    this._previousRevision.set(
      number > 1
        ? await firstValueFrom(this.service.revision(detail.request.id, number - 1))
        : null,
    );
  }

  returnForChanges(message: string, comments: FormFieldComment[]): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.returnForChanges(
        detail.request.id,
        message,
        comments,
        detail.request.rowVersion,
      ),
    );
  }

  complete(note: string | null): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.complete(detail.request.id, note, detail.request.rowVersion),
    );
  }

  cancel(note: string | null): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.cancel(detail.request.id, note, detail.request.rowVersion),
    );
  }

  archive(note: string | null): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.archive(detail.request.id, note, detail.request.rowVersion),
    );
  }

  changeDueDate(dueAtUtc: string | null): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.changeDueDate(detail.request.id, dueAtUtc, detail.request.rowVersion),
    );
  }

  linkCustomer(customerId: string): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.linkCustomer(detail.request.id, customerId, detail.request.rowVersion),
    );
  }

  assignResponsible(userId: string): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.assignResponsible(detail.request.id, userId, detail.request.rowVersion),
    );
  }

  startCustomerCreation(): Promise<boolean> {
    return this.mutate((detail) => this.service.startCustomerCreation(detail.request.id));
  }

  retryAction(runId: string): Promise<boolean> {
    return this.mutate((detail) => this.service.retryAction(detail.request.id, runId));
  }

  retryCustomerLink(): Promise<boolean> {
    return this.mutate((detail) => this.service.retryCustomerLink(detail.request.id));
  }

  async reveal(sensitiveAnswerId: string): Promise<string | null> {
    const detail = this._detail();
    if (!detail) return null;
    this._actionError.set(null);
    try {
      return (await firstValueFrom(this.service.reveal(detail.request.id, sensitiveAnswerId)))
        .value;
    } catch (error) {
      this._actionError.set(toApiError(error).message);
      return null;
    }
  }

  dismissActionError(): void {
    this._actionError.set(null);
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private async mutate(
    request: (detail: StaffFormRequestDetail) => Observable<unknown>,
  ): Promise<boolean> {
    const detail = this._detail();
    if (!detail || this._actionBusy()) return false;
    this._actionBusy.set(true);
    this._actionError.set(null);
    try {
      await firstValueFrom(request(detail));
      await Promise.all([this.open(detail.request.id), this.load(), this.loadStatusCounts()]);
      return true;
    } catch (error) {
      this._actionError.set(toApiError(error).message);
      if (error instanceof HttpErrorResponse && error.status === 409) {
        await Promise.all([this.open(detail.request.id), this.load(), this.loadStatusCounts()]);
      }
      return false;
    } finally {
      this._actionBusy.set(false);
    }
  }

  private startPollingIfNeeded(): void {
    if (!this.hasRequestedActions() || this.pollAttempts >= POLL_LIMIT) {
      if (this.hasRequestedActions() && this.pollAttempts >= POLL_LIMIT)
        this._processingTimedOut.set(true);
      return;
    }
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      const id = this._detail()?.request.id;
      if (!id) return;
      this.pollAttempts++;
      try {
        const detail = await firstValueFrom(this.service.get(id));
        this._detail.set(detail);
        await this.load();
      } catch {
        // Un fallo transitorio no cierra el drawer; el siguiente intervalo vuelve a consultar.
      }
      this.startPollingIfNeeded();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollAttempts = 0;
  }
}
