import { Component, computed, input } from '@angular/core';

interface BrandMark {
  path: string;
  color: string;
}

/**
 * Logos de marca por código de proveedor (uso nominativo: solo identificar, sin alterar la forma).
 * Fuente: Simple Icons 13.21.0 (https://simpleicons.org), licencia CC0 1.0 (dominio público). viewBox 24×24.
 */
const BRAND_MARKS: Record<string, BrandMark> = {
  stripe: {
    color: '#635BFF',
    path: 'M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z',
  },
  paypal: {
    color: '#003087',
    path: 'M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z',
  },
};

/** Logo del proveedor (código del catálogo → marca); sin logo conocido, monograma con la inicial. */
export function brandMarkFor(code: string | null | undefined): BrandMark | null {
  return BRAND_MARKS[(code ?? '').toLowerCase()] ?? null;
}

/** Baldosa con el logo del proveedor sobre fondo neutro (o su inicial para uno futuro sin logo). */
@Component({
  selector: 'app-provider-logo',
  host: { class: 'inline-flex shrink-0' },
  template: `
    @if (mark(); as brand) {
      <span class="grid place-items-center border border-gray-100 bg-white" [attr.aria-hidden]="decorative() || null"
        [class]="size() === 'sm' ? 'h-9 w-9 rounded-xl' : 'h-10 w-10 rounded-[0.875rem]'">
        <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" [attr.aria-label]="name()"
          [class]="size() === 'sm' ? 'h-[1.125rem] w-[1.125rem]' : 'h-5 w-5'">
          <path [attr.d]="brand.path" [attr.fill]="brand.color" />
        </svg>
      </span>
    } @else {
      <span class="pf-icon-tile font-bold" [class.pf-icon-tile--sm]="size() === 'sm'" role="img" [attr.aria-label]="name()"
        [attr.aria-hidden]="decorative() || null">
        <span aria-hidden="true">{{ initial() }}</span>
      </span>
    }
  `,
})
export class ProviderLogoComponent {
  readonly code = input.required<string>();
  readonly name = input('');
  readonly size = input<'md' | 'sm'>('md');
  /** Con el nombre escrito al lado, el logo se oculta al lector de pantalla (evita "Stripe Stripe"). */
  readonly decorative = input(false);

  readonly mark = computed(() => brandMarkFor(this.code()));
  readonly initial = computed(() => (this.name() || this.code() || '?').charAt(0).toUpperCase());
}
