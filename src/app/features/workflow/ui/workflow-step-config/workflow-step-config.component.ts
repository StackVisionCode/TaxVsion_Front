import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkflowFieldDef, WorkflowStep, stepTypeOrFallback } from '../../data-access/workflow.model';

export interface StepConfigPatch {
  title: string;
  subtitle: string;
  config: Record<string, string | string[]>;
}

/**
 * Panel "Step Configuration".
 *
 * Se pinta a partir del descriptor `fields` del tipo, así que un paso nuevo no
 * necesita un formulario propio: basta declarar sus campos en el catálogo. Los
 * tipos sin descriptor caen al formulario base (título y subtítulo), que es
 * suficiente para que ninguno quede sin poder editarse.
 *
 * Presentacional puro: el guardado lo hace el contenedor.
 */
@Component({
  selector: 'app-workflow-step-config',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-step-config.component.html',
  styleUrl: './workflow-step-config.component.css',
})
export class WorkflowStepConfigComponent {
  @Input() set step(value: WorkflowStep | null) {
    this.current.set(value);
    this.title.set(value?.title ?? '');
    this.subtitle.set(value?.subtitle ?? '');
    // Copia local: el panel es un borrador hasta que se pulsa "Save Step".
    this.draft.set({ ...(value?.config ?? {}) });
    this.newChip.set('');
    this.advancedOpen.set(false);
  }

  @Output() save = new EventEmitter<StepConfigPatch>();

  readonly current = signal<WorkflowStep | null>(null);
  readonly title = signal('');
  readonly subtitle = signal('');
  readonly draft = signal<Record<string, string | string[]>>({});
  readonly newChip = signal('');
  readonly advancedOpen = signal(false);

  get fields(): WorkflowFieldDef[] {
    const step = this.current();
    return step ? (stepTypeOrFallback(step.typeId).fields ?? []) : [];
  }

  get typeLabel(): string {
    const step = this.current();
    return step ? stepTypeOrFallback(step.typeId).label : '';
  }

  textValue(key: string): string {
    const value = this.draft()[key];
    return Array.isArray(value) ? value.join(', ') : (value ?? '');
  }

  chipValues(key: string): string[] {
    const value = this.draft()[key];
    return Array.isArray(value) ? value : [];
  }

  setValue(key: string, value: string): void {
    this.draft.update(draft => ({ ...draft, [key]: value }));
  }

  addChip(key: string): void {
    const chip = this.newChip().trim();
    if (!chip) {
      return;
    }
    this.draft.update(draft => ({ ...draft, [key]: [...this.chipValues(key), chip] }));
    this.newChip.set('');
  }

  removeChip(key: string, chip: string): void {
    this.draft.update(draft => ({ ...draft, [key]: this.chipValues(key).filter(value => value !== chip) }));
  }

  onSave(): void {
    if (!this.current()) {
      return;
    }
    this.save.emit({
      title: this.title().trim() || this.typeLabel,
      subtitle: this.subtitle().trim(),
      config: this.draft(),
    });
  }
}
