import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PROVISIONING_STEPS, ProvisioningStep } from '../../data-access/onboarding.model';

type StepState = 'done' | 'current' | 'pending';

/**
 * Lista de los pasos de la Saga de provisioning, marcados según el `currentStep`
 * que devuelve `GET onboarding/status`.
 *
 * `Completed` no aparece como fila: es el estado final, no un paso en curso — lo
 * representa la pantalla de éxito completa.
 */
@Component({
  selector: 'app-provisioning-progress',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './provisioning-progress.component.html',
})
export class ProvisioningProgressComponent {
  private readonly _currentStep = signal<ProvisioningStep | null>(null);
  /** true cuando la Saga ya no avanza (fallo o revisión manual): congela el spinner. */
  private readonly _stalled = signal(false);

  @Input() set currentStep(value: ProvisioningStep | null) {
    this._currentStep.set(value);
  }
  @Input() set stalled(value: boolean) {
    this._stalled.set(value);
  }

  readonly isStalled = this._stalled.asReadonly();

  readonly steps = computed(() => {
    const current = this._currentStep();
    const currentIndex = current ? PROVISIONING_STEPS.findIndex(s => s.step === current) : -1;

    return PROVISIONING_STEPS.map((entry, index) => ({
      label: entry.label,
      state: this.stateFor(index, currentIndex),
    }));
  });

  private stateFor(index: number, currentIndex: number): StepState {
    // Sin `currentStep` todavía (recién enviado el formulario): el primero manda.
    if (currentIndex < 0) {
      return index === 0 ? 'current' : 'pending';
    }
    if (index < currentIndex) {
      return 'done';
    }
    return index === currentIndex ? 'current' : 'pending';
  }
}
