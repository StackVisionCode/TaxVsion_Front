import { Injectable, computed, inject, signal } from '@angular/core';
import { WorkflowLibraryService, newWorkflowId } from './workflow-library.service';
import {
  PROCESS_ACCENT_COUNT,
  firstStepOf,
  isTriggerStep,
  lastStepOf,
  migrateToProcesses,
  nextProcessName,
  stepsOfProcess,
  syncProcessLinks,
} from '../utils/workflow-process.util';
import { COLLAPSED_WIDTH, PROCESS_WIDTH, autoPlaceProcesses } from '../utils/workflow-process-layout.util';
import {
  WorkflowAnnotation,
  WorkflowCollaborator,
  WorkflowCollaboratorRole,
  WorkflowConnection,
  WorkflowDataField,
  WorkflowAnnotationKind,
  WorkflowDoc,
  WorkflowInkSize,
  WorkflowNoteColor,
  WorkflowProcess,
  WorkflowStep,
  WorkflowStepTypeId,
  availableFieldsAt,
  connectionError,
  connectionsFrom,
  connectionsTo,
  inDegree,
  isBranching,
  missingInputs,
  outputsOf,
  outDegree,
  stepTypeOrFallback,
} from './workflow.model';

/** Cuántos estados atrás se pueden deshacer. */
const HISTORY_LIMIT = 50;

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Resultado de añadir/duplicar un paso: el id nuevo, o el motivo por el que no se pudo. */
export type StepResult = { id: string; error: null } | { id: null; error: string };

function fail(error: string): StepResult {
  return { id: null, error };
}

/**
 * El flujo de ejemplo, para que la primera visita no sea un lienzo en blanco: un proceso de
 * entrada que bifurca (Yes / No) hacia dos procesos más.
 */
function sampleDoc(): WorkflowDoc {
  const steps: WorkflowStep[] = [
    {
      id: 'step-trigger',
      processId: 'proc-intake',
      typeId: 'form-submitted',
      title: 'New Lead Captured',
      subtitle: 'Form Submitted',
      config: { form: 'Lead Generation Form' },
    },
    {
      id: 'step-agent',
      processId: 'proc-intake',
      typeId: 'ai-agent',
      title: 'Lead Qualifier',
      subtitle: 'Score lead potential',
      config: { model: 'Claude Fable 5' },
    },
    {
      id: 'step-email',
      processId: 'proc-follow-up',
      typeId: 'send-email',
      title: 'Send Welcome Email',
      subtitle: 'Introduce product and next steps',
      config: {},
    },
    {
      id: 'step-update',
      processId: 'proc-follow-up',
      typeId: 'update-record',
      title: 'Update Lead Status',
      subtitle: 'Mark contacted and update score',
      config: {},
    },
    {
      id: 'step-sequence',
      processId: 'proc-nurture',
      typeId: 'create-record',
      title: 'Nurture Sequence',
      subtitle: 'Add lead to nurturing campaign',
      config: {},
    },
  ];
  const processes: WorkflowProcess[] = [
    { id: 'proc-intake', name: 'Intake', x: 0, y: 0, colorIndex: 0 },
    { id: 'proc-follow-up', name: 'Follow-up', x: 0, y: 0, colorIndex: 1 },
    { id: 'proc-nurture', name: 'Nurture', x: 0, y: 0, colorIndex: 2 },
  ];
  const connections = syncProcessLinks(steps, [
    { id: 'c-yes', fromStepId: 'step-agent', fromPort: 'yes', toStepId: 'step-email' },
    { id: 'c-no', fromStepId: 'step-agent', fromPort: 'no', toStepId: 'step-sequence' },
  ]);
  return {
    id: 'wf-sample',
    name: 'Crossville Workflow',
    steps,
    processes: autoPlaceProcesses(processes, steps, connections),
    connections,
    annotations: [],
    collaborators: [],
    updatedAtIso: new Date().toISOString(),
  };
}

/**
 * Forma del documento ANTES de que los hilos fueran una entidad: la estructura
 * vivía dentro de cada paso. Se declara entero (y no como intersección con el
 * tipo actual) para que TypeScript no pierda los campos que ya no existen.
 */
interface LegacyStep extends WorkflowStep {
  parentId?: string | null;
  branch?: 'yes' | 'no' | null;
}

interface LegacyDoc {
  id?: string;
  name?: string;
  steps?: LegacyStep[];
  processes?: WorkflowProcess[];
  connections?: WorkflowConnection[];
  annotations?: WorkflowAnnotation[];
  collaborators?: WorkflowCollaborator[];
  updatedAtIso?: string;
}

