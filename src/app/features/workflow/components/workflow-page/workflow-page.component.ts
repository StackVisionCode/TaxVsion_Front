import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { WorkflowCanvasComponent, InsertRequest } from '../../ui/workflow-canvas/workflow-canvas.component';
import { WorkflowStepPaletteComponent } from '../../ui/workflow-step-palette/workflow-step-palette.component';
import {
  StepConfigPatch,
  WorkflowStepConfigComponent,
} from '../../ui/workflow-step-config/workflow-step-config.component';
import { WorkflowStore } from '../../data-access/workflow.store';
import { WorkflowStepTypeId } from '../../data-access/workflow.model';
import { layoutWorkflow } from '../../utils/workflow-layout.util';

type WorkflowTab = 'builder' | 'debugger';

/**
 * Página del constructor de workflows.
 *
 * ⚠️ **No existe backend de workflows.** El documento se guarda en el
 * navegador y nada se ejecuta: no hay motor, ni scheduler, ni integración de
 * IA en el backend (verificado sobre los 25 microservicios y las 31 rutas del
 * Gateway). La UI lo dice con la píldora "Local draft" y con el modal de
 * Deploy, en vez de aparentar un producto que corre.
 *
 * Los controles marcados con `data-decorative="true"` están para completar el
 * diseño y no hacen nada; son greppables el día que haya servicio.
 */
@Component({
  selector: 'app-workflow-page',
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ConfirmDialogComponent,
    WorkflowCanvasComponent,
    WorkflowStepPaletteComponent,
    WorkflowStepConfigComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-page.component.html',
  styleUrl: './workflow-page.component.css',
})
export class WorkflowPageComponent {
  readonly store = inject(WorkflowStore);

  readonly activeTab = signal<WorkflowTab>('builder');
  readonly isDeployOpen = signal(false);
  readonly pendingDeleteId = signal<string | null>(null);
  readonly editingName = signal(false);

  /**
   * Punto de inserción elegido con un `+` del canvas. Mientras esté puesto, el
   * siguiente paso que se elija en la paleta entra ahí; si no hay ninguno, el
   * paso se añade al final de la rama principal.
   */
  readonly pendingInsert = signal<InsertRequest | null>(null);

  /** El layout es derivado: misma lista de pasos, mismo dibujo. */
  readonly layout = computed(() => layoutWorkflow(this.store.steps()));

  readonly savedLabel = computed(() => {
    const iso = this.store.doc().updatedAtIso;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  setTab(tab: WorkflowTab): void {
    this.activeTab.set(tab);
  }

  onInsertRequested(request: InsertRequest): void {
    this.pendingInsert.set(request);
  }

  /**
   * Añade el paso donde marque el `+` pulsado. Sin punto elegido, cuelga de la
   * última hoja de la rama principal, que es lo que espera quien simplemente
   * va apilando pasos desde el catálogo.
   */
  onAddStep(typeId: WorkflowStepTypeId): void {
    const pending = this.pendingInsert();
    if (pending) {
      this.store.addStep(typeId, pending.parentId, pending.branch);
      this.pendingInsert.set(null);
      return;
    }
    const steps = this.store.steps();
    if (steps.length === 0) {
      this.store.addStep(typeId, null, null);
      return;
    }
    const leaf = steps.find(step => !steps.some(other => other.parentId === step.id)) ?? steps[steps.length - 1];
    this.store.addStep(typeId, leaf.id, null);
  }

  requestDelete(stepId: string): void {
    this.pendingDeleteId.set(stepId);
  }

  confirmDelete(): void {
    const id = this.pendingDeleteId();
    if (id) {
      this.store.removeStep(id);
    }
    this.pendingDeleteId.set(null);
  }

  onSaveStep(patch: StepConfigPatch): void {
    const selected = this.store.selectedId();
    if (selected) {
      this.store.updateStep(selected, patch);
    }
  }

  onRename(name: string): void {
    this.store.rename(name);
    this.editingName.set(false);
  }
}
