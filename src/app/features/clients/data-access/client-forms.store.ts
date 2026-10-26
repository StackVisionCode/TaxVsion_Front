import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal, inject } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import type { DataCollectionFieldComment } from '@shared/ui/data-collection/data-collection.models';
import { firstValueFrom } from 'rxjs';
import type {
  AssignClientFormInput,
  AssignableClientFormTemplate,
  ClientFormRequestDetail,
  ClientFormRequestRow,
  ClientFormRevision,
} from './client-forms.model';
import { ClientFormsService } from './client-forms.service';

@Injectable()
export class ClientFormsStore {
  private readonly service = inject(ClientFormsService);
  private customerId = '';

  private readonly _items = signal<ClientFormRequestRow[]>([]);
  private readonly _templates = signal<AssignableClientFormTemplate[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _detail = signal<ClientFormRequestDetail | null>(null);
  private readonly _revision = signal<ClientFormRevision | null>(null);
  private readonly _previousRevision = signal<ClientFormRevision | null>(null);
  private readonly _busy = signal(false);
  private readonly _actionError = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly templates = this._templates.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly detail = this._detail.asReadonly();
  readonly revision = this._revision.asReadonly();
  readonly previousRevision = this._previousRevision.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  async load(customerId: string): Promise<void> {
    this.customerId = customerId;
    this._loading.set(true);
    this._error.set(null);
    try {
      const [page, templates] = await Promise.all([
        firstValueFrom(this.service.list(customerId)),
        firstValueFrom(this.service.templates()),
      ]);
      this._items.set(page.items ?? []);
      this._templates.set(templates);
    } catch (error) {
      this._error.set(toApiError(error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async assign(input: Omit<AssignClientFormInput, 'customerId'>): Promise<boolean> {
    if (!this.customerId || this._busy()) return false;
    this._busy.set(true);
    this._actionError.set(null);
    try {
      const created = await firstValueFrom(
        this.service.assign({ ...input, customerId: this.customerId }),
      );
      await this.load(this.customerId);
      await this.open(created.id);
      return true;
    } catch (error) {
      this._actionError.set(toApiError(error).message);
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  async open(id: string): Promise<void> {
    this._actionError.set(null);
    try {
      const detail = await firstValueFrom(this.service.detail(id));
      this._detail.set(detail);
      await this.loadRevision(detail.request.currentRevisionNumber);
    } catch (error) {
      this._actionError.set(toApiError(error).message);
    }
  }

  close(): void {
    this._detail.set(null);
    this._revision.set(null);
    this._previousRevision.set(null);
    this._actionError.set(null);
  }

  async loadRevision(number: number): Promise<void> {
    const id = this._detail()?.request.id;
    if (!id || number < 1) return;
    this._revision.set(await firstValueFrom(this.service.revision(id, number)));
    this._previousRevision.set(
      number > 1 ? await firstValueFrom(this.service.revision(id, number - 1)) : null,
    );
  }

  returnForChanges(message: string, comments: DataCollectionFieldComment[]): Promise<boolean> {
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

  changeDueDate(dueAtUtc: string | null): Promise<boolean> {
    return this.mutate((detail) =>
      this.service.dueDate(detail.request.id, dueAtUtc, detail.request.rowVersion),
    );
  }

  async reveal(id: string): Promise<string | null> {
    const requestId = this._detail()?.request.id;
    if (!requestId) return null;
    try {
      return (await firstValueFrom(this.service.reveal(requestId, id))).value;
    } catch (error) {
      this._actionError.set(toApiError(error).message);
      return null;
    }
  }

  dismissActionError(): void {
    this._actionError.set(null);
  }

  private async mutate(
    call: (detail: ClientFormRequestDetail) => ReturnType<ClientFormsService['complete']>,
  ): Promise<boolean> {
    const detail = this._detail();
    if (!detail || this._busy()) return false;
    this._busy.set(true);
    this._actionError.set(null);
    try {
      await firstValueFrom(call(detail));
      await Promise.all([this.open(detail.request.id), this.load(this.customerId)]);
      return true;
    } catch (error) {
      this._actionError.set(toApiError(error).message);
      if (error instanceof HttpErrorResponse && error.status === 409) {
        await Promise.all([this.open(detail.request.id), this.load(this.customerId)]);
      }
      return false;
    } finally {
      this._busy.set(false);
    }
  }
}
