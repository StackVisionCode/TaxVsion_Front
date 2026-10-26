import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CreateFormTemplateInput,
  FormTemplateStatus,
  FormTemplateSummary,
  TemplateFilters,
} from './client-forms.model';
import { FormTemplatesService } from './form-templates.service';

@Injectable()
export class FormTemplatesStore {
  private readonly service = inject(FormTemplatesService);

  readonly items = signal<FormTemplateSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly page = signal(1);
  readonly totalPages = signal(1);
  readonly filters = signal<TemplateFilters>({ page: 1, pageSize: 25 });

  async load(update: Partial<TemplateFilters> = {}): Promise<void> {
    const filters = { ...this.filters(), ...update };
    this.filters.set(filters);
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(this.service.list(filters));
      this.items.set(result.items);
      this.page.set(result.page);
      this.totalPages.set(Math.max(1, Math.ceil(result.totalCount / result.size)));
    } catch {
      this.error.set('Templates could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  async create(input: CreateFormTemplateInput): Promise<string | null> {
    this.error.set('');
    try {
      const created = await firstValueFrom(this.service.create(input));
      await this.load();
      return created.id;
    } catch {
      this.error.set('The template could not be created.');
      return null;
    }
  }

  async duplicate(id: string): Promise<string | null> {
    try {
      const created = await firstValueFrom(this.service.duplicate(id));
      await this.load();
      return created.id;
    } catch {
      this.error.set('The template could not be duplicated.');
      return null;
    }
  }

  async setArchived(id: string, archived: boolean): Promise<boolean> {
    try {
      const detail = await firstValueFrom(this.service.get(id));
      if (archived) await firstValueFrom(this.service.archive(id, detail.rowVersion));
      else await firstValueFrom(this.service.restore(id, detail.rowVersion));
      await this.load();
      return true;
    } catch {
      this.error.set(
        archived ? 'The template could not be archived.' : 'The template could not be restored.',
      );
      return false;
    }
  }

  setStatus(status?: FormTemplateStatus): Promise<void> {
    return this.load({ status, page: 1 });
  }
}
