import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Número acotado por el rango técnico y el techo del plan/oficina. Con `nullable`, null = "usar el default"
 * (se muestra el valor vigente). Un valor fuera de rango se ajusta al límite y se explica por qué.
 */
@Component({
  selector: 'app-comm-number-setting',
  template: `
    <div class="flex flex-col items-start gap-1.5 sm:items-end">
      @if (nullable) {
        <label class="inline-flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" class="h-4 w-4 rounded border-gray-300" [checked]="value === null" [disabled]="disabled"
            (change)="toggleDefault($any($event.target).checked)" data-role="use-default" />
          Use default ({{ inherited }} {{ unit }})
        </label>
      }
      @if (!nullable || value !== null) {
        <span class="flex items-center gap-1.5">
          <input type="number" [min]="min" [max]="max" [value]="value ?? inherited" [disabled]="disabled"
            (change)="onInput($any($event.target))" [attr.aria-label]="label"
            class="w-24 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm disabled:bg-gray-50" data-role="number-input" />
          <span class="text-xs text-gray-500">{{ unit }}</span>
        </span>
      }
      <p class="text-[0.6875rem] text-gray-400">{{ min }}–{{ max }} {{ unit }}@if (limitLabel) { · {{ limitLabel }} }</p>
      @if (adjusted) {
        <p class="text-[0.6875rem] font-medium text-amber-700" role="status" data-role="number-adjusted">{{ adjusted }}</p>
      }
    </div>
  `,
})
export class CommNumberSettingComponent {
  @Input({ required: true }) label = '';
  @Input() value: number | null = null;
  /** Valor vigente cuando `value` es null (lo que hereda de la plataforma). */
  @Input() inherited = 0;
  @Input() min = 0;
  @Input() max = 0;
  @Input() unit = '';
  @Input() nullable = false;
  @Input() disabled = false;
  /** De dónde sale el máximo cuando lo fija el plan u oficina, p. ej. "your plan's limit". */
  @Input() limitLabel = '';
  @Output() valueChange = new EventEmitter<number | null>();

  adjusted = '';

  toggleDefault(useDefault: boolean): void {
    this.adjusted = '';
    this.valueChange.emit(useDefault ? null : this.inherited);
  }

  onInput(input: HTMLInputElement): void {
    const parsed = Math.round(Number(input.value));
    if (input.value === '' || !Number.isFinite(parsed)) {
      this.adjusted = `Enter a number between ${this.min} and ${this.max}.`;
      return;
    }
    const clamped = Math.min(this.max, Math.max(this.min, parsed));
    // Si el ajustado coincide con el valor anterior el binding no cambia: se corrige lo tecleado aquí.
    input.value = String(clamped);
    this.adjusted =
      clamped === parsed
        ? ''
        : clamped < parsed
          ? `Set to ${clamped}, the most allowed${this.limitLabel ? ` (${this.limitLabel})` : ''}.`
          : `Set to ${clamped}, the least allowed.`;
    this.valueChange.emit(clamped);
  }
}