/**
 * Estado del constructor de workflows.
 *
 * Feature-scoped: se provee en `workflow.routes.ts`.
 *
 * **Persistencia:** hoy `localStorage`, porque no existe backend de workflows.
 * Toda la E/S está encerrada en `loadDoc()` / `saveDoc()`; cuando exista el
 * servicio se reemplazan esos dos métodos por llamadas HTTP y ni la UI ni el
 * resto del store cambian. Mismo patrón que `DashboardLayoutStore`.
 */
@Injectable()
export class WorkflowStore {
  private readonly library = inject(WorkflowLibraryService);

  /**
   * Documento abierto. Arranca vacío: la ruta llama a `open(id)` con el workflow que se
   * eligió en la tabla, o a `openNew()`. Antes se cargaba UNO fijo aquí mismo, que es lo
   * que hacía que solo pudiera existir un workflow en todo el navegador.
   */
  private readonly _doc = signal<WorkflowDoc>(emptyDoc());
  private readonly _selectedId = signal<string | null>(null);
  private readonly _selectedProcessId = signal<string | null>(null);
  private readonly _selectedConnectionId = signal<string | null>(null);
  /** Último motivo por el que se rechazó un hilo, para poder explicarlo. */
  private readonly _connectionError = signal<string | null>(null);

  private readonly _past = signal<WorkflowDoc[]>([]);
  private readonly _future = signal<WorkflowDoc[]>([]);

  readonly doc = this._doc.asReadonly();
  readonly steps = computed(() => this._doc().steps);
  readonly processes = computed(() => this._doc().processes);
  readonly connections = computed(() => this._doc().connections);
  readonly collaborators = computed(() => this._doc().collaborators);
  readonly annotations = computed(() => this._doc().annotations);

  /** Último fallo al persistir (cuota llena). `null` = todo se está guardando. */
  private readonly _saveError = signal<string | null>(null);
  readonly saveError = this._saveError.asReadonly();
  readonly name = computed(() => this._doc().name);
  readonly selectedId = this._selectedId.asReadonly();
  readonly selectedConnectionId = this._selectedConnectionId.asReadonly();
  readonly selectedProcessId = this._selectedProcessId.asReadonly();
  readonly selectedProcess = computed<WorkflowProcess | null>(
    () => this._doc().processes.find(process => process.id === this._selectedProcessId()) ?? null,
  );
  readonly connectionError = this._connectionError.asReadonly();
  readonly selectedStep = computed<WorkflowStep | null>(
    () => this._doc().steps.find(step => step.id === this._selectedId()) ?? null,
  );

  readonly canUndo = computed(() => this._past().length > 0);
  readonly canRedo = computed(() => this._future().length > 0);

  /** Datos disponibles para la carta seleccionada, y los que le faltan. */
  readonly selectedAvailableFields = computed<WorkflowDataField[]>(() => {
    const id = this._selectedId();
    return id ? availableFieldsAt(this.steps(), this.connections(), id) : [];
  });
  readonly selectedMissingInputs = computed<WorkflowDataField[]>(() => {
    const id = this._selectedId();
    return id ? missingInputs(this.steps(), this.connections(), id) : [];
  });

  // ---------- Selección ----------

  select(stepId: string | null): void {
    this._selectedId.set(stepId);
    this._selectedConnectionId.set(null);
    this._selectedProcessId.set(null);
  }

  selectProcess(processId: string | null): void {
    this._selectedProcessId.set(processId);
    this._selectedId.set(null);
    this._selectedConnectionId.set(null);
  }

  selectConnection(connectionId: string | null): void {
    this._selectedConnectionId.set(connectionId);
    this._selectedId.set(null);
    this._selectedProcessId.set(null);
  }

  /** Proceso donde cae lo siguiente que se añada: el seleccionado, el de la carta, o el último. */
  activeProcessId(): string | null {
    const doc = this._doc();
    const selectedProcess = this._selectedProcessId();
    if (selectedProcess && doc.processes.some(process => process.id === selectedProcess)) {
      return selectedProcess;
    }
    const step = doc.steps.find(candidate => candidate.id === this._selectedId());
    if (step?.processId) {
      return step.processId;
    }
    return doc.processes.length > 0 ? doc.processes[doc.processes.length - 1].id : null;
  }

  clearConnectionError(): void {
    this._connectionError.set(null);
  }

  rename(name: string): void {
    this.commit(doc => ({ ...doc, name: name.trim() || 'Untitled workflow' }));
  }

  // ---------- Personas ----------

  /** Añade a alguien al workflow; un duplicado por userId se ignora. */
  addCollaborator(collaborator: WorkflowCollaborator): void {
    if (this._doc().collaborators.some(c => c.userId === collaborator.userId)) {
      return;
    }
    this.commit(doc => ({ ...doc, collaborators: [...doc.collaborators, collaborator] }));
  }

