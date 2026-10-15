import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkflowProcess, WorkflowStep, stepTypeOrFallback } from '../../data-access/workflow.model';

/**
 * Panel de un PROCESO (no de un paso): su nombre, sus acciones en orden y borrarlo.
 * Presentacional puro; el contenedor decide qué hace cada evento con el store.
 */
@Component({
  selector: 'app-workflow-process-panel',
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-process-panel.component.html',
})
export class WorkflowProcessPanelComponent {
  readonly process = input.required<WorkflowProcess>();
  readonly steps = input<readonly WorkflowStep[]>([]);
  readonly selectedStepId = input<string | null>(null);

  readonly rename = output<string>();
  readonly selectStep = output<string>();
  readonly move = output<{ id: string; delta: -1 | 1 }>();
  readonly addAction = output<void>();
  readonly deleteProcess = output<void>();

  protected readonly draft = signal<string | null>(null);
  protected readonly name = computed(() => this.draft() ?? this.process().name);

  protected typeOf(step: WorkflowStep) {
    return stepTypeOrFallback(step.typeId);
  }

  protected commit(): void {
    const value = this.draft();
    this.draft.set(null);
    if (value !== null && value.trim() && value.trim() !== this.process().name) {
      this.rename.emit(value.trim());
    }
  }
}
