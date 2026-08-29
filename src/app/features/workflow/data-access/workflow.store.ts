import { Injectable, computed, signal } from '@angular/core';
import {
  WorkflowConnection,
  WorkflowDataField,
  WorkflowDoc,
  WorkflowStep,
  WorkflowStepTypeId,
  availableFieldsAt,
  connectionError,
  connectionsFrom,
  connectionsTo,
  inDegree,
  missingInputs,
  outDegree,
  stepTypeOrFallback,
} from './workflow.model';

const STORAGE_KEY = 'tvf.workflow.v1';
/** Cuántos estados atrás se pueden deshacer. */
const HISTORY_LIMIT = 50;

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** El flujo de ejemplo del diseño, para que la primera visita no sea un lienzo en blanco. */
function sampleDoc(): WorkflowDoc {
  const steps: WorkflowStep[] = [
    {
      id: 'step-trigger',
      typeId: 'form-submitted',
      title: 'New Lead Captured',
      subtitle: 'Form Submitted',
      config: { form: 'Lead Generation Form' },
    },
    {
      id: 'step-agent',
      typeId: 'ai-agent',
      title: 'Lead Qualifier',
      subtitle: 'Score lead potential',
      config: { model: 'Claude Fable 5' },
    },
    {
      id: 'step-email',
      typeId: 'send-email',
      title: 'Send Welcome Email',
      subtitle: 'Introduce product and next steps',
      config: {},
    },
    {
      id: 'step-sequence',
      typeId: 'create-record',
      title: 'Nurture Sequence',
      subtitle: 'Add lead to nurturing campaign',
      config: {},
    },
    {
      id: 'step-update',
      typeId: 'update-record',
      title: 'Update Lead Status',
      subtitle: 'Mark contacted and update score',
      config: {},
    },
  ];
  // Las dos ramas vuelven a unirse en "Update Lead Status", que es lo que
  // muestra el diseño y lo que el modelo de árbol no podía representar.
  const connections: WorkflowConnection[] = [
    { id: 'c-1', fromStepId: 'step-trigger', fromPort: 'main', toStepId: 'step-agent' },
    { id: 'c-2', fromStepId: 'step-agent', fromPort: 'yes', toStepId: 'step-email' },
    { id: 'c-3', fromStepId: 'step-agent', fromPort: 'no', toStepId: 'step-sequence' },
    { id: 'c-4', fromStepId: 'step-email', fromPort: 'main', toStepId: 'step-update' },
    { id: 'c-5', fromStepId: 'step-sequence', fromPort: 'main', toStepId: 'step-update' },
  ];
  return { id: 'wf-sample', name: 'Crossville Workflow', steps, connections, updatedAtIso: new Date().toISOString() };
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
  connections?: WorkflowConnection[];
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
  private readonly _doc = signal<WorkflowDoc>(this.loadDoc());
  private readonly _selectedId = signal<string | null>(null);
  private readonly _selectedConnectionId = signal<string | null>(null);
  /** Último motivo por el que se rechazó un hilo, para poder explicarlo. */
  private readonly _connectionError = signal<string | null>(null);

  private readonly _past = signal<WorkflowDoc[]>([]);
  private readonly _future = signal<WorkflowDoc[]>([]);

  readonly doc = this._doc.asReadonly();
  readonly steps = computed(() => this._doc().steps);
  readonly connections = computed(() => this._doc().connections);
  readonly name = computed(() => this._doc().name);
  readonly selectedId = this._selectedId.asReadonly();
  readonly selectedConnectionId = this._selectedConnectionId.asReadonly();
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
  }

  selectConnection(connectionId: string | null): void {
    this._selectedConnectionId.set(connectionId);
    this._selectedId.set(null);
  }

  clearConnectionError(): void {
    this._connectionError.set(null);
  }

  rename(name: string): void {
    this.commit(doc => ({ ...doc, name: name.trim() || 'Untitled workflow' }));
  }

  // ---------- Cartas ----------

  /**
   * Añade un paso colgando de `fromStepId`. Si esa salida ya llevaba a otra
   * carta, el paso nuevo se mete EN MEDIO y hereda ese destino: es lo que
   * espera quien pulsa el `+` de un hilo.
   */
  addStep(typeId: WorkflowStepTypeId, fromStepId: string | null, fromPort = 'main'): string {
    const type = stepTypeOrFallback(typeId);
    const id = newId('step');
    const step: WorkflowStep = {
      id,
      typeId,
      title: type.defaultTitle,
      subtitle: type.defaultSubtitle,
      config: {},
    };

    this.commit(doc => {
      const connections = [...doc.connections];
      if (fromStepId) {
        // El hilo que ya salía por ese puerto pasa a salir del paso nuevo.
        const displaced = connections.filter(c => c.fromStepId === fromStepId && c.fromPort === fromPort);
        for (const link of displaced) {
          link.fromStepId = id;
          link.fromPort = 'main';
        }
        connections.push({ id: newId('c'), fromStepId, fromPort, toStepId: id });
      }
      return { ...doc, steps: [...doc.steps, step], connections };
    });
    this.select(id);
    return id;
  }

  /** Igual pero fijando la posición: es lo que usa el arrastre desde el catálogo. */
  addStepAt(typeId: WorkflowStepTypeId, fromStepId: string | null, x: number, y: number): string {
    const type = stepTypeOrFallback(typeId);
    const id = newId('step');
    const step: WorkflowStep = {
      id,
      typeId,
      title: type.defaultTitle,
      subtitle: type.defaultSubtitle,
      config: {},
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
    };
    this.commit(doc => ({
      ...doc,
      steps: [...doc.steps, step],
      // Al soltar en un hueco NO se roba el destino de nadie: solo se engancha.
      connections: fromStepId
        ? [...doc.connections, { id: newId('c'), fromStepId, fromPort: 'main', toStepId: id }]
        : doc.connections,
    }));
    this.select(id);
    return id;
  }

  updateStep(stepId: string, patch: Partial<Omit<WorkflowStep, 'id'>>): void {
    this.commit(doc => ({
      ...doc,
      steps: doc.steps.map(step => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }

  /**
   * Borra la carta y sus hilos.
   *
   * A diferencia del modelo de árbol, ya NO se lleva por delante todo lo que
   * venía detrás: en un grafo esas cartas pueden estar alimentadas por otras.
   * Se cosen padre→hijo cuando la carta tenía una sola entrada y una sola
   * salida, que es el caso en el que la intención es inequívoca.
   */
  removeStep(stepId: string): void {
    this.commit(doc => {
      const incoming = connectionsTo(doc.connections, stepId);
      const outgoing = connectionsFrom(doc.connections, stepId);
      let connections = doc.connections.filter(c => c.fromStepId !== stepId && c.toStepId !== stepId);

      if (incoming.length === 1 && outgoing.length === 1) {
        connections = [
          ...connections,
          {
            id: newId('c'),
            fromStepId: incoming[0].fromStepId,
            fromPort: incoming[0].fromPort,
            toStepId: outgoing[0].toStepId,
          },
        ];
      }
      return { ...doc, steps: doc.steps.filter(step => step.id !== stepId), connections };
    });

    if (this._selectedId() === stepId) {
      this._selectedId.set(null);
    }
  }

  /** Copia la carta (sin sus hilos) al lado de la original. */
  duplicateStep(stepId: string): void {
    const source = this._doc().steps.find(step => step.id === stepId);
    if (!source) {
      return;
    }
    const copy: WorkflowStep = {
      ...source,
      id: newId('step'),
      title: `${source.title} (copy)`,
      config: { ...source.config },
      // Desplazada, o quedaría exactamente encima y parecería que no pasó nada.
      x: typeof source.x === 'number' ? source.x + 40 : undefined,
      y: typeof source.y === 'number' ? source.y + 40 : undefined,
    };
    this.commit(doc => ({ ...doc, steps: [...doc.steps, copy] }));
  }

  // ---------- Hilos ----------

  /**
   * Crea un hilo. Devuelve el motivo si no es válido, o null si se creó: el
   * lienzo lo muestra en vez de dejar que el usuario adivine por qué no pasó
   * nada.
   */
  connect(fromStepId: string, fromPort: string, toStepId: string): string | null {
    const error = connectionError(this._doc().connections, fromStepId, fromPort, toStepId);
    if (error) {
      this._connectionError.set(error);
      return error;
    }
    this._connectionError.set(null);
    this.commit(doc => ({
      ...doc,
      connections: [...doc.connections, { id: newId('c'), fromStepId, fromPort, toStepId }],
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
  private dragOrigin: WorkflowDoc | null = null;

  beginMove(): void {
    this.dragOrigin = this._doc();
  }

  moveStepLive(stepId: string, x: number, y: number): void {
    this._doc.update(doc => ({
      ...doc,
      steps: doc.steps.map(step =>
        step.id === stepId ? { ...step, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } : step,
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
    if (JSON.stringify(origin.steps) === JSON.stringify(current.steps)) {
      return;
    }
    this._past.update(past => [...past, origin].slice(-HISTORY_LIMIT));
    this._future.set([]);
    this._doc.set({ ...current, updatedAtIso: new Date().toISOString() });
    this.saveDoc(this._doc());
  }

  /** Devuelve todas las cartas al layout automático. */
  tidyLayout(): void {
    this.commit(doc => ({
      ...doc,
      steps: doc.steps.map(({ x: _x, y: _y, ...step }) => step),
    }));
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
  private loadDoc(): WorkflowDoc {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return sampleDoc();
      }
      const parsed = JSON.parse(raw) as LegacyDoc;
      if (!parsed?.steps?.length) {
        return sampleDoc();
      }

      const steps: WorkflowStep[] = parsed.steps.map(({ parentId: _p, branch: _b, ...step }) => step);
      const ids = new Set(steps.map(step => step.id));

      const connections: WorkflowConnection[] = parsed.connections
        ? parsed.connections.filter(c => ids.has(c.fromStepId) && ids.has(c.toStepId))
        : parsed.steps
            .filter(step => step.parentId && ids.has(step.parentId))
            .map((step, index) => ({
              id: `c-migrated-${index}`,
              fromStepId: step.parentId as string,
              // La rama del hijo era, en la práctica, el puerto del padre.
              fromPort: step.branch ?? 'main',
              toStepId: step.id,
            }));

      return {
        id: parsed.id ?? 'wf-local',
        name: parsed.name ?? 'Untitled workflow',
        steps,
        connections,
        updatedAtIso: parsed.updatedAtIso ?? new Date().toISOString(),
      };
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
