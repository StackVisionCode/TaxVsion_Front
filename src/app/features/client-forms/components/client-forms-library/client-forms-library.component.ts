import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { LaunchOverlayComponent } from '@shared/ui/launch-overlay/launch-overlay.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { runWithLaunch, type LaunchPhase } from '@shared/utils/launch.util';
import { PreviewPanelComponent } from '../../ui/preview-panel/preview-panel.component';
import { FormLibraryStore } from '../../data-access/form-library.store';
import { FormLibraryService } from '../../data-access/form-library.service';
import { FormTemplatesService } from '../../data-access/form-templates.service';
import type { FormTemplateDetail, LibraryTemplateSummary } from '../../data-access/client-forms.model';

@Component({
  selector: 'app-client-forms-library',
  imports: [LaunchOverlayComponent, PreviewPanelComponent, StateBlockComponent],
  providers: [FormLibraryStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-5">
      @if (store.loading() || store.error() || store.items().length === 0) {
        <app-state-block
          [loading]="store.loading()"
          loadingText="Loading library…"
          [error]="store.error() || null"
          [empty]="store.items().length === 0"
          icon="documents-outline"
          emptyTitle="No library templates yet"
          emptyMessage="Templates from TaxVision appear here, ready to copy and adapt."
          minHeight="16rem"
          (retry)="store.load()"
        />
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          @for (item of store.items(); track item.key) {
            <article
              class="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div class="flex-1">
                <div class="flex items-center justify-between gap-3">
                  <span
                    class="grid h-10 w-10 place-items-center rounded-xl bg-brand-bold/[0.07] text-brand-bold"
                    aria-hidden="true"
                  >
                    <ion-icon name="document-text-outline" class="text-lg"></ion-icon>
                  </span>
                  <span class="rounded-full bg-gray-100 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-gray-700">
                    {{ purposeLabel(item.purpose) }}
                  </span>
                </div>
                <h3 class="mt-4 text-base font-bold text-gray-900">{{ item.name }}</h3>
                @if (item.description) {
                  <p class="mt-1 line-clamp-3 text-sm text-gray-600">{{ item.description }}</p>
                }
                <p class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gray-500">
                  <ion-icon name="layers-outline" class="text-sm"></ion-icon>
                  TaxVision · v{{ item.latestVersionNumber }}
                </p>
              </div>
              <div class="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                  [disabled]="previewingKey() === item.key"
                  (click)="preview(item)"
                >
                  {{ previewingKey() === item.key ? 'Opening…' : 'Preview' }}
                </button>
                @if (canManage) {
                  <button
                    type="button"
                    class="min-h-10 flex-1 rounded-full bg-brand-bold px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-ink disabled:opacity-60"
                    [disabled]="launch() !== 'idle'"
                    (click)="use(item)"
                  >
                    Use this template
                  </button>
                }
              </div>
            </article>
          }
        </div>
      }

      <app-launch-overlay
        variant="create"
        exit="hold"
        [phase]="launch()"
        [workingCaption]="'Adding ' + cloningName() + ' to your templates…'"
        doneCaption="Opening the builder…"
      />

      @if (isPlatformAdmin()) {
        <section class="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
          <h2 class="text-sm font-bold text-indigo-950">Manage library (TaxVision)</h2>
          <p class="mt-1 text-xs text-indigo-800">
            Listed templates show their latest published version to every office. Recording a review is
            optional and keeps a note of who checked which version.
          </p>

          <label class="mt-4 block text-sm font-semibold text-gray-700"
            >Template<select
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
              (change)="selectTemplate($event)"
            >
              <option value="" [selected]="!selected()">Select a template…</option>
              @for (template of platformTemplates(); track template.id) {
                <option [value]="template.id" [selected]="selected()?.id === template.id">
                  {{ template.name }}
                </option>
              }
            </select></label
          >

          @if (selected(); as detail) {
            <div class="mt-4 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-700">
                  {{ detail.latestVersionNumber ? 'Published v' + detail.latestVersionNumber : 'No published version' }}
                </span>
                <span
                  class="rounded-full px-2 py-0.5 font-semibold"
                  [class.bg-green-100]="detail.isLibraryListed"
                  [class.text-green-800]="detail.isLibraryListed"
                  [class.bg-gray-100]="!detail.isLibraryListed"
                  [class.text-gray-600]="!detail.isLibraryListed"
                >
                  {{ detail.isLibraryListed ? 'Listed' : 'Not listed' }}
                </span>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <label class="text-sm font-semibold text-gray-700"
                  >Reviewer role<input
                    class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
                    maxlength="32"
                    [value]="reviewerRole()"
                    (input)="reviewerRole.set(inputValue($event))"
                /></label>
                <label class="text-sm font-semibold text-gray-700"
                  >Library key<input
                    class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
                    maxlength="100"
                    placeholder="individual-tax-intake"
                    [value]="libraryKey()"
                    (input)="libraryKey.set(inputValue($event))"
                /></label>
              </div>
              <label class="block text-sm font-semibold text-gray-700"
                >Review note<textarea
                  class="mt-1 w-full rounded-2xl border border-gray-300 p-3"
                  rows="2"
                  maxlength="1000"
                  [value]="reviewNote()"
                  (input)="reviewNote.set(inputValue($event))"
                ></textarea
              ></label>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-60"
                  [disabled]="busy() || !detail.latestVersionNumber || !reviewerRole().trim()"
                  (click)="recordReview(detail)"
                >
                  Record review of v{{ detail.latestVersionNumber }}
                </button>
                @if (!detail.isLibraryListed) {
                  <button
                    type="button"
                    class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white disabled:opacity-60"
                    [disabled]="busy() || !libraryKey().trim() || !detail.latestVersionNumber"
                    (click)="setListing(detail, true)"
                  >
                    List in library
                  </button>
                } @else {
                  <button
                    type="button"
                    class="min-h-10 rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 disabled:opacity-60"
                    [disabled]="busy()"
                    (click)="setListing(detail, false)"
                  >
                    Unlist
                  </button>
                }
                <button
                  type="button"
                  class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-60"
                  [disabled]="busy()"
                  (click)="export(detail)"
                >
                  Export JSON
                </button>
              </div>
            </div>
          }
        </section>
      }
    </div>

    @if (previewDefinition(); as definition) {
      <app-form-preview-panel
        [isOpen]="true"
        [definition]="definition"
        [heading]="previewHeading()"
        subheading="Read-only preview of the latest reviewed version."
        (closed)="previewDefinition.set(null)"
      />
    }
  `,
})
export class ClientFormsLibraryComponent implements OnInit {
  readonly store = inject(FormLibraryStore);
  private readonly service = inject(FormLibraryService);
  private readonly templates = inject(FormTemplatesService);
  private readonly access = inject(AccessStore);
  private readonly router = inject(Router);

  readonly canManage = this.access.can('tasks.form_templates.manage');
  readonly previewingKey = signal<string | null>(null);
  readonly cloningName = signal('');
  readonly launch = signal<LaunchPhase>('idle');
  private readonly toast = inject(ToastService);
  readonly previewDefinition = signal<FormDefinition | null>(null);
  readonly previewHeading = signal('Library template');

  // Gestión de plataforma.
  readonly platformTemplates = signal<{ id: string; name: string }[]>([]);
  readonly selected = signal<FormTemplateDetail | null>(null);
  readonly reviewerRole = signal('EA');
  readonly reviewNote = signal('');
  readonly libraryKey = signal('');
  readonly busy = signal(false);

  isPlatformAdmin(): boolean {
    return this.access.actorType() === 'PlatformAdmin';
  }

  async ngOnInit(): Promise<void> {
    await this.store.load();
    if (this.isPlatformAdmin()) await this.loadPlatformTemplates();
  }

  purposeLabel(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  async preview(item: LibraryTemplateSummary): Promise<void> {
    this.previewingKey.set(item.key);
    try {
      const preview = await firstValueFrom(this.service.preview(item.key));
      this.previewHeading.set(item.name);
      this.previewDefinition.set(JSON.parse(preview.definition) as FormDefinition);
    } catch {
      // Antes el error se perdía y el botón no hacía nada.
      this.toast.error('The preview could not be opened. Please try again.');
    } finally {
      this.previewingKey.set(null);
    }
  }

  async use(item: LibraryTemplateSummary): Promise<void> {
    if (this.launch() !== 'idle') return;
    this.cloningName.set(item.name);
    // Igual que "New template": se copia con la coreografía y se navega con la pantalla cubierta.
    const id = await runWithLaunch(this.launch, () => this.store.clone(item.key), { keepOnDone: true });
    if (!id) {
      this.toast.error(this.store.error() || 'The template could not be added.');
      return;
    }
    if (!(await this.router.navigate(['/client-forms/templates', id]))) this.launch.set('idle');
  }

  private async loadPlatformTemplates(): Promise<void> {
    try {
      const result = await firstValueFrom(this.templates.list({ status: 'Active', pageSize: 100 }));
      this.platformTemplates.set(result.items.map((item) => ({ id: item.id, name: item.name })));
    } catch {
      this.platformTemplates.set([]);
    }
  }

  async selectTemplate(event: Event): Promise<void> {
    const id = this.inputValue(event);
    if (!id) {
      this.selected.set(null);
      return;
    }
    const detail = await firstValueFrom(this.templates.get(id));
    this.selected.set(detail);
    this.libraryKey.set(detail.libraryKey ?? '');
  }

  async recordReview(detail: FormTemplateDetail): Promise<void> {
    this.busy.set(true);
    try {
      const updated = await this.store.recordReview(detail.id, {
        reviewedVersionNumber: detail.latestVersionNumber,
        reviewerRole: this.reviewerRole().trim(),
        note: this.reviewNote().trim() || null,
      });
      if (updated) {
        this.selected.set(updated);
        this.reviewNote.set('');
      }
    } finally {
      this.busy.set(false);
    }
  }

  async setListing(detail: FormTemplateDetail, isListed: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const updated = await this.store.setListing(detail.id, {
        libraryKey: this.libraryKey().trim(),
        isListed,
      });
      if (updated) this.selected.set(updated);
    } finally {
      this.busy.set(false);
    }
  }

  async export(detail: FormTemplateDetail): Promise<void> {
    this.busy.set(true);
    try {
      const json = await firstValueFrom(this.service.exportTemplate(detail.id));
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${detail.libraryKey ?? detail.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      this.busy.set(false);
    }
  }
}
