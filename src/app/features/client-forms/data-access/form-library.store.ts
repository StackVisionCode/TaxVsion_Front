import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  FormTemplateDetail,
  LibraryTemplateSummary,
  RecordLibraryReviewInput,
  SetLibraryListingInput,
} from './client-forms.model';
import { FormLibraryService } from './form-library.service';

@Injectable()
export class FormLibraryStore {
  private readonly service = inject(FormLibraryService);

  readonly items = signal<LibraryTemplateSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.items.set(await firstValueFrom(this.service.list()));
    } catch {
      this.error.set('The library could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Clona la plantilla de biblioteca; devuelve el id del clon para abrir su builder. */
  async clone(key: string): Promise<string | null> {
    this.error.set('');
    try {
      const created = await firstValueFrom(this.service.clone(key));
      return created.id;
    } catch {
      this.error.set('The template could not be added from the library.');
      return null;
    }
  }

  async recordReview(
    templateId: string,
    input: RecordLibraryReviewInput,
  ): Promise<FormTemplateDetail | null> {
    this.error.set('');
    try {
      return await firstValueFrom(this.service.recordReview(templateId, input));
    } catch {
      this.error.set('The review could not be recorded.');
      return null;
    }
  }

  async setListing(
    templateId: string,
    input: SetLibraryListingInput,
  ): Promise<FormTemplateDetail | null> {
    this.error.set('');
    try {
      const detail = await firstValueFrom(this.service.setListing(templateId, input));
      await this.load();
      return detail;
    } catch {
      this.error.set(
        input.isListed ? 'The template could not be listed.' : 'The template could not be unlisted.',
      );
      return null;
    }
  }
}
