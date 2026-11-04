import { CUSTOM_ELEMENTS_SCHEMA, Component, input, output } from '@angular/core';
import { InvoiceSettings, PAYMENT_TERMS } from '../../data-access/company-settings.model';
import { INVOICE_TEXT_MAX } from '../../utils/invoice-settings-rules';
import { FormField } from '../../utils/office-profile-rules';
import { SectionHeaderComponent } from '../section-header/section-header.component';

type Errors = Partial<Record<FormField, string>>;

/** Ajustes de factura de Billing: plazo de pago, instrucciones y pie. Cada factura nueva los congela. */
@Component({
  selector: 'app-invoicing-section',
  imports: [SectionHeaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-cs-section-header icon="card-outline" heading="Invoicing" titleId="invoicing-title" [loading]="loading()"
      description="Applied to new invoices. Invoices already sent keep their terms." />

    @if (error(); as err) {
      <p class="mt-4 flex items-center gap-2 text-sm text-red-600" role="alert">
        <ion-icon name="alert-circle-outline" class="text-base"></ion-icon>{{ err }}
      </p>
    }

    <div class="mt-6 grid gap-4">
      <label class="pf-field sm:max-w-xs">
        <span class="pf-field__label">Payment terms</span>
        <select class="pf-input" (change)="set('paymentTerms', $event)" [disabled]="disabled()" [class.border-red-400]="!!errors().paymentTerms">
          @for (term of terms; track term.value) {
            <option [value]="term.value" [selected]="term.value === settings().paymentTerms">{{ term.label }}</option>
          }
        </select>
        @if (errors().paymentTerms; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        } @else {
          <span class="text-xs text-gray-500">Sets the due date of each new invoice.</span>
        }
      </label>
      <label class="pf-field">
        <span class="flex items-baseline justify-between gap-2">
          <span class="pf-field__label">Payment instructions</span>
          <span class="text-xs tabular-nums text-gray-400" aria-hidden="true">{{ count(settings().paymentInstructions) }}/{{ max }}</span>
        </span>
        <textarea rows="3" class="pf-input h-auto resize-y py-2.5" [value]="settings().paymentInstructions ?? ''" (input)="set('paymentInstructions', $event)"
          [disabled]="disabled()" [attr.maxlength]="max" [class.border-red-400]="!!errors().paymentInstructions"
          [attr.aria-invalid]="!!errors().paymentInstructions" placeholder="Pay online with the link in this email, or by check to our office address."></textarea>
        @if (errors().paymentInstructions; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
      <label class="pf-field">
        <span class="flex items-baseline justify-between gap-2">
          <span class="pf-field__label">Invoice footer</span>
          <span class="text-xs tabular-nums text-gray-400" aria-hidden="true">{{ count(settings().invoiceFooter) }}/{{ max }}</span>
        </span>
        <textarea rows="2" class="pf-input h-auto resize-y py-2.5" [value]="settings().invoiceFooter ?? ''" (input)="set('invoiceFooter', $event)"
          [disabled]="disabled()" [attr.maxlength]="max" [class.border-red-400]="!!errors().invoiceFooter"
          [attr.aria-invalid]="!!errors().invoiceFooter" placeholder="Thank you for your business!"></textarea>
        @if (errors().invoiceFooter; as err) {
          <span class="text-xs text-red-600" role="alert">{{ err }}</span>
        }
      </label>
    </div>

    @if (disabled() && !loading()) {
      <p class="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <ion-icon name="lock-closed-outline" class="text-sm text-gray-400"></ion-icon>
        Only someone who manages invoice settings can change these.
      </p>
    }
  `,
})
export class InvoicingSectionComponent {
  readonly settings = input.required<InvoiceSettings>();
  readonly disabled = input(false);
  readonly errors = input<Errors>({});
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly settingsChange = output<InvoiceSettings>();

  readonly terms = PAYMENT_TERMS;
  readonly max = INVOICE_TEXT_MAX;

  count(value: string | null): number {
    return value?.length ?? 0;
  }

  set(key: keyof InvoiceSettings, event: Event): void {
    this.settingsChange.emit({ ...this.settings(), [key]: (event.target as HTMLInputElement).value });
  }
}
