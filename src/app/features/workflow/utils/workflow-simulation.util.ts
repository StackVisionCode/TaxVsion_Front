import {
  DEFAULT_ESTIMATED_MS,
  WorkflowConnection,
  WorkflowStep,
  connectionsFrom,
  isBranching,
  missingInputs,
  rootSteps,
  stepTypeOrFallback,
} from '../data-access/workflow.model';

/**
 * Planificación PURA de la simulación del Preview: qué cartas corren, en qué
 * orden, cuánto dura cada una y qué queda fuera. Sin timers ni estado — el
 * motor (`WorkflowPreviewService`) reproduce este plan; los tests lo ejercitan
 * con un `random` sembrado y sin esperar a nadie.
 *
 * Semántica, documentada porque son decisiones y no accidentes:
 * - **Ramas**: en cartas que bifurcan se elige un puerto con `random()` y SOLO
 *   se recorren sus hilos; lo alcanzable únicamente por la rama no tomada
 *   queda `skipped`. Correr de nuevo puede tomar la otra.
 * - **Merge = OR-join**: una carta corre en cuanto le llega AL MENOS un hilo
 *   recorrido. Con AND-join, el ejemplo del módulo (dos ramas que convergen)
 *   se bloquearía siempre, porque una ejecución solo toma un camino.
 * - **Secuencial**: una carta a la vez en orden BFS; el total es la suma de lo
 *   ejecutado. Un fan-out desde el mismo puerto se anima en secuencia —
 *   simplificación honesta, anotada como limitación.
 * - **Datos faltantes**: la carta corre igual pero queda marcada con warning;
 *   parar la rama haría el preview inútil a medio construir.
 * - **Tiempo comprimido**: `animMs = clamp(realMs, …)` — un Delay de 2 horas
 *   se anima en ~2.4 s y su etiqueta dice "2 h".
 */

export interface SimulationEntry {
  stepId: string;
  /** Cuánto duraría en una ejecución real. */
  realMs: number;
  /** Cuánto se anima (tiempo comprimido). */
  animMs: number;
  /** Puerto elegido si la carta bifurca. */
  chosenPort: string | null;
  /** Inputs que la carta necesita y nadie le manda. */
  missingLabels: string[];
}

export interface SimulationPlan {
  /** En orden de ejecución. */
  entries: SimulationEntry[];
  traversedConnectionIds: string[];
  skippedStepIds: string[];
  skippedConnectionIds: string[];
  totalRealMs: number;
}

const ANIM_MIN_MS = 500;
const ANIM_MAX_MS = 2400;
/** Fallback cuando un Delay no tiene duración configurada. */
const DEFAULT_DELAY_MS = 5 * 60_000;

const UNIT_MS: Record<string, number> = {
  Minutes: 60_000,
  Hours: 3_600_000,
  Days: 86_400_000,
};

/** "2 s" | "45 min" | "2 h" | "3 d" — para el badge de la carta y el total. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))} ms`;
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)} s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} min`;
  }
  if (ms < 86_400_000) {
    const hours = ms / 3_600_000;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  const days = ms / 86_400_000;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} d`;
}

/** Duración "real" estimada de una carta. Delay/wait-for-event leen su config. */
function realDurationMs(step: WorkflowStep): number {
  const type = stepTypeOrFallback(step.typeId);
  if (step.typeId === 'delay' || step.typeId === 'wait-for-event') {
    const rawDuration = step.typeId === 'delay' ? step.config['duration'] : step.config['timeoutDuration'];
    const rawUnit = step.typeId === 'delay' ? step.config['unit'] : step.config['timeoutUnit'];
    const amount = Number(Array.isArray(rawDuration) ? rawDuration[0] : rawDuration);
    const unit = UNIT_MS[`${Array.isArray(rawUnit) ? rawUnit[0] : rawUnit}`] ?? 60_000;
    return Number.isFinite(amount) && amount > 0 ? amount * unit : DEFAULT_DELAY_MS;
  }
  return type.estimatedMs ?? DEFAULT_ESTIMATED_MS;
}

function clampAnim(realMs: number): number {
  return Math.min(ANIM_MAX_MS, Math.max(ANIM_MIN_MS, realMs));
}

export function planSimulation(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
  random: () => number,
): SimulationPlan {
  const byId = new Map(steps.map(step => [step.id, step]));
  const entries: SimulationEntry[] = [];
  const traversed: string[] = [];
  const executed = new Set<string>();
  const queue = rootSteps(steps, connections).map(step => step.id);

  while (queue.length > 0) {
    const stepId = queue.shift()!;
    if (executed.has(stepId)) {
      continue;
    }
    const step = byId.get(stepId);
    if (!step) {
      continue;
    }
    executed.add(stepId);

    // Puerto elegido en las bifurcaciones; en el resto, todas las salidas.
    const branches = isBranching(step);
    const chosenPort = branches ? (random() < 0.5 ? 'yes' : 'no') : null;
    const realMs = realDurationMs(step);

    entries.push({
      stepId,
      realMs,
      animMs: clampAnim(realMs),
      chosenPort,
      missingLabels: missingInputs(steps, connections, stepId).map(field => field.label),
    });

    const outgoing = chosenPort
      ? connectionsFrom(connections, stepId, chosenPort)
      : connectionsFrom(connections, stepId);
    for (const link of outgoing) {
      traversed.push(link.id);
      // OR-join: el destino corre en cuanto le llega el primer hilo recorrido.
      if (!executed.has(link.toStepId)) {
        queue.push(link.toStepId);
      }
    }
  }

  const skippedStepIds = steps.filter(step => !executed.has(step.id)).map(step => step.id);
  const traversedSet = new Set(traversed);
  const skippedConnectionIds = connections.filter(link => !traversedSet.has(link.id)).map(link => link.id);
  const totalRealMs = entries.reduce((sum, entry) => sum + entry.realMs, 0);

  return { entries, traversedConnectionIds: traversed, skippedStepIds, skippedConnectionIds, totalRealMs };
}