  /**
   * Quita a una persona. Devuelve el motivo si no se puede (mismo patrón que
   * `connect()`): el último Owner no se quita — un workflow sin dueño no
   * tendría a nadie que pudiera volver a administrarlo.
   */
  removeCollaborator(userId: string): string | null {
    const collaborators = this._doc().collaborators;
    const target = collaborators.find(c => c.userId === userId);
    if (!target) {
      return null;
    }
    if (target.role === 'owner' && collaborators.filter(c => c.role === 'owner').length === 1) {
      return 'A workflow needs at least one owner';
    }
    this.commit(doc => ({ ...doc, collaborators: doc.collaborators.filter(c => c.userId !== userId) }));
    return null;
  }

  /** Cambia el rol; degradar al último Owner se rechaza con motivo. */
  setCollaboratorRole(userId: string, role: WorkflowCollaboratorRole): string | null {
    const collaborators = this._doc().collaborators;
    const target = collaborators.find(c => c.userId === userId);
    if (!target || target.role === role) {
      return null;
    }
    if (
      target.role === 'owner' &&
      role !== 'owner' &&
      collaborators.filter(c => c.role === 'owner').length === 1
    ) {
      return 'A workflow needs at least one owner';
    }
    this.commit(doc => ({
      ...doc,
      collaborators: doc.collaborators.map(c => (c.userId === userId ? { ...c, role } : c)),
    }));
    return null;
  }

  // ---------- Procesos ----------

  /** Hueco a la derecha de lo que ya hay: un proceso nuevo no debe nacer encima de otro. */
  private nextProcessPosition(doc: WorkflowDoc): { x: number; y: number } {
    if (doc.processes.length === 0) {
      return { x: 56, y: 100 };
    }
    const right = Math.max(
      ...doc.processes.map(process => process.x + (process.collapsed ? COLLAPSED_WIDTH : PROCESS_WIDTH)),
    );
    const top = Math.min(...doc.processes.map(process => process.y));
    return { x: right + 120, y: top };
  }

  private makeProcess(doc: WorkflowDoc, at?: { x: number; y: number }): WorkflowProcess {
    const position = at ?? this.nextProcessPosition(doc);
    return {
      id: newId('proc'),
      name: nextProcessName(doc.processes),
      x: Math.max(0, Math.round(position.x)),
      y: Math.max(0, Math.round(position.y)),
      colorIndex: doc.processes.length % PROCESS_ACCENT_COUNT,
    };
  }

  /** Proceso vacío, con su "Add action". Queda seleccionado. */
  addProcess(at?: { x: number; y: number }): string {
    const process = this.makeProcess(this._doc(), at);
    this.commit(doc => ({ ...doc, processes: [...doc.processes, process] }));
    this.selectProcess(process.id);
    return process.id;
  }

  renameProcess(processId: string, name: string): void {
    const clean = name.trim();
    if (!clean) {
      return;
    }
    this.commit(doc => ({
      ...doc,
      processes: doc.processes.map(process => (process.id === processId ? { ...process, name: clean } : process)),
    }));
  }

  toggleProcessCollapsed(processId: string): void {
    this.commit(doc => ({
      ...doc,
      processes: doc.processes.map(process =>
        process.id === processId ? { ...process, collapsed: !process.collapsed } : process,
      ),
    }));
  }

  /** Copia el proceso con sus pasos (sin las salidas hacia otros procesos), un poco desplazada. */
  duplicateProcess(processId: string): string | null {
    const source = this._doc().processes.find(process => process.id === processId);
    if (!source) {
      return null;
    }
    const id = newId('proc');
    this.commit(doc => {
      const copies = stepsOfProcess(doc.steps, processId).map(step => ({
        ...step,
        id: newId('step'),
        processId: id,
        config: { ...step.config },
      }));
      const copy: WorkflowProcess = {
        ...source,
        id,
        name: `${source.name} (copy)`,
        x: source.x + 40,
        y: source.y + 40,
        colorIndex: doc.processes.length % PROCESS_ACCENT_COUNT,
      };
      const steps = [...doc.steps, ...copies];
      return {
        ...doc,
        processes: [...doc.processes, copy],
        steps,
        connections: syncProcessLinks(steps, doc.connections),
      };
    });
    this.selectProcess(id);
    return id;
  }

  /** Borra el proceso y todo lo que contiene, con los hilos que lo tocaban. */
  removeProcess(processId: string): void {
    this.commit(doc => {
      const gone = new Set(stepsOfProcess(doc.steps, processId).map(step => step.id));
      const steps = doc.steps.filter(step => !gone.has(step.id));
      return {
        ...doc,
        processes: doc.processes.filter(process => process.id !== processId),
        steps,
        connections: syncProcessLinks(
          steps,
          doc.connections.filter(link => !gone.has(link.fromStepId) && !gone.has(link.toStepId)),
        ),
      };
    });
    if (this._selectedProcessId() === processId) {
      this._selectedProcessId.set(null);
    }
    const selected = this._selectedId();
    if (selected && !this._doc().steps.some(step => step.id === selected)) {
      this._selectedId.set(null);
    }
  }

