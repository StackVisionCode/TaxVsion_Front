import {
  WorkflowConnection,
  WorkflowDataField,
  WorkflowProcess,
  WorkflowStep,
  isBranching,
  outputsOf,
  stepTypeOrFallback,
} from '../data-access/workflow.model';
import { PROCESS_ACCENT_COUNT, isTriggerStep, stepsOfProcess } from './workflow-process.util';

/**
 * Geometría del lienzo por procesos.
 *
 * Función **pura**: misma entrada, mismo dibujo. Todo va en píxeles del lienzo (el `stage` se
 * escala con `transform`), y las alturas son FIJAS: los hilos entre procesos se anclan a la
 * fila de salida exacta, así que ni el texto ni el tema pueden cambiar el alto de una tarjeta.
 */

export const PROCESS_WIDTH = 380;
export const COLLAPSED_WIDTH = 240;
export const PROCESS_PAD = 14;
export const HEADER_HEIGHT = 54;
export const START_LABEL_HEIGHT = 22;
export const STEP_HEIGHT = 64;
/** Fila extra de la carta seleccionada: lo que ese paso manda a los siguientes. */
export const STEP_OUTPUTS_HEIGHT = 32;
/** Tramo entre dos pasos, donde vive el `+` de inserción. */
export const JOIN_HEIGHT = 34;
export const ADD_ROW_HEIGHT = 38;
export const EXIT_ROW_HEIGHT = 36;
const COLLAPSED_BODY = 58;
const SECTION_GAP = 8;
const EXIT_GAP = 6;
/** Radio de los codos de los hilos. */
const ELBOW = 12;
/** Holgura alrededor del contenido: siempre hay lienzo por delante al arrastrar hacia fuera. */
const CANVAS_MARGIN = 900;
const MIN_CANVAS_WIDTH = 3200;
const MIN_CANVAS_HEIGHT = 2200;
/** La barra flotante de Builder/Debugger va sobre el lienzo. */
const TOP_PADDING = 100;
const LEFT_PADDING = 56;
const COLUMN_GAP = 120;
const ROW_GAP = 40;
const RANK_MAX_PASSES = 100;

export type ProcessStatus = 'empty' | 'ready' | 'needs-setup';

export interface StepSlot {
  step: WorkflowStep;
  /** Posición RELATIVA a la tarjeta del proceso. */
  y: number;
  height: number;
  index: number;
  missing: WorkflowDataField[];
  /** true = enseña lo que manda (carta seleccionada). */
  showOutputs: boolean;
  outputs: WorkflowDataField[];
}

/** `+` entre dos pasos: inserta en `index` (antes del paso que ocupa ese índice). */
export interface JoinSlot {
  y: number;
  index: number;
}

export interface ExitSlot {
  id: string;
  stepId: string;
  port: string;
  /** "Yes" / "No" cuando el paso bifurca; null para la salida única. */
  label: string | null;
  /** Centro vertical de la fila, relativo a la tarjeta. */
  y: number;
  /** El hilo que ya sale de aquí, si lo hay. */
  connectionId: string | null;
  targetProcessId: string | null;
  targetName: string | null;
}

export interface ProcessBox {
  process: WorkflowProcess;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  accent: number;
  steps: StepSlot[];
  /** Cuántos pasos tiene (`steps` va vacío cuando la tarjeta está plegada). */
  stepCount: number;
  /** Icono del tipo de cada paso, en orden: es lo que enseña la tarjeta plegada. */
  stepIcons: string[];
  joins: JoinSlot[];
  startsWithTrigger: boolean;
  /** Arriba de la fila "Add action", relativo a la tarjeta; null si está plegada. */
  addY: number | null;
  exits: ExitSlot[];
  status: ProcessStatus;
  /** Dónde entra el hilo de otro proceso (borde izquierdo, a la altura de la cabecera). */
  input: { x: number; y: number };
  /** ¿Lo alimenta otro proceso? Enseña el puerto de entrada. */
  fed: boolean;
}

