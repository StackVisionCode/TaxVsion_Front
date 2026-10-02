import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  forwardRef,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type SwitchSize = 'md' | 'sm';

/**
 * Interruptor on/off único de la app (reemplaza los ~20 hechos a mano, cada uno con su tamaño,
 * color y animación). Es un `<button role="switch">`: Space/Enter nativos, anillo de foco y
 * etiquetable (dentro de un `<label>` el clic en la fila lo activa una sola vez).
 *
 * Uso: `<app-switch [checked]="x()" (checkedChange)="x.set($event)" />` — o con `ngModel`.
 *
 * Respuesta inmediata: el knob se mueve al hacer clic sin esperar al padre. Si el padre guarda
 * contra el servidor, que pase `[busy]`: cuando `busy` vuelve a false y `checked` no cambió
 * (falló el guardado), el knob regresa a la posición real.
 */
@Component({
  selector: 'app-switch',
  templateUrl: './switch.component.html',
  styleUrl: './switch.component.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SwitchComponent), multi: true }],
  host: { class: 'inline-flex shrink-0 align-middle' },
})
export class SwitchComponent implements OnChanges, ControlValueAccessor {
  @Input() checked = false;
  @Input() disabled = false;
  /** Guardando contra el servidor: el knob pulsa y no acepta más clics. */
  @Input() busy = false;
  @Input() size: SwitchSize = 'md';
  @Input() ariaLabel: string | null = null;
  @Output() checkedChange = new EventEmitter<boolean>();

  /** Lo que se pinta: adelanta el clic y se resincroniza con `checked`. */
  readonly displayed = signal(false);
  private formDisabled = false;
  private onChange: (value: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  get isDisabled(): boolean {
    return this.disabled || this.formDisabled;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['checked']) {
      this.displayed.set(this.checked);
    }
    // Terminó el guardado sin que el padre cambiara `checked` → volver a la posición real.
    const busy = changes['busy'];
    if (busy && busy.previousValue && !busy.currentValue) {
      this.displayed.set(this.checked);
    }
  }

  toggle(): void {
    if (this.isDisabled || this.busy) {
      return;
    }
    const next = !this.displayed();
    this.displayed.set(next);
    this.checkedChange.emit(next);
    this.onChange(next);
    this.onTouched();
  }

  // ---------- ControlValueAccessor ----------

  writeValue(value: boolean | null): void {
    this.checked = !!value;
    this.displayed.set(this.checked);
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled = isDisabled;
  }
}
