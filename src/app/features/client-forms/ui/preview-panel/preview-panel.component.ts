import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { DcFormRendererComponent } from '@shared/ui/data-collection/form-renderer/dc-form-renderer.component';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';

@Component({
  selector: 'app-form-preview-panel',
  imports: [DcFormRendererComponent, DrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer
      [isOpen]="isOpen"
      [heading]="heading"
      [subheading]="subheading"
      width="xl"
      bodyClass="p-0"
      (closed)="closed.emit()"
    >
      <div
        class="sticky top-0 z-10 flex items-center justify-center gap-1 border-b border-gray-200 bg-white p-3"
      >
        <button
          type="button"
          class="rounded-full px-3 py-2 text-xs font-semibold"
          [class.bg-brand-bold]="device() === 'desktop'"
          [class.text-white]="device() === 'desktop'"
          (click)="device.set('desktop')"
        >
          Desktop
        </button>
        <button
          type="button"
          class="rounded-full px-3 py-2 text-xs font-semibold"
          [class.bg-brand-bold]="device() === 'mobile'"
          [class.text-white]="device() === 'mobile'"
          (click)="device.set('mobile')"
        >
          Mobile
        </button>
      </div>
      <div class="min-h-full bg-gray-100 p-5">
        <div
          class="mx-auto min-h-[44rem] rounded-xl bg-white p-6 shadow-sm transition-[max-width]"
          [class.max-w-[375px]]="device() === 'mobile'"
          [class.max-w-4xl]="device() === 'desktop'"
        >
          <app-dc-form-renderer
            [definition]="definition"
            [answers]="answers()"
            mode="preview"
            (answersChange)="answers.set($event)"
          />
        </div>
      </div>
    </app-drawer>
  `,
})
export class PreviewPanelComponent {
  @Input() isOpen = false;
  @Input({ required: true }) definition!: FormDefinition;
  @Input() heading = 'Preview form';
  @Input() subheading = 'This uses the same renderer as the client experience.';
  @Output() readonly closed = new EventEmitter<void>();
  readonly device = signal<'desktop' | 'mobile'>('desktop');
  readonly answers = signal<FormAnswers>({ schemaVersion: 1, values: {} });
}
