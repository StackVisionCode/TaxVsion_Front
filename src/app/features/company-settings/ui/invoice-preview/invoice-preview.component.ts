import { Component, computed, input } from '@angular/core';
import { CompanyProfile } from '../../data-access/company-settings.model';
import { SectionHeaderComponent } from '../section-header/section-header.component';

/**
 * Vista previa de la factura con lo que se está escribiendo: emisor (nombre legal ?? DBA ?? oficina, como
 * Billing), EIN, dirección física, contacto, plazo, instrucciones y pie.
 */
@Component({
  selector: 'app-invoice-preview',
  imports: [SectionHeaderComponent],
  template: `
    <app-cs-section-header icon="receipt-outline" heading="Invoice preview" titleId="preview-title"
      description="How your details read on an invoice. Updates as you type.">
      <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Sample</span>
    </app-cs-section-header>

    <div class="cs-paper mt-6 rounded-2xl border border-gray-100 p-5 sm:p-7">
      <div class="flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div class="min-w-0">
          <p class="break-words text-base font-bold text-gray-900" [class.text-gray-300]="!issuerName()">
            {{ issuerName() || 'Your office name' }}
          </p>
          @if (profile().taxId.trim()) {
            <p class="mt-0.5 text-xs text-gray-500 tabular-nums">EIN {{ profile().taxId.trim() }}</p>
          }
          <div class="mt-3 text-sm leading-relaxed text-gray-600">
            @if (street()) {<p>{{ street() }}</p>}
            @if (cityLine()) {<p>{{ cityLine() }}</p>}
            @if (!street() && !cityLine()) {
              <p class="text-gray-300">Street address · City, State ZIP</p>
            }
          </div>
          @if (contact().length) {
            <p class="mt-2 break-words text-xs text-gray-500">{{ contact().join(' · ') }}</p>
          }
        </div>
        <div class="shrink-0 sm:text-right">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Invoice</p>
          <p class="mt-1 text-lg font-bold text-gray-900 tabular-nums">#INV-0001</p>
          @if (termsLabel(); as terms) {
            <p class="mt-1 text-xs text-gray-500">Terms: {{ terms }}</p>
          }
        </div>
      </div>
      <div class="mt-6 flex flex-col gap-2 border-t border-dashed border-gray-200 pt-4" aria-hidden="true">
        <div class="flex justify-between text-sm"><span class="text-gray-500">Individual tax return (1040)</span><span class="tabular-nums text-gray-700">$350.00</span></div>
        <div class="flex justify-between text-sm font-semibold"><span class="text-gray-900">Total</span><span class="tabular-nums text-gray-900">$350.00</span></div>
      </div>
      @if (instructions()?.trim(); as text) {
        <div class="mt-5">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">How to pay</p>
          <p class="mt-1 whitespace-pre-line break-words text-sm text-gray-600">{{ text }}</p>
        </div>
      }
      @if (footer()?.trim(); as text) {
        <p class="mt-5 whitespace-pre-line break-words border-t border-gray-100 pt-4 text-center text-xs text-gray-500">{{ text }}</p>
      }
    </div>
  `,
  styles: `
    .cs-paper {
      background: linear-gradient(180deg, #ffffff 0%, #fbfaf7 100%);
      box-shadow: 0 1px 2px rgb(60 45 20 / 0.04), 0 18px 36px -24px rgb(60 45 20 / 0.25);
    }
  `,
})
export class InvoicePreviewComponent {
  readonly profile = input.required<CompanyProfile>();
  /** Nombre visible de la oficina: último respaldo del emisor. */
  readonly officeName = input('');
  /** Plazo de pago; null = este usuario no ve los ajustes de factura. */
  readonly termsLabel = input<string | null>(null);
  readonly instructions = input<string | null>(null);
  readonly footer = input<string | null>(null);

  readonly issuerName = computed(
    () => this.profile().name.trim() || this.profile().displayName.trim() || this.officeName().trim(),
  );
  readonly street = computed(() => {
    const a = this.profile().physical;
    return [a.line1.trim(), a.line2.trim()].filter(Boolean).join(', ');
  });
  readonly cityLine = computed(() => {
    const a = this.profile().physical;
    return [a.city.trim(), [a.state.trim(), a.zip.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  });
  readonly contact = computed(() => {
    const p = this.profile();
    return [p.phone.trim(), p.email.trim(), p.website.trim()].filter(Boolean);
  });
}