  /** ¿Algún otro proceso desemboca en este? Si sí, no puede empezar con un trigger. */
  private isFed(doc: WorkflowDoc, processId: string): boolean {
    const first = firstStepOf(doc.steps, processId);
    return !!first && doc.connections.some(link => link.toStepId === first.id && this.crosses(doc, link));
  }

  private crosses(doc: WorkflowDoc, link: WorkflowConnection): boolean {
    const from = doc.steps.find(step => step.id === link.fromStepId);
    const to = doc.steps.find(step => step.id === link.toStepId);
    return !!from && !!to && from.processId !== to.processId;
  }

  // ---------- Pasos ----------

  /**
   * Añade un paso a un proceso. Sin destino explícito va al proceso activo (el seleccionado, el
   * de la carta seleccionada, o el último); si no hay ninguno, se crea uno.
   *
   * Reglas del proceso, que se aplican aquí y no en la UI:
   * - Un trigger solo puede ser el PRIMER paso de un proceso que nadie alimenta. Si se elige un
   *   trigger sin destino y no cabe en el proceso activo, nace en uno nuevo.
   * - Un paso que bifurca (Condition, Router, AI Agent) va SIEMPRE el último: sus Yes / No son
   *   las salidas del proceso. Uno nuevo que bifurca se coloca al final; uno normal que se
   *   quiere añadir "al final" de un proceso que ya acaba en bifurcación entra justo antes.
   */
  addStep(
    typeId: WorkflowStepTypeId,
    target?: { processId?: string | null; index?: number | null } | null,
  ): StepResult {
    const type = stepTypeOrFallback(typeId);
    const isTrigger = type.category === 'trigger';
    const explicit = target?.processId ?? null;
    let doc = this._doc();
    let processId = explicit ?? this.activeProcessId();
    let createdProcess: WorkflowProcess | null = null;

    const fits = (id: string): boolean => {
      const own = stepsOfProcess(doc.steps, id);
      return !isTrigger || (own.length === 0 && !this.isFed(doc, id));
    };
    if (!processId || !doc.processes.some(process => process.id === processId) || (!explicit && !fits(processId))) {
      createdProcess = this.makeProcess(doc);
      processId = createdProcess.id;
      doc = { ...doc, processes: [...doc.processes, createdProcess] };
    }

    const own = stepsOfProcess(doc.steps, processId);
    const last = own.length > 0 ? own[own.length - 1] : null;
    const lastBranches = !!last && isBranching(last);
    let index = Math.min(Math.max(target?.index ?? own.length, 0), own.length);

    if (isTrigger) {
      if (index !== 0 || own.length > 0 || this.isFed(doc, processId)) {
        return fail(
          own.some(isTriggerStep)
            ? 'This process already has a trigger'
            : 'A trigger can only be the first step of a process that no other process feeds',
        );
      }
    } else if (index === 0 && own.length > 0 && isTriggerStep(own[0])) {
      index = 1;
    }
    if (type.branching) {
      if (lastBranches) {
        return fail('This process already ends with a branch');
      }
      index = own.length;
    } else if (lastBranches && index >= own.length) {
      index = own.length - 1;
    }

    const id = newId('step');
    const step: WorkflowStep = {
      id,
      processId,
      typeId,
      title: type.defaultTitle,
      subtitle: type.defaultSubtitle,
      config: {},
    };
    const steps = [...doc.steps];
    const before = own[index];
    if (before) {
      steps.splice(steps.indexOf(before), 0, step);
    } else if (last) {
      steps.splice(steps.indexOf(last) + 1, 0, step);
    } else {
      steps.push(step);
    }
    this.commit(current => ({
      ...current,
      processes: createdProcess ? [...current.processes, createdProcess] : current.processes,
      steps,
      connections: syncProcessLinks(steps, current.connections),
    }));
    this.select(id);
    return { id, error: null };
  }

