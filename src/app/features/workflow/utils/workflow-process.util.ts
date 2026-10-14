import {
  WorkflowConnection,
  WorkflowProcess,
  WorkflowStep,
  isBranching,
  outputsOf,
  stepType,
  stepTypeOrFallback,
} from '../data-access/workflow.model';

/**
 * Funciones puras sobre procesos.
 *
 * El documento sigue siendo un grafo (pasos + hilos): un proceso es una lista ordenada de
 * pasos cuyos hilos internos son siempre "cada paso con el siguiente". Estas funciones
 * mantienen esa invariante y migran los documentos viejos, que eran un grafo libre.
 */

/** Cuántos acentos cicla la rampa de procesos (Star, Twilight, Azure). */
export const PROCESS_ACCENT_COUNT = 3;

/** Pasos de un proceso, en su orden (el del array del documento). */
export function stepsOfProcess(steps: readonly WorkflowStep[], processId: string): WorkflowStep[] {
  return steps.filter(step => step.processId === processId);
}

export function firstStepOf(steps: readonly WorkflowStep[], processId: string): WorkflowStep | null {
  return steps.find(step => step.processId === processId) ?? null;
}

export function lastStepOf(steps: readonly WorkflowStep[], processId: string): WorkflowStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].processId === processId) {
      return steps[i];
    }
  }
  return null;
}

/** ¿Es un trigger? Solo puede ir el primero de un proceso que nadie alimenta. */
export function isTriggerStep(step: WorkflowStep): boolean {
  return stepType(step.typeId)?.category === 'trigger';
}

/** Un hilo es "de proceso a proceso" cuando sus dos extremos están en procesos distintos. */
export function isCrossLink(steps: readonly WorkflowStep[], link: WorkflowConnection): boolean {
  const from = steps.find(step => step.id === link.fromStepId);
  const to = steps.find(step => step.id === link.toStepId);
  return !!from && !!to && from.processId !== to.processId;
}

/**
 * Deja los hilos coherentes con los procesos.
 *
 * - Dentro de un proceso: exactamente "cada paso → el siguiente", por la primera salida del
 *   paso. Se conserva el id de un hilo que ya existía para no invalidar selecciones ni la
 *   simulación; si no, se usa un id determinista.
 * - Entre procesos: solo sobreviven los que salen del ÚLTIMO paso y entran en el PRIMERO.
 *   Cuando una inserción o un borrado cambia quién es el último, la salida 'main' de un paso
 *   normal viaja con el final del proceso, y un hilo que apuntaba al antiguo primer paso
 *   pasa al nuevo. Una salida Yes / No de un paso que dejó de ser el último se descarta: ya
 *   no existe esa bifurcación al final.
 */
