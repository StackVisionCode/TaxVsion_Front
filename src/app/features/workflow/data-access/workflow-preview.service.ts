import { Injectable, computed, signal } from '@angular/core';
import { WorkflowConnection, WorkflowStep } from './workflow.model';
import {
  SimulationPlan,
  formatDuration,
  planSimulation,
} from '../utils/workflow-simulation.util';

export type PreviewStatus = 'idle' | 'running' | 'stopped' | 'finished';
export type PreviewStepStatus = 'pending' | 'running' | 'done' | 'skipped';
export type PreviewEdgeStatus = 'idle' | 'active' | 'traversed' | 'skipped';

/** Lo que la carta necesita saber para pintarse durante la corrida. */
export interface PreviewStepView {
  status: PreviewStepStatus;
  warning: boolean;
  /** "2 s" / "2 h" — visible al terminar la carta. */
  durationLabel: string;
  chosenPort: string | null;
}

/**
 * Motor de la simulación del Preview.
 *
 * Efímero a propósito: tiene sus propios signals y **jamás** toca el
 * `WorkflowStore` (ni documento, ni historial, ni localStorage). Ni siquiera
 * lo inyecta — `start()` recibe el snapshot del grafo como argumentos.
 *
 * La app es **zoneless**: todo lo que escriben los callbacks de los timers va
 * por signals, o no habría change detection. Y los Maps se REEMPLAZAN
 * (`new Map(prev)`), nunca se mutan: mutar el mismo objeto no notifica.
 */
@Injectable()
export class WorkflowPreviewService {
  private readonly _status = signal<PreviewStatus>('idle');
  private readonly _stepStates = signal<ReadonlyMap<string, PreviewStepView>>(new Map());
  private readonly _edgeStates = signal<ReadonlyMap<string, PreviewEdgeStatus>>(new Map());
  private readonly _elapsedRealMs = signal(0);
  private readonly _totalRealMs = signal(0);
  private readonly _doneCount = signal(0);
  private readonly _runCount = signal(0);

  readonly status = this._status.asReadonly();
  readonly stepStates = this._stepStates.asReadonly();
  readonly edgeStates = this._edgeStates.asReadonly();
  readonly elapsedRealMs = this._elapsedRealMs.asReadonly();
  readonly totalRealMs = this._totalRealMs.asReadonly();
  readonly doneCount = this._doneCount.asReadonly();
  readonly runCount = this._runCount.asReadonly();

  readonly elapsedLabel = computed(() => formatDuration(this._elapsedRealMs()));
  readonly totalLabel = computed(() => formatDuration(this._totalRealMs()));

  /**
   * Un callback de una corrida abortada no puede escribir estado: cada corrida
   * lleva su token, y el callback comprueba que siga vigente.
   */
  private runToken = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Snapshot de los hilos de la corrida: el plan no guarda sus extremos. */
  private connectionsSnapshot: WorkflowConnection[] = [];
  private traversedIds = new Set<string>();

  start(steps: WorkflowStep[], connections: WorkflowConnection[]): void {
    this.reset();
    const plan = planSimulation(steps, connections, Math.random);
    if (plan.entries.length === 0) {
      return;
    }

    this.connectionsSnapshot = connections;
    this.traversedIds = new Set(plan.traversedConnectionIds);
    const token = ++this.runToken;
    this._runCount.set(plan.entries.length);
    this._totalRealMs.set(plan.totalRealMs);
    this._status.set('running');
    this.seedStates(plan);

    // Con "reducir movimiento" no hay teatro: el resultado, al instante.
    const reduceMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.finishInstantly(plan);
      return;
    }

    this.runEntry(plan, 0, token);
  }

  /** Stop del usuario: congela lo pintado para poder inspeccionarlo. */
  stop(): void {
    this.cancelTimer();
    this.runToken++;
    if (this._status() === 'running') {
      this._status.set('stopped');
    }
  }

  /** Limpieza total (la usa el aborto por edición): el overlay desaparece. */
  reset(): void {
    this.cancelTimer();
    this.runToken++;
    this._status.set('idle');
    this._stepStates.set(new Map());
    this._edgeStates.set(new Map());
    this._elapsedRealMs.set(0);
    this._totalRealMs.set(0);
    this._doneCount.set(0);
    this._runCount.set(0);
  }

  // ---------- Internos ----------

  /** Estado inicial: todo pendiente, y lo inalcanzable ya marcado. */
  private seedStates(plan: SimulationPlan): void {
    const steps = new Map<string, PreviewStepView>();
    for (const entry of plan.entries) {
      steps.set(entry.stepId, {
        status: 'pending',
        warning: entry.missingLabels.length > 0,
        durationLabel: formatDuration(entry.realMs),
        chosenPort: entry.chosenPort,
      });
    }
    for (const id of plan.skippedStepIds) {
      steps.set(id, { status: 'skipped', warning: false, durationLabel: '', chosenPort: null });
    }
    this._stepStates.set(steps);

    const edges = new Map<string, PreviewEdgeStatus>();
    for (const id of plan.skippedConnectionIds) {
      edges.set(id, 'skipped');
    }
    this._edgeStates.set(edges);
  }

  private runEntry(plan: SimulationPlan, index: number, token: number): void {
    if (token !== this.runToken) {
      return;
    }
    if (index >= plan.entries.length) {
      this._status.set('finished');
      return;
    }

    const entry = plan.entries[index];
    this.patchStep(entry.stepId, { status: 'running' });
    // Los hilos que ENTRAN a la carta en curso se marcan activos (fluyendo).
    this.markIncoming(entry.stepId, 'active');

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (token !== this.runToken) {
        return;
      }
      this.patchStep(entry.stepId, { status: 'done' });
      this.markIncoming(entry.stepId, 'traversed');
      this._doneCount.update(count => count + 1);
      this._elapsedRealMs.update(elapsed => elapsed + entry.realMs);
      this.runEntry(plan, index + 1, token);
    }, entry.animMs);
  }

  private finishInstantly(plan: SimulationPlan): void {
    const steps = new Map(this._stepStates());
    for (const entry of plan.entries) {
      const view = steps.get(entry.stepId);
      if (view) {
        steps.set(entry.stepId, { ...view, status: 'done' });
      }
    }
    this._stepStates.set(steps);

    const edges = new Map(this._edgeStates());
    for (const id of plan.traversedConnectionIds) {
      edges.set(id, 'traversed');
    }
    this._edgeStates.set(edges);

    this._doneCount.set(plan.entries.length);
    this._elapsedRealMs.set(plan.totalRealMs);
    this._status.set('finished');
  }

  private patchStep(stepId: string, patch: Partial<PreviewStepView>): void {
    const next = new Map(this._stepStates());
    const current = next.get(stepId);
    if (!current) {
      return;
    }
    next.set(stepId, { ...current, ...patch });
    this._stepStates.set(next);
  }

  /** Marca los hilos RECORRIDOS que entran a la carta (active → traversed). */
  private markIncoming(stepId: string, status: PreviewEdgeStatus): void {
    const incoming = this.connectionsSnapshot.filter(
      link => link.toStepId === stepId && this.traversedIds.has(link.id),
    );
    if (incoming.length === 0) {
      return;
    }
    const next = new Map(this._edgeStates());
    for (const link of incoming) {
      next.set(link.id, status);
    }
    this._edgeStates.set(next);
  }

  private cancelTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
