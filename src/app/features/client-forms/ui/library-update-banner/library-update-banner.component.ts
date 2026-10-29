import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { PreviewPanelComponent } from '../preview-panel/preview-panel.component';
import { FormLibraryService } from '../../data-access/form-library.service';
import type { LibraryOrigin } from '../../data-access/client-forms.model';

// Aviso de actualización (P-9): si la biblioteca tiene una versión revisada más nueva que el clon,
// se ofrece revisar los cambios en solo lectura. Nunca actualiza el clon por su cuenta.
@Component({
  selector: 'app-library-update-banner',
  imports: [PreviewPanelComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (newerVersion() !== null) {
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-200 bg-indigo-50 px-5 py-2 text-sm text-indigo-900"
        role="status"
      >
        <span class="flex items-center gap-2">
          <ion-icon name="sparkles-outline" class="text-base text-indigo-500"></ion-icon>
          A newer library version is available (v{{ newerVersion() }}).
        </span>
        <!-- "action-secondary" vive encapsulado en el builder y aquí no aplicaba: estilo propio. -->
        <button
          type="button"
          class="inline-flex min-h-9 items-center rounded-full border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-800 transition-colors hover:bg-indigo-100"
          (click)="reviewChanges()"
        >
          Review changes
        </button>
      </div>
    }

    @if (previewDefinition(); as definition) {
      <app-form-preview-panel
        [isOpen]="true"
        [definition]="definition"
        heading="Newer library version"
        subheading="Read-only. Your form is not changed."
        (closed)="previewDefinition.set(null)"
      />
    }
  `,
})
export class LibraryUpdateBannerComponent {
  private readonly service = inject(FormLibraryService);
  readonly newerVersion = signal<number | null>(null);
  readonly previewDefinition = signal<FormDefinition | null>(null);

  private current: LibraryOrigin | null = null;

  @Input() set origin(value: LibraryOrigin | null) {
    this.current = value;
    this.newerVersion.set(null);
    this.previewDefinition.set(null);
    if (value) void this.check(value);
  }

  private async check(origin: LibraryOrigin): Promise<void> {
    try {
      const items = await firstValueFrom(this.service.list());
      const match = items.find((item) => item.key === origin.libraryKey);
      if (match && match.latestVersionNumber > origin.sourceVersionNumber)
        this.newerVersion.set(match.latestVersionNumber);
    } catch {
      this.newerVersion.set(null);
    }
  }

  async reviewChanges(): Promise<void> {
    if (!this.current) return;
    const preview = await firstValueFrom(this.service.preview(this.current.libraryKey));
    this.previewDefinition.set(JSON.parse(preview.definition) as FormDefinition);
  }
}
