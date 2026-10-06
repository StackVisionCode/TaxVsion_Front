import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, signal } from '@angular/core';
import { NgClass } from '@angular/common';

/**
 * Buscador en píldora de las barras de filtros (inventory, signature, clients…).
 *
 * Uso: `<app-search-input class="ml-auto" placeholder="Search products or SKU" [value]="search()"
 *   (valueChange)="onSearchChange($event)" />`
 *
 * - Markup idéntico al de las copias: contenedor `flex h-10 items-center rounded-full border
 *   border-gray-200 bg-white px-4 focus-within:border-gray-300`, icono `search-outline mr-2` e input
 *   transparente. Añade un botón de limpiar (×) cuando hay texto (las copias no lo tenían).
 * - `widthClass` es el ancho del INPUT (default 'w-48', el de inventory). Para ancho del contenedor,
 *   ponle clases al host (`class="w-full sm:w-56"`) y `widthClass="w-full"`.
 * - `debounceMs` (default 0 = emite en cada tecla, como hoy). Limpiar emite al instante.
 * - `ariaLabel` (default = placeholder).
 */
@Component({
  selector: 'app-search-input',
  imports: [NgClass],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    <div class="flex h-10 items-center rounded-full border border-gray-200 bg-white px-4 focus-within:border-gray-300 transition-colors">
      <ion-icon name="search-outline" class="mr-2 shrink-0 text-base text-gray-400"></ion-icon>
      <input type="text" autocomplete="off" [placeholder]="placeholder" [attr.aria-label]="ariaLabel || placeholder"
        [value]="text()" (input)="onInput($any($event.target).value)" (keydown.escape)="text() && clear($event)"
        class="h-full bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none" [ngClass]="widthClass" />
      @if (text()) {
        <button type="button" (click)="clear($event)" aria-label="Clear search"
          class="ml-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <ion-icon name="close-outline" class="text-sm"></ion-icon>
        </button>
      }
    </div>
  `,
})
export class SearchInputComponent implements OnChanges, OnDestroy {
  @Input() value = '';
  @Input() placeholder = 'Search';
  @Input() debounceMs = 0;
  @Input() widthClass = 'w-48';
  @Input() ariaLabel = '';
  @Output() readonly valueChange = new EventEmitter<string>();

  /** Texto mostrado: se adelanta al padre mientras corre el debounce. */
  readonly text = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.text.set(this.value ?? '');
    }
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  onInput(value: string): void {
    this.text.set(value);
    this.cancel();
    if (this.debounceMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.valueChange.emit(value);
      }, this.debounceMs);
    } else {
      this.valueChange.emit(value);
    }
  }

  clear(event?: Event): void {
    event?.stopPropagation();
    this.cancel();
    this.text.set('');
    this.valueChange.emit('');
  }

  private cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