export interface ProcessLink {
  id: string;
  path: string;
  fromProcessId: string;
  toProcessId: string;
  fromStepId: string;
  fromPort: string;
  toStepId: string;
  midX: number;
  midY: number;
}

export interface ContentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ProcessLayout {
  boxes: ProcessBox[];
  links: ProcessLink[];
  content: ContentBox;
  width: number;
  height: number;
}

export interface ProcessLayoutInput {
  processes: readonly WorkflowProcess[];
  steps: readonly WorkflowStep[];
  connections: readonly WorkflowConnection[];
  missing: ReadonlyMap<string, WorkflowDataField[]>;
  selectedStepId: string | null;
  selectedProcessId: string | null;
}

/** Alto de una tarjeta a partir de lo que se dibuja. Compartido con el auto-colocado. */
export function processHeight(options: {
  stepCount: number;
  startsWithTrigger: boolean;
  exitRows: number;
  selectedHasOutputs: boolean;
  collapsed: boolean;
}): number {
  if (options.collapsed) {
    return PROCESS_PAD * 2 + HEADER_HEIGHT + (options.stepCount > 0 ? COLLAPSED_BODY : 0) + (options.exitRows > 1 ? 18 : 0);
  }
  let y = PROCESS_PAD + HEADER_HEIGHT + SECTION_GAP;
  if (options.startsWithTrigger) {
    y += START_LABEL_HEIGHT;
  }
  for (let i = 0; i < options.stepCount; i++) {
    y += STEP_HEIGHT + (options.selectedHasOutputs && i === 0 ? STEP_OUTPUTS_HEIGHT : 0);
    if (i < options.stepCount - 1) {
      y += JOIN_HEIGHT;
    }
  }
  y += SECTION_GAP + ADD_ROW_HEIGHT + SECTION_GAP;
  y += options.exitRows * (EXIT_ROW_HEIGHT + EXIT_GAP);
  return y + PROCESS_PAD - (options.exitRows > 0 ? EXIT_GAP : 0);
}

/** ¿Qué salidas tiene el final del proceso? Las del último paso, o ninguna si está vacío. */
function exitPorts(last: WorkflowStep | null): { port: string; label: string | null }[] {
  if (!last) {
    return [];
  }
  if (isBranching(last)) {
    return outputsOf(last).map(port => ({ port: port.id, label: port.label ?? port.id }));
  }
  return [{ port: 'main', label: null }];
}

