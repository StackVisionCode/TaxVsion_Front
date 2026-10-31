import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';

/**
 * Interruptor de un ajuste que puede heredar la plataforma (null). Muestra el valor vigente; si la oficina
 * lo fijó, ofrece volver al default.
 */
@Component({
  selector: 'app-comm-inherit-switch',
  imports: [SwitchComponent],
  template: `
    <div class="flex flex-col items-start gap-1 sm:items-end">
      <app-switch [checked]="value ?? inherited" [disabled]="disabled" [ariaLabel]="label"
        (checkedChange)="valueChange.emit($event)"></app-switch>
      @if (value === null) {
        <span class="text-[0.6875rem] text-gray-400" data-role="inherit-default">{{ defaultLabel }}</span>
      } @else if (!disabled) {
        <button type="button" class="text-[0.6875rem] font-semibold text-brand-bold hover:underline"
          (click)="valueChange.emit(null)" data-role="reset-default">{{ resetLabel || 'Use default (' + (inherited ? 'on' : 'off') + ')' }}</button>
      }
    </div>
  `,
})
export class CommInheritSwitchComponent {
  @Input({ required: true }) label = '';
  @Input() value: boolean | null = null;
  @Input() inherited = false;
  @Input() disabled = false;
  /** Texto cuando hereda (p. ej. "Office default"). */
  @Input() defaultLabel = 'Default';
  /** Texto del botón para volver a heredar cuando el valor heredado no se conoce (preferencias personales). */
  @Input() resetLabel = '';
  @Output() valueChange = new EventEmitter<boolean | null>();
}
