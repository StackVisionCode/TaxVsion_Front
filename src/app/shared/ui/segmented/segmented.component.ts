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
 * Pulsar el segmento activo no emite. `fill` reparte el ancho; `columns` apila en rejilla.
 * Teclado (patrón tabs): foco itinerante, flechas/Inicio/Fin mueven y seleccionan. `controls` enlaza
 * cada pestaña con su `tabpanel`.
 */
@Component({
  selector: 'app-segmented',
  imports: [NgClass],
  host: { '[class.inline-flex]': '!fill && !columns', '[class.flex]': 'fill || !!columns', '[class.w-full]': 'fill || !!columns' },
  template: `
    <div role="tablist" [ngClass]="trackClass()" [style.grid-template-columns]="columns ? 'repeat(' + columns + ', minmax(0, 1fr))' : null"
      [attr.aria-label]="ariaLabel" (keydown)="onKeydown($event)">
      @for (option of options; track option.id; let index = $index) {
        <button type="button" role="tab" [attr.aria-selected]="option.id === value" (click)="select(option.id)"
          [attr.tabindex]="index === focusIndex() ? 0 : -1" [attr.aria-controls]="controls"
          class="rounded-full py-1.5 text-xs font-semibold transition-colors"
          [ngClass]="segmentClass(option.id === value)"
          [attr.title]="fill || columns ? option.label : null">
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class SegmentedComponent<T extends string | number = string> {
  @Input() options: readonly SegmentedOption<T>[] = [];
  @Input() value: T | null = null;
  /** Ocupa todo el ancho y reparte los segmentos por igual (paneles angostos). */
  @Input() fill = false;
  /** Rejilla de N columnas: con muchas opciones se apila en filas en vez de desbordar. */
  @Input() columns: number | null = null;
  /** Id del `tabpanel` que controlan las pestañas (opcional). */
  @Input() controls: string | null = null;
  @Input() ariaLabel: string | null = null;
  @Output() readonly valueChange = new EventEmitter<T>();

  segmentClass(active: boolean): string {
    const size = this.fill || this.columns ? 'min-w-0 truncate px-2' : 'px-3.5';
    const grow = this.fill ? ' flex-1' : '';
    const tone = active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700';
    return `${size}${grow} ${tone}`;
  }

  trackClass(): string {
    if (this.columns) return 'grid w-full gap-1 rounded-2xl bg-gray-100 p-1';
    return this.fill ? 'flex w-full rounded-full bg-gray-100 p-1' : 'flex rounded-full bg-gray-100 p-1';
  }

  /** Índice con tabindex 0: el seleccionado o, si no hay, el primero. */
  focusIndex(): number {
    const index = this.options.findIndex((option) => option.id === this.value);
    return index < 0 ? 0 : index;
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.options.length;
    if (count === 0) return;
    const current = this.focusIndex();
    const targets: Record<string, number> = {
      ArrowRight: (current + 1) % count,
      ArrowDown: (current + 1) % count,
      ArrowLeft: (current - 1 + count) % count,
      ArrowUp: (current - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.select(this.options[next].id);
    const tabs = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  }

  select(id: T): void {
    if (id !== this.value) {
      this.valueChange.emit(id);
    }
  }
}