/** Hilo ortogonal horizontal-vertical-horizontal con codos redondeados. */
export function processLinkPath(sx: number, sy: number, tx: number, ty: number): string {
  if (Math.abs(sy - ty) < 1 && tx > sx) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }
  const midX = tx - sx > 64 ? sx + (tx - sx) / 2 : sx + 28;
  const dirY = ty > sy ? 1 : -1;
  const radius = Math.min(ELBOW, Math.abs(ty - sy) / 2, Math.abs(midX - sx));
  const toLeft = tx < midX ? -1 : 1;
  const radiusIn = Math.min(ELBOW, Math.abs(ty - sy) / 2, Math.abs(tx - midX) || ELBOW);
  return [
    `M ${sx} ${sy}`,
    `L ${midX - radius} ${sy}`,
    `Q ${midX} ${sy} ${midX} ${sy + radius * dirY}`,
    `L ${midX} ${ty - radiusIn * dirY}`,
    `Q ${midX} ${ty} ${midX + radiusIn * toLeft} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(' ');
}

export function layoutProcesses(input: ProcessLayoutInput): ProcessLayout {
  const { processes, steps, connections, missing, selectedStepId, selectedProcessId } = input;
  const processById = new Map(processes.map(process => [process.id, process]));
  const stepById = new Map(steps.map(step => [step.id, step]));

  const boxes: ProcessBox[] = processes.map(process => {
    const own = stepsOfProcess(steps, process.id);
    const last = own.length > 0 ? own[own.length - 1] : null;
    const collapsed = process.collapsed === true;
    const startsWithTrigger = own.length > 0 && isTriggerStep(own[0]);
    const active =
      selectedProcessId === process.id || own.some(step => step.id === selectedStepId);

    const slots: StepSlot[] = [];
    const joins: JoinSlot[] = [];
    let y = PROCESS_PAD + HEADER_HEIGHT + SECTION_GAP;
    if (!collapsed) {
      if (startsWithTrigger) {
        y += START_LABEL_HEIGHT;
      }
      own.forEach((step, index) => {
        const produces = stepTypeOrFallback(step.typeId).produces;
        const showOutputs = step.id === selectedStepId && produces.length > 0;
        const height = STEP_HEIGHT + (showOutputs ? STEP_OUTPUTS_HEIGHT : 0);
        slots.push({
          step,
          y,
          height,
          index,
          missing: missing.get(step.id) ?? [],
          showOutputs,
          outputs: produces,
        });
        y += height;
        if (index < own.length - 1) {
          joins.push({ y: y + JOIN_HEIGHT / 2, index: index + 1 });
          y += JOIN_HEIGHT;
        }
      });
    }

    // Salidas del proceso. Las de un paso que bifurca se ven siempre; la única salida de un
    // paso normal solo cuando ya está conectada o cuando el proceso está en uso.
    const exits: ExitSlot[] = [];
    const ports = exitPorts(last);
    const addY = collapsed ? null : y + SECTION_GAP;
    if (!collapsed) {
      y += SECTION_GAP + ADD_ROW_HEIGHT + SECTION_GAP;
    }
    const exitRows = ports
      .map(({ port, label }) => {
        const link = connections.find(
          c =>
            last !== null &&
            c.fromStepId === last.id &&
            c.fromPort === port &&
            stepById.get(c.toStepId)?.processId !== process.id,
        );
        return { port, label, link };
      })
      .filter(row => (last && isBranching(last)) || row.link || active);

    const height = collapsed
      ? processHeight({
          stepCount: own.length,
          startsWithTrigger,
          exitRows: exitRows.length,
          selectedHasOutputs: false,
          collapsed: true,
        })
      : 0;

    exitRows.forEach((row, index) => {
      const target = row.link ? stepById.get(row.link.toStepId) : undefined;
      const targetProcess = target?.processId ? processById.get(target.processId) : undefined;
      const centerY = collapsed
        ? exitRows.length === 1
          ? height / 2
          : (height / (exitRows.length + 1)) * (index + 1) + 12
        : y + EXIT_ROW_HEIGHT / 2;
      if (!collapsed) {
        y += EXIT_ROW_HEIGHT + EXIT_GAP;
      }
      exits.push({
        id: `${last!.id}:${row.port}`,
        stepId: last!.id,
        port: row.port,
        label: row.label,
        y: centerY,
        connectionId: row.link?.id ?? null,
        targetProcessId: targetProcess?.id ?? null,
        targetName: targetProcess?.name ?? null,
      });
    });

    const totalHeight = collapsed
      ? height
      : y + PROCESS_PAD - (exitRows.length > 0 ? EXIT_GAP : 0);

    const firstStep = own.length > 0 ? own[0] : null;
    const fed =
      firstStep !== null &&
      connections.some(
        c => c.toStepId === firstStep.id && stepById.get(c.fromStepId)?.processId !== process.id,
      );
    const incomplete = own.some(step => (missing.get(step.id) ?? []).length > 0);
    const width = collapsed ? COLLAPSED_WIDTH : PROCESS_WIDTH;
    return {
      process,
      x: process.x,
      y: process.y,
      width,
      height: totalHeight,
      collapsed,
      accent: ((process.colorIndex % PROCESS_ACCENT_COUNT) + PROCESS_ACCENT_COUNT) % PROCESS_ACCENT_COUNT,
      steps: slots,
      stepCount: own.length,
      stepIcons: own.map(candidate => stepTypeOrFallback(candidate.typeId).icon),
      joins,
      startsWithTrigger,
      addY,
      exits,
      status: own.length === 0 ? 'empty' : incomplete ? 'needs-setup' : 'ready',
      input: { x: process.x, y: process.y + PROCESS_PAD + HEADER_HEIGHT / 2 },
      fed,
    } satisfies ProcessBox;
  });

  const boxById = new Map(boxes.map(box => [box.process.id, box]));
  const links: ProcessLink[] = [];
  for (const box of boxes) {
    for (const exit of box.exits) {
      if (!exit.connectionId || !exit.targetProcessId) {
        continue;
      }
      const link = connections.find(c => c.id === exit.connectionId);
      const target = boxById.get(exit.targetProcessId);
      if (!link || !target) {
        continue;
      }
      const sx = box.x + box.width;
      const sy = box.y + exit.y;
      const tx = target.input.x;
      const ty = target.input.y;
      links.push({
        id: link.id,
        path: processLinkPath(sx, sy, tx, ty),
        fromProcessId: box.process.id,
        toProcessId: target.process.id,
        fromStepId: link.fromStepId,
        fromPort: link.fromPort,
        toStepId: link.toStepId,
        midX: Math.max(tx - sx > 64 ? sx + (tx - sx) / 2 : sx + 28, sx + 14),
        midY: (sy + ty) / 2,
      });
    }
  }

  const content: ContentBox =
    boxes.length === 0
      ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      : {
          minX: Math.min(...boxes.map(box => box.x)),
          minY: Math.min(...boxes.map(box => box.y)),
          maxX: Math.max(...boxes.map(box => box.x + box.width)),
          maxY: Math.max(...boxes.map(box => box.y + box.height)),
        };
  return {
    boxes,
    links,
    content,
    width: Math.max(MIN_CANVAS_WIDTH, content.maxX + CANVAS_MARGIN),
    height: Math.max(MIN_CANVAS_HEIGHT, content.maxY + CANVAS_MARGIN),
  };
}

/**
 * Coloca los procesos que no tienen posición (documentos migrados, "Tidy"): una columna por
 * nivel del grafo de procesos, de izquierda a derecha, y los de un mismo nivel apilados.
 * El tope de pasadas impide que un ciclo (editable a mano en localStorage) deje colgado el cálculo.
 */
export function autoPlaceProcesses(
  processes: readonly WorkflowProcess[],
  steps: readonly WorkflowStep[],
  connections: readonly WorkflowConnection[],
): WorkflowProcess[] {
  const stepById = new Map(steps.map(step => [step.id, step]));
  const edges: [string, string][] = [];
  for (const link of connections) {
    const from = stepById.get(link.fromStepId)?.processId;
    const to = stepById.get(link.toStepId)?.processId;
    if (from && to && from !== to) {
      edges.push([from, to]);
    }
  }
  const rank = new Map<string, number>(processes.map(process => [process.id, 0]));
  for (let pass = 0; pass < Math.min(processes.length + 1, RANK_MAX_PASSES); pass++) {
    let changed = false;
    for (const [from, to] of edges) {
      const candidate = (rank.get(from) ?? 0) + 1;
      if (candidate > (rank.get(to) ?? 0) && candidate <= processes.length) {
        rank.set(to, candidate);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const cursor = new Map<number, number>();
  return processes.map(process => {
    const level = rank.get(process.id) ?? 0;
    const own = stepsOfProcess(steps, process.id);
    const last = own.length > 0 ? own[own.length - 1] : null;
    const height = processHeight({
      stepCount: own.length,
      startsWithTrigger: own.length > 0 && isTriggerStep(own[0]),
      exitRows: last && isBranching(last) ? 2 : 0,
      selectedHasOutputs: false,
      collapsed: process.collapsed === true,
    });
    const y = cursor.get(level) ?? TOP_PADDING;
    cursor.set(level, y + height + ROW_GAP);
    return { ...process, x: LEFT_PADDING + level * (PROCESS_WIDTH + COLUMN_GAP), y };
  });
}