export function syncProcessLinks(
  steps: readonly WorkflowStep[],
  connections: readonly WorkflowConnection[],
): WorkflowConnection[] {
  const byId = new Map(steps.map(step => [step.id, step]));
  const processIds = new Set(steps.map(step => step.processId ?? ''));
  const first = new Map<string, WorkflowStep>();
  const last = new Map<string, WorkflowStep>();
  const order = new Map<string, WorkflowStep[]>();
  for (const step of steps) {
    const pid = step.processId ?? '';
    if (!first.has(pid)) {
      first.set(pid, step);
    }
    last.set(pid, step);
    order.set(pid, [...(order.get(pid) ?? []), step]);
  }

  const result: WorkflowConnection[] = [];
  const seen = new Set<string>();
  const push = (link: WorkflowConnection): void => {
    const key = `${link.fromStepId}|${link.fromPort}|${link.toStepId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(link);
    }
  };

  // 1. Hilos internos: cada paso con el siguiente.
  for (const pid of processIds) {
    const list = order.get(pid) ?? [];
    for (let i = 0; i < list.length - 1; i++) {
      const from = list[i];
      const to = list[i + 1];
      const port = outputsOf(from)[0].id;
      const existing = connections.find(
        link => link.fromStepId === from.id && link.toStepId === to.id && link.fromPort === port,
      );
      push(existing ?? { id: `pl-${from.id}-${to.id}`, fromStepId: from.id, fromPort: port, toStepId: to.id });
    }
  }

  // 2. Hilos entre procesos.
  for (const link of connections) {
    const from = byId.get(link.fromStepId);
    const to = byId.get(link.toStepId);
    if (!from || !to || from.processId === to.processId) {
      continue;
    }
    const fromPid = from.processId ?? '';
    const toPid = to.processId ?? '';
    let source = from;
    if (last.get(fromPid)?.id !== from.id) {
      const tail = last.get(fromPid);
      // La salida 'main' acompaña al final del proceso; una Yes/No ya no tiene dónde colgar.
      if (link.fromPort === 'main' && !isBranching(from) && tail && !isBranching(tail)) {
        source = tail;
      } else {
        continue;
      }
    }
    const target = first.get(toPid);
    if (!target) {
      continue;
    }
    if (source.id === from.id && target.id === to.id) {
      push(link);
    } else {
      push({ ...link, fromStepId: source.id, toStepId: target.id });
    }
  }
  return result;
}

/**
 * Convierte un grafo libre (el formato anterior a los procesos) en procesos.
 *
 * Una cadena empieza en un paso sin entradas, justo después de una bifurcación o en un paso
 * con más de una entrada, y continúa mientras el paso tenga UNA sola salida 'main' y su
 * destino UNA sola entrada. Lo que no encaja (ciclos, pasos sueltos) queda en su propio
 * proceso, para no perder nada. Las posiciones salen a 0: las pone `autoPlaceProcesses`.
 */
export function migrateToProcesses(
  steps: readonly WorkflowStep[],
  connections: readonly WorkflowConnection[],
): { steps: WorkflowStep[]; processes: WorkflowProcess[]; connections: WorkflowConnection[] } {
  const ids = new Set(steps.map(step => step.id));
  const links = connections.filter(link => ids.has(link.fromStepId) && ids.has(link.toStepId));
  const into = new Map<string, number>();
  const outOf = new Map<string, WorkflowConnection[]>();
  for (const link of links) {
    into.set(link.toStepId, (into.get(link.toStepId) ?? 0) + 1);
    outOf.set(link.fromStepId, [...(outOf.get(link.fromStepId) ?? []), link]);
  }

  const next = new Map<string, string>();
  const hasPrev = new Set<string>();
  for (const step of steps) {
    const outs = outOf.get(step.id) ?? [];
    if (isBranching(step) || outs.length !== 1 || outs[0].fromPort !== 'main') {
      continue;
    }
    const target = outs[0].toStepId;
    if (target !== step.id && into.get(target) === 1) {
      next.set(step.id, target);
      hasPrev.add(target);
    }
  }

  const byId = new Map(steps.map(step => [step.id, step]));
  const placed = new Set<string>();
  const chains: WorkflowStep[][] = [];
  const walk = (startId: string): void => {
    const chain: WorkflowStep[] = [];
    let current: string | undefined = startId;
    while (current && !placed.has(current)) {
      placed.add(current);
      chain.push(byId.get(current)!);
      current = next.get(current);
    }
    if (chain.length > 0) {
      chains.push(chain);
    }
  };
  for (const step of steps) {
    if (!hasPrev.has(step.id)) {
      walk(step.id);
    }
  }
  // Lo que quede sin colocar solo puede estar en un ciclo de 'main': se rompe en su sitio.
  for (const step of steps) {
    if (!placed.has(step.id)) {
      walk(step.id);
    }
  }

  const processes: WorkflowProcess[] = chains.map((_, index) => ({
    id: `proc-m${index + 1}`,
    name: `Process ${index + 1}`,
    x: 0,
    y: 0,
    colorIndex: index % PROCESS_ACCENT_COUNT,
  }));
  const ordered: WorkflowStep[] = chains.flatMap((chain, index) =>
    chain.map(step => ({ ...step, processId: processes[index].id })),
  );
  return { steps: ordered, processes, connections: syncProcessLinks(ordered, links) };
}

/** Siguiente nombre libre: "Process 3". */
export function nextProcessName(processes: readonly WorkflowProcess[]): string {
  const taken = new Set(processes.map(process => process.name));
  let n = processes.length + 1;
  while (taken.has(`Process ${n}`)) {
    n++;
  }
  return `Process ${n}`;
}

/**
 * Pasos aguas abajo que dependen de datos que este paso manda: sirve para avisar de qué
 * se rompe si se cambia o se quita ("Condition necesita Lead score, que manda este paso").
 */
export function dependentsOf(
  steps: readonly WorkflowStep[],
  connections: readonly WorkflowConnection[],
  stepId: string,
): { step: WorkflowStep; fields: string[] }[] {
  const source = steps.find(step => step.id === stepId);
  if (!source) {
    return [];
  }
  const produced = new Map(stepTypeOrFallback(source.typeId).produces.map(field => [field.key, field.label]));
  const result: { step: WorkflowStep; fields: string[] }[] = [];
  const seen = new Set<string>([stepId]);
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const link of connections.filter(c => c.fromStepId === current)) {
      if (seen.has(link.toStepId)) {
        continue;
      }
      seen.add(link.toStepId);
      queue.push(link.toStepId);
      const target = steps.find(step => step.id === link.toStepId);
      if (!target) {
        continue;
      }
      const fields = stepTypeOrFallback(target.typeId)
        .consumes.filter(field => produced.has(field.key))
        .map(field => produced.get(field.key)!);
      if (fields.length > 0) {
        result.push({ step: target, fields });
      }
    }
  }
  return result;
}
