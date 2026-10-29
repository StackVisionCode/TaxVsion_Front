import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { richProp, textProp } from '../data-collection.utils';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';

/**
 * P-18 — paso de firma opcional. Aviso de solo lectura: la firma NO se captura aquí, ocurre luego
 * en el enlace seguro enviado por correo. Las `instructions` (RichText o texto plano) se muestran
 * junto al aviso.
 */
@Component({
  selector: 'app-dc-signature-step-field',
  imports: [DcMarkdownComponent],
  template: `<section class="rounded-2xl border border-brand-border bg-brand-surface p-4">
    <div class="flex items-start gap-3">
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-bold"
        aria-hidden="true"
        >✓</span
      >
      <div>
        <p class="font-semibold text-gray-900">{{ component.label || 'Electronic signature' }}</p>
        @if (instructionsDocument) {
          <div class="mt-1 text-sm text-gray-700">
            <app-dc-markdown [document]="instructionsDocument" />
          </div>
        } @else if (instructionsText) {
          <p class="mt-1 text-sm text-gray-700">{{ instructionsText }}</p>
        }
        <p class="mt-2 text-sm text-gray-700">
          You'll sign this document through a secure link we'll email you.
        </p>
      </div>
    </div>
  </section>`,
})
export class DcSignatureStepFieldComponent {
  @Input({ required: true }) component!: FormComponent;

  get instructionsDocument() {
    return richProp(this.component, 'instructions');
  }

  get instructionsText(): string {
    return textProp(this.component, 'instructions');
  }
}
