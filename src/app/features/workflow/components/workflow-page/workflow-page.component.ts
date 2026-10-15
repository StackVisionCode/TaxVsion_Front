import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { WorkflowCanvasComponent, InsertRequest } from '../../ui/workflow-canvas/workflow-canvas.component';
import { WorkflowProcessPanelComponent } from '../../ui/workflow-process-panel/workflow-process-panel.component';
import { WorkflowStepPaletteComponent } from '../../ui/workflow-step-palette/workflow-step-palette.component';
import { WorkflowCollaboratorAvatarsComponent } from '../../ui/workflow-collaborator-avatars/workflow-collaborator-avatars.component';
import { WorkflowShareModalComponent } from '../workflow-share-modal/workflow-share-modal.component';
import {
  StepConfigPatch,
  WorkflowStepConfigComponent,
} from '../../ui/workflow-step-config/workflow-step-config.component';
import { WorkflowStore } from '../../data-access/workflow.store';
import { WorkflowPreviewService } from '../../data-access/workflow-preview.service';
import { WorkflowPresenceService } from '../../data-access/workflow-presence.service';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkflowAnnotationPropertiesComponent } from '../../ui/workflow-annotation-properties/workflow-annotation-properties.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ImageTooLargeError, prepareImage } from '../../utils/workflow-image.util';
import { WorkflowPreviewHudComponent } from '../../ui/workflow-preview-hud/workflow-preview-hud.component';
import { WorkflowStepTypeId, missingInputs } from '../../data-access/workflow.model';
import { layoutProcesses } from '../../utils/workflow-process-layout.util';
import { dependentsOf, stepsOfProcess } from '../../utils/workflow-process.util';

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
    WorkflowAnnotationPropertiesComponent,
    WorkflowStepConfigComponent,
    WorkflowProcessPanelComponent,
    WorkflowCollaboratorAvatarsComponent,
    WorkflowShareModalComponent,
    WorkflowPreviewHudComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-page.component.html',
  styleUrl: './workflow-page.component.css',
})
export class WorkflowPageComponent implements OnDestroy {
  readonly store = inject(WorkflowStore);
  readonly preview = inject(WorkflowPreviewService);
  readonly presence = inject(WorkflowPresenceService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** La paleta de pasos está plegada: el aside se estrecha y el lienzo se ensancha. */
  readonly paletteCollapsed = signal(false);

  /** Objeto del lienzo seleccionado: manda sobre el panel de configuración del paso. */
  readonly selectedAnnotationId = signal<string | null>(null);
  readonly selectedAnnotation = computed(() => {
    const id = this.selectedAnnotationId();
    return id ? (this.store.annotations().find(a => a.id === id) ?? null) : null;
  });

  /**
   * Lo recién creado queda seleccionado. Sin esto colocabas una nota y el panel seguía
   * enseñando las propiedades del objeto anterior, así que había que volver a hacer clic
   * sobre lo que acabas de poner para poder ajustarlo.
   */
  onAnnotationCreated(id: string | null): void {
    if (id) {
      this.selectedAnnotationId.set(id);
    }
  }

  /** Borrar deja el panel sin objeto: si no, quedaría abierto sobre algo que ya no existe. */
  onRemoveAnnotation(id: string): void {
    this.store.removeAnnotation(id);
    this.selectedAnnotationId.set(null);
  }

  @ViewChild('imageInput') private imageInput?: ElementRef<HTMLInputElement>;
  /** Dónde cae la imagen que se está eligiendo, fijado al abrir el selector. */
  private imageDropPoint = { x: 0, y: 0 };

  ngOnDestroy(): void {
    this.presence.leave();
  }

  backToList(): void {
    void this.router.navigate(['/workflow']);
  }

  /** Abre el selector de archivo. El punto se guarda ahora: al volver ya no se sabe. */
  onPickImage(point: { x: number; y: number }): void {
    this.imageDropPoint = point;
    this.imageInput?.nativeElement.click();
  }

  async onImageChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia siempre: si no, elegir el MISMO archivo dos veces no dispara `change`.
    input.value = '';
    if (!file) {
      return;
    }
    try {
      const image = await prepareImage(file);
      this.store.addImage(
        image.src,
        this.imageDropPoint.x - image.width / 2,
        this.imageDropPoint.y - image.height / 2,
        image.width,
        image.height,
        file.name,
      );
    } catch (error) {
      this.toast.error(
        error instanceof ImageTooLargeError
          ? error.message
          : "That file couldn't be read as an image.",
      );
    }
  }

