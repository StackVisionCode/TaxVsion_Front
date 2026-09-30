import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';

export interface SegmentedOption<T extends string | number = string> {
  id: T;
  label: string;
}

/**
 * Control segmentado (sub-pestañas en píldora), extraído de campaigns-page (Lists/Contacts).
 *
 * Uso: `<app-segmented [options]="[{ id: 'lists', label: 'Lists' }, …]" [value]="tab()" (valueChange)="tab.set($event)" />`
 *
 * Markup de campaigns: pista `flex rounded-full bg-gray-100 p-1`; segmento `rounded-full px-3.5 py-1.5
 * text-xs font-semibold`, activo `bg-white text-gray-900 shadow-sm`, inactivo `text-gray-500`
 * (se añade `hover:text-gray-700` y `transition-colors`). `role="tablist"`/`aria-selected`.
 * Pulsar el segmento activo no emite.
 */
@Component({
  selector: 'app-segmented',
  imports: [NgClass],
  host: { class: 'inline-flex' },
  template: `
    <div class="flex rounded-full bg-gray-100 p-1" role="tablist">
      @for (option of options; track option.id) {
        <button type="button" role="tab" [attr.aria-selected]="option.id === value" (click)="select(option.id)"
          class="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors"
          [ngClass]="option.id === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class SegmentedComponent<T extends string | number = string> {
  @Input() options: readonly SegmentedOption<T>[] = [];
  @Input() value: T | null = null;
  @Output() readonly valueChange = new EventEmitter<T>();

  select(id: T): void {
    if (id !== this.value) {
      this.valueChange.emit(id);
    }
  }
}
