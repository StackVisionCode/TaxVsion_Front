import { Injectable, computed, signal } from '@angular/core';
import {
  WorkflowBranch,
  WorkflowDoc,
  WorkflowStep,
  WorkflowStepTypeId,
  descendantIds,
  isBranching,
  stepTypeOrFallback,
} from './workflow.model';

const STORAGE_KEY = 'tvf.workflow.v1';
/** Cuántos estados atrás se pueden deshacer. */
const HISTORY_LIMIT = 50;

/** El flujo de ejemplo del diseño, para que la primera visita no sea un lienzo en blanco. */
function sampleDoc(): WorkflowDoc {
  const trigger: WorkflowStep = {
    id: 'step-trigger',
    typeId: 'form-submitted',
    title: 'New Lead Captured',
    subtitle: 'Form Submitted',
    parentId: null,
    branch: null,
    config: { form: 'Lead Generation Form' },
  };
  const agent: WorkflowStep = {
    id: 'step-agent',
    typeId: 'ai-agent',
    title: 'Lead Qualifier',
    subtitle: 'Score lead potential',
    parentId: trigger.id,
    branch: null,
    config: { model: 'Claude Fable 5', output: 'Lead Score, Intent, Summary' },
  };
  const email: WorkflowStep = {
    id: 'step-email',
    typeId: 'send-email',
    title: 'Send Welcome Email',
    subtitle: 'Introduce product and next steps',
    parentId: agent.id,
    branch: 'yes',
    config: {},
  };
  const sequence: WorkflowStep = {
    id: 'step-sequence',
    typeId: 'create-record',
    title: 'Nurture Sequence',
    subtitle: 'Add lead to nurturing campaign',
    parentId: agent.id,
    branch: 'no',
    config: {},
  };
  const update: WorkflowStep = {
    id: 'step-update',
    typeId: 'update-record',
    title: 'Update Lead Status',
    subtitle: 'Mark contacted and update score',
    parentId: email.id,
    branch: null,
    config: {},
  };
  return {
    id: 'wf-sample',
    name: 'Crossville Workflow',
    steps: [trigger, agent, email, sequence, update],
    updatedAtIso: new Date().toISOString(),
  };
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
  private readonly _doc = signal<WorkflowDoc>(this.loadDoc());
  private readonly _selectedId = signal<string | null>(null);

  /** Instantáneas para deshacer/rehacer (documentos completos: son pequeños). */
  private readonly _past = signal<WorkflowDoc[]>([]);
  private readonly _future = signal<WorkflowDoc[]>([]);

  readonly doc = this._doc.asReadonly();
  readonly steps = computed(() => this._doc().steps);
  readonly name = computed(() => this._doc().name);
  readonly selectedId = this._selectedId.asReadonly();
  readonly selectedStep = computed<WorkflowStep | null>(
    () => this._doc().steps.find(step => step.id === this._selectedId()) ?? null,
  );

  readonly canUndo = computed(() => this._past().length > 0);
  readonly canRedo = computed(() => this._future().length > 0);

  select(stepId: string | null): void {
    this._selectedId.set(stepId);
  }

  rename(name: string): void {
    this.commit(doc => ({ ...doc, name: name.trim() || 'Untitled workflow' }));
  }

  /**
   * Inserta un paso bajo `parentId`. Si el padre ya tenía hijos en esa rama,
   * el nuevo se mete EN MEDIO y adopta a los que había: es lo que espera quien
   * pulsa el `+` de un conector, no crear una segunda rama suelta.
   */
  addStep(typeId: WorkflowStepTypeId, parentId: string | null, branch: WorkflowBranch | null = null): string {
    const type = stepTypeOrFallback(typeId);
    const id = `step-${Math.random().toString(36).slice(2, 10)}`;
    const step: WorkflowStep = {
      id,
      typeId,
      title: type.defaultTitle,
      subtitle: type.defaultSubtitle,
      parentId,
      branch,
      config: {},
    };
    this.commit(doc => {
      const displaced = doc.steps.filter(s => s.parentId === parentId && s.branch === branch);
      const steps = doc.steps.map(s =>
        displaced.some(d => d.id === s.id) ? { ...s, parentId: id, branch: null } : s,
      );
      return { ...doc, steps: [...steps, step] };
    });
    this._selectedId.set(id);
    return id;
  }

  updateStep(stepId: string, patch: Partial<Omit<WorkflowStep, 'id'>>): void {
    this.commit(doc => ({
      ...doc,
      steps: doc.steps.map(step => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }

  /**
   * Borra el paso y su subárbol. No se intenta "coser" los hijos al abuelo:
   * si el paso bifurcaba, no habría forma de decidir qué rama sobrevive, y
   * adivinarlo daría un flujo distinto del que el usuario dibujó.
   */
  removeStep(stepId: string): void {
    const doomed = new Set(descendantIds(this._doc().steps, stepId));
    this.commit(doc => ({ ...doc, steps: doc.steps.filter(step => !doomed.has(step.id)) }));
    if (this._selectedId() && doomed.has(this._selectedId()!)) {
      this._selectedId.set(null);
    }
  }

  /** Copia el paso (sin su subárbol) como hermano en la misma rama. */
  duplicateStep(stepId: string): void {
    const source = this._doc().steps.find(step => step.id === stepId);
    if (!source || source.parentId === null) {
      return;
    }
    const copy: WorkflowStep = {
      ...source,
      id: `step-${Math.random().toString(36).slice(2, 10)}`,
      title: `${source.title} (copy)`,
      config: { ...source.config },
    };
    this.commit(doc => ({ ...doc, steps: [...doc.steps, copy] }));
  }

  /** true = el paso abre ramas Yes/No (lo consulta el canvas). */
  branches(step: WorkflowStep): boolean {
    return isBranching(step);
  }

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

  /** Vuelve al flujo de ejemplo y olvida lo guardado. */
  resetToSample(): void {
    this.commit(() => sampleDoc());
    this._selectedId.set(null);
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
   * Tolera basura: un documento sin raíz, con pasos huérfanos o de un tipo que
   * ya no existe volvería a la muestra en vez de dejar el canvas roto.
   */
  private loadDoc(): WorkflowDoc {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return sampleDoc();
      }
      const parsed = JSON.parse(raw) as WorkflowDoc;
      if (!parsed?.steps?.length || !parsed.steps.some(step => step.parentId === null)) {
        return sampleDoc();
      }
      const ids = new Set(parsed.steps.map(step => step.id));
      const steps = parsed.steps.filter(step => step.parentId === null || ids.has(step.parentId));
      return { ...parsed, steps };
    } catch {
      return sampleDoc();
    }
  }

  /** Punto de integración futuro con backend: PUT del workflow. */
  private saveDoc(doc: WorkflowDoc): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      // Sin almacenamiento disponible el documento vive solo en memoria.
    }
  }
}