  constructor() {
    // El workflow que se abre lo dice la URL. Si el id no existe (enlace viejo, borrado
    // desde otra pestaña) se vuelve a la tabla en vez de dejar un lienzo en blanco que
    // parecería un workflow vacío.
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.store.open(id)) {
      void this.router.navigate(['/workflow']);
      return;
    }

    // Cursores en vivo de quien esté en el mismo documento.
    this.presence.join(this.store.doc().id);

    /**
     * Editar durante la simulación la ABORTA (no se bloquea la edición, que
     * exigiría tocar cada punto de interacción). Cualquier mutación del doc —
     * incluidos undo/redo y el primer frame de un drag — invalida los ids del
     * plan, así que se limpia el overlay en vez de dejar uno que miente.
     * Seleccionar no muta el doc: inspeccionar durante la corrida funciona.
     */
    effect(() => {
      this.store.doc();
      if (untracked(() => this.preview.status()) === 'running') {
        this.preview.reset();
      }
    });
  }

  startPreview(): void {
    this.activeTab.set('builder');
    this.preview.start(this.store.steps(), this.store.connections());
  }

  readonly activeTab = signal<WorkflowTab>('builder');
  readonly isDeployOpen = signal(false);
  readonly isShareOpen = signal(false);
  readonly pendingDeleteId = signal<string | null>(null);
  readonly editingName = signal(false);

  /**
   * Punto de inserción elegido con un `+` del canvas. Mientras esté puesto, el
   * siguiente paso que se elija en la paleta entra ahí; si no hay ninguno, el
   * paso se añade al final de la rama principal.
   */
  readonly pendingInsert = signal<InsertRequest | null>(null);

  /**
   * Lo que le falta a cada paso, calculado UNA vez por cambio de estructura. Arrastrar un proceso
   * solo cambia su posición (ni `steps` ni `connections`), así que no vuelve a recorrer el grafo.
   */
  private readonly missingByStep = computed(() => {
    const steps = this.store.steps();
    const connections = this.store.connections();
    return new Map(steps.map(step => [step.id, missingInputs(steps, connections, step.id)]));
  });

  /** El layout es derivado: mismos procesos, mismo dibujo. */
  readonly layout = computed(() =>
    layoutProcesses({
      processes: this.store.processes(),
      steps: this.store.steps(),
      connections: this.store.connections(),
      missing: this.missingByStep(),
      selectedStepId: this.store.selectedId(),
      selectedProcessId: this.store.selectedProcessId(),
    }),
  );

  readonly pendingDeleteProcessId = signal<string | null>(null);

  readonly selectedProcessSteps = computed(() => {
    const id = this.store.selectedProcessId();
    return id ? stepsOfProcess(this.store.steps(), id) : [];
  });

  /** "Step 2 of 4 · Intake" del paso seleccionado. */
  readonly selectedPosition = computed(() => {
    const step = this.store.selectedStep();
    if (!step?.processId) {
      return null;
    }
    const own = stepsOfProcess(this.store.steps(), step.processId);
    const process = this.store.processes().find(candidate => candidate.id === step.processId);
    return { index: own.findIndex(candidate => candidate.id === step.id), total: own.length, processName: process?.name ?? '' };
  });

  readonly selectedDependents = computed(() => {
    const id = this.store.selectedId();
    return id ? dependentsOf(this.store.steps(), this.store.connections(), id) : [];
  });

  readonly savedLabel = computed(() => {
    const iso = this.store.doc().updatedAtIso;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  setTab(tab: WorkflowTab): void {
    this.activeTab.set(tab);
  }

  onInsertRequested(request: InsertRequest): void {
    this.store.selectProcess(request.processId);
    this.pendingInsert.set(request);
  }

  /**
   * Añade el paso donde marque el `+` / "Add action" pulsado. Sin punto elegido va al proceso
   * activo (el seleccionado, el de la carta seleccionada o el último); un trigger que no cabe ahí
   * abre un proceso nuevo. Si una regla lo impide se explica en vez de no hacer nada.
   */
  onAddStep(typeId: WorkflowStepTypeId): void {
    const pending = this.pendingInsert();
    const result = this.store.addStep(typeId, pending ? { processId: pending.processId, index: pending.index } : undefined);
    this.pendingInsert.set(null);
    if (result.error) {
      this.showLinkError(result.error);
    }
  }

  /** "Add action" del panel de proceso: deja el punto de inserción al final de ese proceso. */
  onAddActionFor(processId: string): void {
    this.pendingInsert.set({ processId, index: null });
  }

  addProcess(): void {
    this.store.addProcess();
    this.pendingInsert.set(null);
  }

  onSelectProcess(processId: string): void {
    this.store.selectProcess(processId);
    this.selectedAnnotationId.set(null);
  }

  onClearSelection(): void {
    this.store.select(null);
    this.pendingInsert.set(null);
  }

  /**
   * Suelta un paso del catálogo en el lienzo: sobre un proceso entra en él (al final); en un hueco
   * nace un proceso nuevo ahí mismo.
   */
  onDropStep(event: { typeId: string; x: number; y: number }): void {
    const typeId = event.typeId as WorkflowStepTypeId;
    const over = this.layout().boxes.find(
      box => event.x >= box.x && event.x <= box.x + box.width && event.y >= box.y && event.y <= box.y + box.height,
    );
    const processId = over?.process.id ?? this.store.addProcess({ x: event.x - 190, y: event.y - 27 });
    const result = this.store.addStep(typeId, { processId });
    if (result.error) {
      this.showLinkError(result.error);
    }
  }

  /** Enlaza una salida con otro proceso; si no vale, el store devuelve el motivo y se muestra. */
  onConnectExit(event: { stepId: string; port: string; processId: string }): void {
    const error = this.store.connectExit(event.stepId, event.port, event.processId);
    if (error) {
      this.showLinkError(error);
    }
  }

  readonly linkError = signal<string | null>(null);
  private linkErrorTimer: ReturnType<typeof setTimeout> | null = null;

  private showLinkError(message: string): void {
    this.linkError.set(message);
    if (this.linkErrorTimer) {
      clearTimeout(this.linkErrorTimer);
    }
    this.linkErrorTimer = setTimeout(() => this.linkError.set(null), 3600);
  }

  onDuplicateStep(stepId: string): void {
    const result = this.store.duplicateStep(stepId);
    if (result.error) {
      this.showLinkError(result.error);
    }
  }

  onMoveStep(stepId: string, delta: -1 | 1): void {
    const error = this.store.moveStep(stepId, delta);
    if (error) {
      this.showLinkError(error);
    }
  }

  onMoveSelected(delta: -1 | 1): void {
    const id = this.store.selectedId();
    if (id) {
      this.onMoveStep(id, delta);
    }
  }

  onDuplicateSelected(): void {
    const id = this.store.selectedId();
    if (id) {
      this.onDuplicateStep(id);
    }
  }

  requestDeleteSelected(): void {
    const id = this.store.selectedId();
    if (id) {
      this.requestDelete(id);
    }
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

  confirmDeleteProcess(): void {
    const id = this.pendingDeleteProcessId();
    if (id) {
      this.store.removeProcess(id);
    }
    this.pendingDeleteProcessId.set(null);
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
