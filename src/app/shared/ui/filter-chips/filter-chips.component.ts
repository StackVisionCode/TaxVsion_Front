import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { DropdownMenuComponent, MenuItemDirective } from '../dropdown-menu/dropdown-menu.component';

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
 * - `collapseAfter` (default 5): si hay MÁS opciones que ese número, la fila se reemplaza por una
 *   sola píldora con el mismo estilo (etiqueta seleccionada + chevron) que abre un `app-dropdown-menu`
 *   con todas las opciones (scroll si son muchas). Con la opción "All" (id `all`/`All`) seleccionada
 *   la píldora se pinta inactiva; con cualquier otra, activa. `[collapseAfter]="null"` = siempre chips.
 */
@Component({
  selector: 'app-filter-chips',
  imports: [NgClass, DropdownMenuComponent, MenuItemDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'flex flex-wrap items-center gap-2', role: 'group' },
  template: `
    @if (collapsed) {
      <app-dropdown-menu align="left" panelClass="min-w-[200px]" [ariaLabel]="ariaLabel">
        <button menuTrigger type="button" aria-haspopup="menu"
          class="flex items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors"
          [ngClass]="[size === 'sm' ? 'py-1.5' : 'py-2', isDefault ? 'border border-gray-200 text-gray-500 hover:bg-gray-100' : 'bg-brand-bold text-white']">
          {{ selected?.label ?? options[0]?.label }}
          @if (selected?.count !== null && selected?.count !== undefined) {
            <span class="opacity-70">{{ selected?.count }}</span>
          }
          <ion-icon name="chevron-down-outline" class="text-sm"></ion-icon>
        </button>
        <div class="max-h-72 overflow-y-auto py-1">
          @for (option of options; track option.id) {
            <button appMenuItem type="button" (click)="select(option.id)" [attr.aria-checked]="option.id === value"
              [class.font-semibold]="option.id === value">
              <span class="flex-1 truncate">{{ option.label }}</span>
              @if (option.count !== null && option.count !== undefined) {
                <span class="text-xs text-gray-400">{{ option.count }}</span>
              }
              <ion-icon name="checkmark-outline" class="text-base text-brand-bold"
                [class.invisible]="option.id !== value"></ion-icon>
            </button>
          }
        </div>
      </app-dropdown-menu>
    } @else {
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
    }
  `,
})
export class FilterChipsComponent<T extends string | number = string> {
  @Input() options: readonly FilterChipOption<T>[] = [];
  @Input() value: T | null = null;
  @Input() size: FilterChipsSize = 'md';
  /** Máximo de chips visibles; por encima se muestra como dropdown. `null` = siempre chips. */
  @Input() collapseAfter: number | null = 5;
  /** Etiqueta accesible del dropdown cuando está colapsado. */
  @Input() ariaLabel = 'Filter';
  @Output() readonly valueChange = new EventEmitter<T>();

  get collapsed(): boolean {
    return this.collapseAfter !== null && this.options.length > this.collapseAfter;
  }

  get selected(): FilterChipOption<T> | undefined {
    return this.options.find(o => o.id === this.value);
  }

  /** "Sin filtro" = la opción con id `all` (en cualquier mayúscula): la píldora se pinta inactiva. */
  get isDefault(): boolean {
    return this.value === null || String(this.value).toLowerCase() === 'all';
  }

  select(id: T): void {
    if (id !== this.value) {
      this.valueChange.emit(id);
    }
  }
}