  updateStep(stepId: string, patch: Partial<Omit<WorkflowStep, 'id'>>): void {
    this.commit(doc => ({
      ...doc,
      steps: doc.steps.map(step => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }

  /**
   * Borra el paso. Lo que lo rodeaba se recose: los pasos vecinos se vuelven a enlazar, la salida
   * 'main' hacia otro proceso pasa al nuevo último paso, y un hilo que entraba por el primer
   * paso entra ahora por el siguiente.
   */
  removeStep(stepId: string): void {
    this.commit(doc => {
      const step = doc.steps.find(candidate => candidate.id === stepId);
      if (!step?.processId) {
        return { ...doc, steps: doc.steps.filter(candidate => candidate.id !== stepId) };
      }
      const own = stepsOfProcess(doc.steps, step.processId);
      const index = own.findIndex(candidate => candidate.id === stepId);
      let connections = doc.connections;
      if (own.length > 1) {
        const replacement =
          index === own.length - 1 && !isBranching(step)
            ? { from: own[index - 1].id, to: null }
            : index === 0
              ? { from: null, to: own[1].id }
              : null;
        if (replacement) {
          connections = connections.map(link => {
            if (!this.crosses(doc, link)) {
              return link;
            }
            if (replacement.from && link.fromStepId === stepId && link.fromPort === 'main') {
              return { ...link, fromStepId: replacement.from };
            }
            if (replacement.to && link.toStepId === stepId) {
              return { ...link, toStepId: replacement.to };
            }
            return link;
          });
        }
      }
      const steps = doc.steps.filter(candidate => candidate.id !== stepId);
      return {
        ...doc,
        steps,
        connections: syncProcessLinks(
          steps,
          connections.filter(link => link.fromStepId !== stepId && link.toStepId !== stepId),
        ),
      };
    });

    if (this._selectedId() === stepId) {
      this._selectedId.set(null);
    }
  }

  /** Copia el paso justo detrás del original. Un trigger o un paso que bifurca no se duplican. */
  duplicateStep(stepId: string): StepResult {
    const source = this._doc().steps.find(step => step.id === stepId);
    if (!source?.processId) {
      return fail('That step no longer exists');
    }
    if (isTriggerStep(source)) {
      return fail('A process has only one trigger');
    }
    if (isBranching(source)) {
      return fail('A process can only end with one branch');
    }
    const id = newId('step');
    const copy: WorkflowStep = {
      ...source,
      id,
      title: `${source.title} (copy)`,
      config: { ...source.config },
    };
    this.commit(doc => {
      const steps = [...doc.steps];
      steps.splice(steps.findIndex(step => step.id === stepId) + 1, 0, copy);
      return { ...doc, steps, connections: syncProcessLinks(steps, doc.connections) };
    });
    this.select(id);
    return { id, error: null };
  }

  /**
   * Cambia el orden dentro del proceso. Devuelve el motivo si rompe una regla (el trigger va
   * primero, el paso que bifurca va último) o null si se movió.
   */
  reorderStep(stepId: string, toIndex: number): string | null {
    const doc = this._doc();
    const step = doc.steps.find(candidate => candidate.id === stepId);
    if (!step?.processId) {
      return null;
    }
    const own = stepsOfProcess(doc.steps, step.processId);
    const from = own.indexOf(step);
    const to = Math.min(Math.max(toIndex, 0), own.length - 1);
    if (from === to) {
      return null;
    }
    const next = [...own];
    next.splice(from, 1);
    next.splice(to, 0, step);
    if (next.some((candidate, index) => isTriggerStep(candidate) && index !== 0)) {
      return 'A trigger has to stay first in its process';
    }
    if (next.some((candidate, index) => isBranching(candidate) && index !== next.length - 1)) {
      return 'A step that branches has to stay last in its process';
    }
    this.commit(current => {
      const queue = [...next];
      const steps = current.steps.map(candidate =>
        candidate.processId === step.processId ? queue.shift()! : candidate,
      );
      return { ...current, steps, connections: syncProcessLinks(steps, current.connections) };
    });
    return null;
  }

  /** Atajo para subir / bajar un puesto. */
  moveStep(stepId: string, delta: -1 | 1): string | null {
    const step = this._doc().steps.find(candidate => candidate.id === stepId);
    if (!step?.processId) {
      return null;
    }
    const own = stepsOfProcess(this._doc().steps, step.processId);
    return this.reorderStep(stepId, own.indexOf(step) + delta);
  }

  // ---------- Salidas entre procesos ----------

  /**
   * Conecta una salida del proceso con el PRIMER paso de otro. Cada salida lleva a un solo sitio,
   * así que una conexión anterior se reemplaza. Devuelve el motivo si no es válida.
   */
  connectExit(fromStepId: string, fromPort: string, toProcessId: string): string | null {
    const doc = this._doc();
    const from = doc.steps.find(step => step.id === fromStepId);
    if (!from?.processId) {
      return 'That step no longer exists';
    }
    if (lastStepOf(doc.steps, from.processId)?.id !== from.id) {
      return 'Only the last step of a process can lead to another process';
    }
    if (!outputsOf(from).some(port => port.id === fromPort)) {
      return 'That exit does not exist';
    }
    if (toProcessId === from.processId) {
      return "A process can't lead to itself";
    }
    const target = firstStepOf(doc.steps, toProcessId);
    if (!target) {
      return 'That process has no steps yet';
    }
    if (isTriggerStep(target)) {
      return 'A process that starts with a trigger cannot be fed by another one';
    }
    const kept = doc.connections.filter(
      link => !(link.fromStepId === fromStepId && link.fromPort === fromPort && this.crosses(doc, link)),
    );
    const error = connectionError(kept, fromStepId, fromPort, target.id);
    if (error) {
      this._connectionError.set(error);
      return error;
    }
    this._connectionError.set(null);
    this.commit(current => ({
      ...current,
      connections: [...kept, { id: newId('c'), fromStepId, fromPort, toStepId: target.id }],
    }));
    return null;
  }

  disconnect(connectionId: string): void {
    this.commit(doc => ({ ...doc, connections: doc.connections.filter(c => c.id !== connectionId) }));
    if (this._selectedConnectionId() === connectionId) {
      this._selectedConnectionId.set(null);
    }
  }

  inDegreeOf(stepId: string): number {
    return inDegree(this.connections(), stepId);
  }

  outDegreeOf(stepId: string): number {
    return outDegree(this.connections(), stepId);
  }

  missingInputsOf(stepId: string): WorkflowDataField[] {
    return missingInputs(this.steps(), this.connections(), stepId);
  }

  // ---------- Arrastre ----------

  /**
   * Arrastre de una carta, en tres tiempos: se aplica en vivo para que los
   * hilos la sigan, pero solo apila UN estado al soltar. Si cada
   * `pointermove` guardara historial, un solo arrastre dejaría cientos de
   * pasos y "deshacer" sería inservible.
   */
  // ---------- Notas e imágenes del lienzo ----------

  /** Nota nueva bajo el cursor. Nace en edición: nadie pega una nota para dejarla vacía. */
  addNote(x: number, y: number, color: WorkflowNoteColor = 'yellow'): string {
    const id = newId('note');
    this.commit(doc => ({
      ...doc,
      annotations: [
        ...doc.annotations,
        {
          id,
          kind: 'note',
          // Acotado a positivo, igual que el arrastre: el stage empieza en 0,0 y lo que
          // caiga en negativo se dibuja fuera y aparece recortado.
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          width: 220,
          height: 180,
          text: '',
          color,
          opacity: 1,
        },
      ],
    }));
    return id;
  }

  /** La imagen llega ya reescalada (ver `prepareImage`): aquí solo se coloca. */
  addImage(src: string, x: number, y: number, width: number, height: number, alt = ''): string {
    const id = newId('img');
    // Se acota el tamaño de dibujo para que una captura grande no tape el diagrama.
    const scale = Math.min(1, 360 / Math.max(width, height));
    this.commit(doc => ({
      ...doc,
      annotations: [
        ...doc.annotations,
        {
          id,
          kind: 'image',
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          src,
          alt,
          opacity: 1,
        },
      ],
    }));
    return id;
  }

  /**
   * Trazo a mano. Llega con los puntos ya en coordenadas del lienzo; aquí se calcula su
   * caja y se pasan a RELATIVOS, que es lo que hace que moverlo sea solo cambiar x/y.
   */
  addDrawing(points: readonly number[], stroke: string, size: WorkflowInkSize): string | null {
    if (points.length < 4) {
      // Un solo punto no es un trazo: un clic suelto con el lápiz no debe dejar basura.
      return null;
    }
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const id = newId('draw');
    this.commit(doc => ({
      ...doc,
      annotations: [
        ...doc.annotations,
        {
          id,
          kind: 'draw',
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.round(Math.max(...xs) - minX),
          height: Math.round(Math.max(...ys) - minY),
          points: points.map((value, i) => Math.round(value - (i % 2 === 0 ? minX : minY))),
          stroke,
          size,
          opacity: 1,
        },
      ],
    }));
    return id;
  }

  /** Flecha: `x`/`y` es el origen y `width`/`height` el desplazamiento hasta la punta. */
  addArrow(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    stroke: string,
    size: WorkflowInkSize,
  ): string | null {
    if (Math.hypot(toX - fromX, toY - fromY) < 12) {
      return null;
    }
    const id = newId('arrow');
    this.commit(doc => ({
      ...doc,
      annotations: [
        ...doc.annotations,
        {
          id,
          kind: 'arrow',
          x: Math.round(fromX),
          y: Math.round(fromY),
          width: Math.round(toX - fromX),
          height: Math.round(toY - fromY),
          stroke,
          size,
          opacity: 1,
        },
      ],
    }));
    return id;
  }

  addText(x: number, y: number, stroke: string, size: WorkflowInkSize): string {
    const id = newId('text');
    this.commit(doc => ({
      ...doc,
      annotations: [
        ...doc.annotations,
        {
          id,
          kind: 'text',
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
          width: 260,
          height: 60,
          text: '',
          stroke,
          size,
          opacity: 1,
          textStyle: 'sans',
        },
      ],
    }));
    return id;
  }

  /** Marco rectangular para agrupar visualmente parte del diagrama. */
  addRect(
    x: number,
    y: number,
    width: number,
    height: number,
    stroke: string,
    size: WorkflowInkSize,
  ): string | null {
    if (Math.abs(width) < 12 || Math.abs(height) < 12) {
      return null;
    }
    const id = newId('rect');
    this.commit(doc => ({
      ...doc,
      annotations: [
        ...doc.annotations,
        {
          id,
          kind: 'rect',
          x: Math.max(0, Math.round(Math.min(x, x + width))),
          y: Math.max(0, Math.round(Math.min(y, y + height))),
          width: Math.round(Math.abs(width)),
          height: Math.round(Math.abs(height)),
          stroke,
          size,
          opacity: 1,
        },
      ],
    }));
    return id;
  }

  updateAnnotation(id: string, patch: Partial<WorkflowAnnotation>): void {
    this.commit(doc => ({
      ...doc,
      annotations: doc.annotations.map(a => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  removeAnnotation(id: string): void {
    this.commit(doc => ({ ...doc, annotations: doc.annotations.filter(a => a.id !== id) }));
  }

  /** Arrastre en vivo, sin apilar historial (lo cierra `endMove`, igual que los pasos). */
  moveAnnotationLive(id: string, x: number, y: number): void {
    this._doc.update(doc => ({
      ...doc,
      annotations: doc.annotations.map(a =>
        a.id === id ? { ...a, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } : a,
      ),
    }));
  }

  private dragOrigin: WorkflowDoc | null = null;

  beginMove(): void {
    this.dragOrigin = this._doc();
  }

  /** Arrastre en vivo de un proceso por su cabecera, sin apilar historial (lo cierra `endMove`). */
  moveProcessLive(processId: string, x: number, y: number): void {
    this._doc.update(doc => ({
      ...doc,
      processes: doc.processes.map(process =>
        process.id === processId ? { ...process, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } : process,
      ),
    }));
  }

  endMove(): void {
    const origin = this.dragOrigin;
    this.dragOrigin = null;
    if (!origin) {
      return;
    }
    const current = this._doc();
    // Se comparan pasos Y anotaciones: `endMove` cierra el arrastre de ambos, y mirando
    // solo `steps` un movimiento de nota se quedaba fuera del historial y sin guardar.
    if (
      JSON.stringify(origin.processes) === JSON.stringify(current.processes) &&
      JSON.stringify(origin.annotations) === JSON.stringify(current.annotations)
    ) {
      return;
    }
    this._past.update(past => [...past, origin].slice(-HISTORY_LIMIT));
    this._future.set([]);
    this._doc.set({ ...current, updatedAtIso: new Date().toISOString() });
    this.saveDoc(this._doc());
  }

  /** Devuelve los procesos al orden automático, de izquierda a derecha según sus conexiones. */
  tidyLayout(): void {
    this.commit(doc => ({ ...doc, processes: autoPlaceProcesses(doc.processes, doc.steps, doc.connections) }));
  }

  // ---------- Historial ----------

  undo(): void {
    const past = this._past();
    if (past.length === 0) {
      return;
    }
    const previous = past[past.length - 1];
    this._past.set(past.slice(0, -1));
    this._future.update(future => [this._doc(), ...future]);
    this._doc.set(previous);
    this.saveDoc(previous);
  }

  redo(): void {
    const future = this._future();
    if (future.length === 0) {
      return;
    }
    const next = future[0];
    this._future.set(future.slice(1));
    this._past.update(past => [...past, this._doc()]);
    this._doc.set(next);
    this.saveDoc(next);
  }

  resetToSample(): void {
    this.commit(() => sampleDoc());
    this.select(null);
  }

  /** Punto único de mutación: apila el estado anterior, sella la fecha y persiste. */
  private commit(mutate: (doc: WorkflowDoc) => WorkflowDoc): void {
    const current = this._doc();
    const next = { ...mutate(current), updatedAtIso: new Date().toISOString() };
    this._past.update(past => [...past, current].slice(-HISTORY_LIMIT));
    this._future.set([]);
    this._doc.set(next);
    this.saveDoc(next);
  }

  /**
   * Punto de integración futuro con backend: GET del workflow.
   *
   * Migra el formato anterior, en el que los hilos no existían y la estructura
   * vivía en `parentId`/`branch` dentro de cada paso. Sin esto, todo el que ya
   * tuviera un workflow guardado lo perdería.
   */
  /**
   * Abre un workflow de la biblioteca. Si el id no existe (enlace viejo, documento
   * borrado en otra pestaña) devuelve false y la pantalla manda de vuelta a la tabla, en
   * vez de dejar un lienzo en blanco que parece un workflow vacío.
   */
  open(id: string): boolean {
    const stored = this.library.read(id);
    if (!stored) {
      return false;
    }
    this.resetHistory();
    this._doc.set(normalizeDoc(stored));
    return true;
  }

  /**
   * Crea uno nuevo con el flujo de ejemplo y lo deja abierto. Devuelve su id.
   *
   * El nombre NO se hereda del ejemplo: si no, cada workflow nuevo nacía llamado
   * "Crossville Workflow" y la tabla se llenaba de filas idénticas imposibles de
   * distinguir. Se numera a partir de los que ya hay.
   */
  openNew(): string {
    const doc = {
      ...sampleDoc(),
      id: newWorkflowId(),
      name: this.nextUntitledName(),
      updatedAtIso: new Date().toISOString(),
    };
    this.resetHistory();
    this._doc.set(doc);
    this.saveDoc(doc);
    return doc.id;
  }

  /** "Untitled workflow", y si ya existe, el siguiente número libre. */
  private nextUntitledName(): string {
    const taken = new Set(this.library.items().map(item => item.name));
    const base = 'Untitled workflow';
    if (!taken.has(base)) {
      return base;
    }
    let n = 2;
    while (taken.has(`${base} ${n}`)) {
      n++;
    }
    return `${base} ${n}`;
  }

  private resetHistory(): void {
    this._past.set([]);
    this._future.set([]);
    this._selectedId.set(null);
    this._selectedProcessId.set(null);
    this._selectedConnectionId.set(null);
    this._connectionError.set(null);
  }

  private saveDoc(doc: WorkflowDoc): void {
    try {
      this.library.write(doc);
      this._saveError.set(null);
    } catch {
      this._saveError.set(
        'This browser ran out of room for the draft. Remove an image to keep saving changes.',
      );
    }
  }
}

/** Documento en blanco: lo que hay antes de abrir uno de la biblioteca. */
function emptyDoc(): WorkflowDoc {
  return {
    id: '',
    name: '',
    steps: [],
    processes: [],
    connections: [],
    annotations: [],
    collaborators: [],
    updatedAtIso: new Date().toISOString(),
  };
}

/**
 * Pone al día un documento guardado.
 *
 * Migra el formato anterior, en el que los hilos no existían y la estructura vivía en
 * `parentId`/`branch` dentro de cada paso, y rellena los campos que se añadieron después
 * (anotaciones, colaboradores). Sin esto, quien ya tuviera un workflow guardado lo
 * perdería al abrirlo.
 */
function normalizeDoc(parsed: LegacyDoc): WorkflowDoc {
  const steps: WorkflowStep[] = (parsed.steps ?? []).map(({ parentId: _p, branch: _b, ...step }) => step);
  const ids = new Set(steps.map(step => step.id));

  const connections: WorkflowConnection[] = parsed.connections
    ? parsed.connections.filter(c => ids.has(c.fromStepId) && ids.has(c.toStepId))
    : (parsed.steps ?? [])
        .filter(step => step.parentId && ids.has(step.parentId))
        .map((step, index) => ({
          id: `c-migrated-${index}`,
          fromStepId: step.parentId as string,
          // La rama del hijo era, en la práctica, el puerto del padre.
          fromPort: step.branch ?? 'main',
          toStepId: step.id,
        }));

  // Procesos: los documentos nuevos ya los traen; los anteriores eran un grafo libre y se
  // segmentan en cadenas (ver `migrateToProcesses`).
  const hasProcesses =
    !!parsed.processes && steps.every(step => !!step.processId && parsed.processes!.some(p => p.id === step.processId));
  let processes: WorkflowProcess[];
  let finalSteps: WorkflowStep[];
  let finalConnections: WorkflowConnection[];
  if (hasProcesses) {
    processes = parsed.processes!;
    finalSteps = steps;
    finalConnections = syncProcessLinks(steps, connections);
  } else {
    const migrated = migrateToProcesses(steps, connections);
    finalSteps = migrated.steps;
    finalConnections = migrated.connections;
    processes = autoPlaceProcesses(migrated.processes, migrated.steps, migrated.connections);
  }

  return {
    id: parsed.id ?? newWorkflowId(),
    name: parsed.name ?? 'Untitled workflow',
    steps: finalSteps,
    processes,
    connections: finalConnections,
    annotations: parsed.annotations ?? [],
    collaborators: parsed.collaborators ?? [],
    updatedAtIso: parsed.updatedAtIso ?? new Date().toISOString(),
  };
}
