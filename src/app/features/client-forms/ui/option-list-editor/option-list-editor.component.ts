import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output, signal } from '@angular/core';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { ComponentOption } from '../../utils/mapping-compatibility';
import { nextOptionValue, optionUsage, type OptionUsage } from '../../utils/option-values';

const MAX_OPTIONS = 50;

/**
 * Editor de opciones de select, radio y grupo de casillas. Cada opción conserva su `value` al
 * renombrarla o moverla; una nueva recibe un valor que no choca. Borrar una opción usada por el
 * mapeo o por condiciones pide confirmación (y limpia el optionMap si hay permiso).
 */
@Component({
  selector: 'app-option-list-editor',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="min-w-0">
      <legend class="text-xs font-semibold text-gray-600">Options</legend>
      <ol class="mt-1 space-y-1.5" [attr.aria-label]="'Options of ' + fieldLabel()">
        @for (option of options(); track option.value; let index = $index; let first = $first; let last = $last) {
          <li class="flex items-center gap-1">
            <input
              type="text"
              class="min-h-9 min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-light focus:ring-2 focus:ring-brand-light/30"
              maxlength="200"
              [value]="option.label"
              [attr.aria-label]="'Option ' + (index + 1) + ' label'"
              (input)="rename(option.value, $any($event.target).value)"
            />
            <button
              type="button"
              class="icon-btn"
              [attr.aria-label]="'Move option ' + (index + 1) + ' up'"
              [disabled]="first"
              (click)="move(index, -1)"
            >
              <ion-icon name="chevron-up-outline"></ion-icon>
            </button>
            <button
              type="button"
              class="icon-btn"
              [attr.aria-label]="'Move option ' + (index + 1) + ' down'"
              [disabled]="last"
              (click)="move(index, 1)"
            >
              <ion-icon name="chevron-down-outline"></ion-icon>
            </button>
            <button
              type="button"
              class="icon-btn hover:!text-red-600"
              [attr.aria-label]="'Remove option ' + (index + 1)"
              [disabled]="options().length <= 1"
              (click)="requestRemove(option.value)"
            >
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </li>
        }
      </ol>

      @if (pending(); as removal) {
        <div class="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert" data-testid="option-removal">
          <p>{{ removalMessage(removal.label, removal.usage) }}</p>
          <div class="mt-2 flex gap-2">
            @if (!blocked(removal.usage)) {
              <button
                type="button"
                class="rounded-full bg-amber-900 px-3 py-1 font-semibold text-white hover:bg-amber-950"
                (click)="confirmRemove()"
              >
                Remove option
              </button>
            }
            <button
              type="button"
              class="rounded-full border border-amber-300 bg-white px-3 py-1 font-semibold hover:bg-amber-100"
              (click)="pending.set(null)"
            >
              {{ blocked(removal.usage) ? 'OK' : 'Keep it' }}
            </button>
          </div>
        </div>
      }

      <button
        type="button"
        class="mt-2 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        [disabled]="options().length >= maxOptions"
        (click)="add()"
      >
        Add option
      </button>
    </fieldset>
  `,
  styles: [
    `
      .icon-btn {
        display: inline-flex;
        height: 2rem;
        width: 2rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        color: #6b7280;
      }
      .icon-btn:hover:not(:disabled) {
        background: #f3f4f6;
      }
      .icon-btn:disabled {
        opacity: 0.3;
      }
    `,
  ],
})
export class OptionListEditorComponent {
  readonly options = input.required<readonly ComponentOption[]>();
  readonly componentId = input.required<string>();
  readonly fieldLabel = input('this field');
  /** Para detectar usos del valor (mapeo y condiciones). */
  readonly definition = input<FormDefinition | null>(null);
  /** Sin `configure_actions` no se puede limpiar el optionMap: borrar una opción mapeada queda bloqueado. */
  readonly canEditMapping = input(false);

  readonly optionsChange = output<ComponentOption[]>();
  /** Valor quitado que estaba en el optionMap: el padre lo limpia del mapeo. */
  readonly optionMapCleared = output<string>();

  protected readonly maxOptions = MAX_OPTIONS;
  protected readonly pending = signal<{ value: string; label: string; usage: OptionUsage } | null>(null);
  private readonly values = computed(() => this.options().map((option) => option.value));

  protected rename(value: string, label: string): void {
    this.optionsChange.emit(this.options().map((option) => (option.value === value ? { ...option, label } : option)));
  }

  protected move(index: number, delta: number): void {
    const next = [...this.options()];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    this.optionsChange.emit(next);
  }

  protected add(): void {
    const options = this.options();
    if (options.length >= MAX_OPTIONS) return;
    this.optionsChange.emit([...options, { value: nextOptionValue(options), label: `Option ${options.length + 1}` }]);
  }

  protected requestRemove(value: string): void {
    const option = this.options().find((item) => item.value === value);
    if (!option) return;
    const usage = optionUsage(this.definition(), this.componentId(), value);
    if (!usage.mapped && usage.conditions.length === 0) {
      this.remove(value, false);
      return;
    }
    this.pending.set({ value, label: option.label || value, usage });
  }

  protected confirmRemove(): void {
    const removal = this.pending();
    this.pending.set(null);
    if (removal && this.values().includes(removal.value)) this.remove(removal.value, removal.usage.mapped);
  }

  protected blocked(usage: OptionUsage): boolean {
    return usage.mapped && !this.canEditMapping();
  }

  protected removalMessage(label: string, usage: OptionUsage): string {
    if (this.blocked(usage))
      return `“${label}” is used by the data mapping. Ask someone with Configure actions to update the mapping first.`;
    const parts: string[] = [];
    if (usage.mapped) parts.push('the data mapping (it will be cleared there)');
    if (usage.conditions.length > 0)
      parts.push(
        `${usage.conditions.length === 1 ? 'a condition' : usage.conditions.length + ' conditions'} on ${usage.conditions.join(', ')}, which you will need to update`,
      );
    return `“${label}” is used by ${parts.join(' and ')}.`;
  }

  private remove(value: string, mapped: boolean): void {
    this.optionsChange.emit(this.options().filter((option) => option.value !== value));
    if (mapped) this.optionMapCleared.emit(value);
  }
}
