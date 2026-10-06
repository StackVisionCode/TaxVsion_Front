import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';

export interface FilterChipOption<T extends string | number = string> {
  id: T;
  label: string;
  /** Contador opcional junto a la etiqueta (`<span class="ml-1 opacity-70">`). */
  count?: number | null;
}

export type FilterChipsSize = 'md' | 'sm';

/**
 * Fila de chips de filtro de una sola selección (All / Active / … de inventory, signature, clients…).
 *
 * Uso: `<app-filter-chips [options]="filters" [value]="active()" (valueChange)="active.set($event)" />`
 *
 * - Activo `bg-brand-bold text-white`; inactivo `border border-gray-200 text-gray-500 hover:bg-gray-100`;
 *   base `rounded-full px-4 py-2 text-sm font-medium transition-colors` (`size="sm"` → `py-1.5`).
 * - El host es `flex flex-wrap items-center gap-2`, así que se mete tal cual en la barra de filtros;
 *   el buscador va como hermano (`<app-search-input class="ml-auto">`).
 * - `count` pinta `<span class="ml-1 opacity-70">` (products-services). `aria-pressed` en cada chip.
 * - Pulsar el chip ya activo no emite.
 */
@Component({
  selector: 'app-filter-chips',
  imports: [NgClass],
  host: { class: 'flex flex-wrap items-center gap-2', role: 'group' },
  template: `
    @for (option of options; track option.id) {
      <button type="button" (click)="select(option.id)" [attr.aria-pressed]="option.id === value"
        class="rounded-full px-4 text-sm font-medium transition-colors"
        [ngClass]="[size === 'sm' ? 'py-1.5' : 'py-2', option.id === value ? 'bg-brand-bold text-white' : 'border border-gray-200 text-gray-500 hover:bg-gray-100']">
        {{ option.label }}
        @if (option.count !== null && option.count !== undefined) {
          <span class="ml-1 opacity-70">{{ option.count }}</span>
        }
      </button>
    }
  `,
})
export class FilterChipsComponent<T extends string | number = string> {
  @Input() options: readonly FilterChipOption<T>[] = [];
  @Input() value: T | null = null;
  @Input() size: FilterChipsSize = 'md';
  @Output() readonly valueChange = new EventEmitter<T>();

  select(id: T): void {
    if (id !== this.value) {
      this.valueChange.emit(id);
    }
  }
}
