import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { MappingCatalog } from '../../data-access/mapping-catalog.model';
import { operationLabel } from '../../utils/form-action-catalog';
import { type ActionCoverage, computeCoverage } from '../../utils/mapping-coverage';
import type { MappingRemoval } from '../../utils/mapping-mutations';

/**
 * Panel de plantilla "Mapping coverage" (P-16.5): por cada acción configurada, ✔ o lo que falta,
 * con links que seleccionan el campo en el builder. Calcula con el engine TS y el catálogo del
 * backend; la validación que manda sigue siendo la del publish.
 */
@Component({
  selector: 'app-mapping-coverage-panel',
  imports: [StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-3" aria-labelledby="mapping-coverage-title">
      <div>
        <h3 id="mapping-coverage-title" class="text-sm font-bold text-gray-900">Mapping coverage</h3>
        <p class="mt-1 text-xs text-gray-500">What each action needs from the form.</p>
      </div>

      @if (loading()) {
        <p class="text-xs text-gray-500" role="status">Loading client properties…</p>
      } @else if (error()) {
        <div class="rounded-2xl border border-red-200 bg-red-50 px-3 py-3" role="alert">
          <p class="text-xs font-semibold text-red-800">{{ error() }}</p>
          <button
            type="button"
            class="mt-2 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100"
            (click)="retry.emit()"
          >
            Try again
          </button>
        </div>
      } @else if (coverage(); as report) {
        @if (report.actions.length === 0) {
          <p class="rounded-2xl bg-gray-50 px-3 py-3 text-xs text-gray-600" data-testid="coverage-empty">
            No actions use client data yet. Set them up in After submission.
          </p>
        }

        @for (action of report.actions; track action.actionKey) {
          <article
            class="rounded-2xl border border-gray-200 bg-white px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-light/40"
            tabindex="-1"
            [attr.data-coverage-action]="action.actionKey"
            [attr.aria-label]="action.label + ' coverage'"
          >
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-xs font-bold text-gray-900">{{ action.label }}</h4>
              <app-status-pill [tone]="tone(action)" [soft]="true" size="xs">{{ stateLabel(action) }}</app-status-pill>
            </div>

            @if (action.state === 'unavailable') {
              <p class="mt-2 text-xs text-gray-600">You don't have permission to configure this action.</p>
            }

            @if (action.missing.length > 0) {
              <ul class="mt-2 space-y-2" [attr.aria-label]="'Missing for ' + action.label">
                @for (missing of action.missing; track missing.targetKey) {
                  <li class="text-xs text-gray-700" data-testid="coverage-missing">
                    <span class="font-semibold">{{ missing.displayName }}</span>
                    @if (missing.kinds.length > 0) {
                      <span class="text-gray-500"> · for {{ missing.kinds.join(', ') }}</span>
                    }
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      @for (candidate of missing.candidates; track candidate.componentId) {
                        <button
                          type="button"
                          class="rounded-full border border-gray-300 px-2.5 py-1 text-xs font-semibold text-brand-bold hover:bg-gray-50"
                          (click)="componentSelected.emit(candidate.componentId)"
                        >
                          Map from “{{ candidate.label }}”
                        </button>
                      } @empty {
                        <span class="text-gray-500">Add a field that can hold it, or set a fixed value.</span>
                      }
                    </div>
                  </li>
                }
              </ul>
            }

            @if (action.fieldProblems.length > 0) {
              <ul class="mt-2 space-y-1">
                @for (problem of action.fieldProblems; track problem.componentId + problem.code) {
                  <li class="text-xs text-gray-700">
                    <button
                      type="button"
                      class="font-semibold text-brand-bold underline-offset-2 hover:underline"
                      (click)="componentSelected.emit(problem.componentId)"
                    >
                      {{ problem.label }}
                    </button>
                    <span>: {{ problem.message }}</span>
                  </li>
                }
              </ul>
            }

            @if (action.configProblems.length > 0) {
              <div class="mt-2 text-xs text-gray-700">
                @for (message of action.configProblems; track message) {
                  <p>{{ message }}</p>
                }
                <button
                  type="button"
                  class="mt-1 font-semibold text-brand-bold underline-offset-2 hover:underline"
                  (click)="actionSelected.emit(action.actionKey)"
                >
                  Open action settings
                </button>
              </div>
            }
          </article>
        }

        @if (report.fieldProblems.length > 0) {
          <div class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3" data-testid="coverage-field-problems">
            <h4 class="text-xs font-bold text-amber-950">Mapping problems</h4>
            <ul class="mt-2 space-y-1.5">
              @for (problem of report.fieldProblems; track problem.componentId + problem.code) {
                <li class="text-xs text-amber-950">
                  @if (problem.exists) {
                    <button
                      type="button"
                      class="font-semibold underline-offset-2 hover:underline"
                      (click)="componentSelected.emit(problem.componentId)"
                    >
                      {{ problem.label }}
                    </button>
                  } @else {
                    <span class="font-semibold">{{ problem.label }}</span>
                  }
                  <span>: {{ problem.message }}</span>
                  <!-- Siempre hay salida: un mapeo inválido se puede quitar aunque el campo ya no encaje. -->
                  @if (problem.removal; as removal) {
                    <button
                      type="button"
                      class="ml-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-semibold hover:bg-amber-100 disabled:opacity-50"
                      [disabled]="disabled()"
                      (click)="mappingRemoved.emit(removal)"
                    >
                      {{ removal.rowComponentId ? 'Remove from rows' : 'Remove mapping' }}
                    </button>
                  }
                </li>
              }
            </ul>
          </div>
        }
      }
    </section>
  `,
})
export class MappingCoveragePanelComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly definition = input.required<FormDefinition>();
  readonly catalog = input<MappingCatalog | null>(null);
  readonly loading = input(false);
  readonly error = input('');
  readonly disabled = input(false);
  /** Acción a enfocar en cuanto se pinta (link "Review mapping coverage"). */
  readonly focusActionKey = input<string | null>(null);

  /** Selecciona el campo en el builder. */
  readonly componentSelected = output<string>();
  /** Quita el mapeo inválido (o la fila de `rowFields`) que causa un problema. */
  readonly mappingRemoved = output<MappingRemoval>();
  /** Abre la configuración de la acción en "After submission". */
  readonly actionSelected = output<string>();
  readonly retry = output<void>();

  private readonly injector = inject(Injector);

  constructor() {
    effect(() => {
      const key = this.focusActionKey();
      if (key && this.ready()) afterNextRender(() => this.focusAction(key), { injector: this.injector });
    });
  }

  protected readonly coverage = computed(() => {
    const catalog = this.catalog();
    return catalog ? computeCoverage(this.definition(), catalog) : null;
  });
  // Booleano aparte: el foco no se repite con cada cambio de la definición.
  private readonly ready = computed(() => this.coverage() !== null);

  /** Lleva el foco a la tarjeta de una acción (link desde "After submission"). */
  focusAction(actionKey: string): void {
    const card = [...this.host.nativeElement.querySelectorAll<HTMLElement>('[data-coverage-action]')].find(
      (element) => element.dataset['coverageAction'] === actionKey,
    );
    card?.scrollIntoView?.({ block: 'nearest' });
    card?.focus();
  }

  protected tone(action: ActionCoverage): StatusTone {
    if (action.state === 'ready') return 'success';
    if (action.state === 'missing') return 'warning';
    return 'muted';
  }

  protected stateLabel(action: ActionCoverage): string {
    if (action.state === 'ready') return `✔ Ready for ${operationLabel(action.operation ?? '')}`;
    if (action.state === 'missing') {
      const count = action.missing.length + action.fieldProblems.length + action.configProblems.length;
      return `${count} to fix`;
    }
    return action.state === 'unavailable' ? 'Not available' : 'No mapping needed';
  }
}
