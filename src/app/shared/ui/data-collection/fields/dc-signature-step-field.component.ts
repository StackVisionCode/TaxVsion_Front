import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { stringProp } from '@shared/utils/data-collection/properties';

@Component({
  selector: 'app-dc-signature-step-field',
  template: `<section class="rounded-2xl border border-brand-border bg-brand-surface p-4">
    <div class="flex items-start gap-3">
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-bold"
        aria-hidden="true"
        >✓</span
      >
      <div>
        <p class="font-semibold text-gray-900">{{ component.label || 'Electronic signature' }}</p>
        <p class="mt-1 text-sm text-gray-700">{{ instructions }}</p>
        <p class="mt-2 text-xs font-medium text-brand-bold">
          Signature is completed securely in the signing step.
        </p>
      </div>
    </div>
  </section>`,
})
export class DcSignatureStepFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  get instructions(): string {
    return (
      stringProp(this.component.props, 'instructions') ??
      'You will receive a separate secure signature request.'
    );
  }
}
