import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { boolProp, stringProp } from '@shared/utils/data-collection/properties';

@Component({
  selector: 'app-dc-consent-field',
  template: `<section class="rounded-2xl border border-gray-200 bg-gray-50 p-4">
    <p class="text-sm font-semibold text-gray-900">{{ component.label || 'Consent notice' }}</p>
    <p class="mt-1 text-sm text-gray-700">{{ acceptanceText }}</p>
    <p class="mt-2 text-xs text-gray-600">Notice {{ noticeKey }} · version {{ version }}</p>
    @if (mode === 'acceptance') {
      <button
        type="button"
        class="mt-4 min-h-11 rounded-full bg-brand-bold px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        [disabled]="readonly"
        (click)="requested.emit()"
      >
        {{ blocking ? 'Review and accept' : 'Review consent' }}
      </button>
    }
  </section>`,
})
export class DcConsentFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  @Input() readonly = false;
  @Output() readonly requested = new EventEmitter<void>();
  get mode(): string {
    return stringProp(this.component.props, 'mode') ?? 'noticeOnly';
  }
  get noticeKey(): string {
    return stringProp(this.component.props, 'noticeKey') ?? 'notice';
  }
  get version(): number {
    const value = this.component.props?.['noticeVersionNumber'];
    return typeof value === 'number' ? value : 1;
  }
  get acceptanceText(): string {
    return (
      stringProp(this.component.props, 'acceptanceText') ??
      'Please review this notice before continuing.'
    );
  }
  get blocking(): boolean {
    return boolProp(this.component.props, 'blocking', false);
  }
}
