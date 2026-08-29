import {
  WorkflowConnection,
  WorkflowDataField,
  WorkflowStep,
  connectionsFrom,
  connectionsTo,
  missingInputs,
  outputsOf,
  predecessorsOf,
  summaryPairs,
} from '../data-access/workflow.model';

/**
 * Layout del diagrama.
 *
 * Función **pura** y determinista: misma entrada, mismo dibujo. Coloca por
 * NIVELES y no por árbol, porque una carta puede recibir varios hilos y dos
 * ramas pueden volver a unirse — un recorrido recursivo de padre a hijos no
 * sabe dibujar eso.
 *
 * - Nivel: `nivel(n) = 1 + max(nivel de quienes le mandan)`, resuelto por
 *   iteración con tope, de modo que un documento con ciclos (es editable a
 *   mano en localStorage) se dibuja igual en vez de colgar la pestaña.
 * - Orden dentro del nivel: por el **baricentro** de sus predecesores, que es
 *   lo que evita que los hilos se crucen.
 * - Las posiciones manuales (`x`/`y`) siguen mandando sobre el cálculo.
 */

export const NODE_WIDTH = 284;
/** Alto de una carta sin pie. */
const NODE_BASE_HEIGHT = 96;
const NODE_PAIR_HEIGHT = 24;
const ROW_GAP = 96;
const COLUMN_GAP = 40;
/** Radio de los codos de los hilos. */
const ELBOW = 14;
const END_WIDTH = 118;
const END_HEIGHT = 44;
const PADDING = 48;
/** La barra flotante de Builder/Debugger va sobre el lienzo. */
const TOP_PADDING = 104;
/** Tope de pasadas del ranking: cota de seguridad ante ciclos. */
const RANK_MAX_PASSES = 200;

/** Punto de anclaje de un puerto en la carta. */
export interface PortAnchor {
  portId: string;
  label?: string;
  x: number;
  y: number;
}

export interface PositionedNode {
  step: WorkflowStep;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dónde entra el hilo (arriba, centrado). */
  input: { x: number; y: number };
  /** Dónde sale cada hilo (abajo, repartidas si hay varias). */
  outputs: PortAnchor[];
  inDegree: number;
  outDegree: number;
  /** Lo que la carta necesita y nadie aguas arriba le manda. */
  missing: WorkflowDataField[];
}

export interface Connector {
  /** El id del hilo REAL: el conector ya no es algo derivado sin identidad. */
  id: string;
  path: string;
  /** Punto medio: ahí va el botón `+` de inserción y el de borrar. */
  midX: number;
  midY: number;
  fromStepId: string;
  fromPort: string;
  toStepId: string;
  label: string | null;
  labelX: number;
  labelY: number;
}

/** Un `+` colgando de una salida libre, para seguir construyendo. */
export interface OpenEnd {
  id: string;
  stepId: string;
  port: string;
  x: number;
  y: number;
}

export interface WorkflowLayout {
  nodes: PositionedNode[];
  connectors: Connector[];
  openEnds: OpenEnd[];
  end: { x: number; y: number; width: number; height: number } | null;
  width: number;
  height: number;
}

function nodeHeight(step: WorkflowStep): number {
  return NODE_BASE_HEIGHT + summaryPairs(step).length * NODE_PAIR_HEIGHT;
}

/**
 * Nivel de cada carta. Arranca en 0 para las que no reciben nada y se relaja
 * hasta estabilizarse; el tope de pasadas es lo que impide que un ciclo lo
 * deje girando.
 */
function rankSteps(steps: WorkflowStep[], connections: WorkflowConnection[]): Map<string, number> {
  const rank = new Map<string, number>(steps.map(step => [step.id, 0]));
  for (let pass = 0; pass < Math.min(steps.length + 1, RANK_MAX_PASSES); pass++) {
    let changed = false;
    for (const step of steps) {
      const parents = predecessorsOf(connections, step.id);
      if (parents.length === 0) {
        continue;
      }
      const candidate = Math.max(...parents.map(id => rank.get(id) ?? 0)) + 1;
      if (candidate > (rank.get(step.id) ?? 0)) {
        rank.set(step.id, candidate);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return rank;
}

/** Hilo ortogonal con codos redondeados; el radio se acota al espacio real. */
function connectorPath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (Math.abs(fromX - toX) < 1) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = fromY + (toY - fromY) / 2;
  const dir = toX > fromX ? 1 : -1;
  const radius = Math.min(ELBOW, Math.abs(toX - fromX) / 2, Math.abs(toY - fromY) / 2);
  return [
    `M ${fromX} ${fromY}`,
    `L ${fromX} ${midY - radius}`,
    `Q ${fromX} ${midY} ${fromX + radius * dir} ${midY}`,
    `L ${toX - radius * dir} ${midY}`,
    `Q ${toX} ${midY} ${toX} ${midY + radius}`,
    `L ${toX} ${toY}`,
  ].join(' ');
}

export function layoutWorkflow(steps: WorkflowStep[], connections: WorkflowConnection[]): WorkflowLayout {
  if (steps.length === 0) {
    return { nodes: [], connectors: [], openEnds: [], end: null, width: 0, height: 0 };
  }

  const rank = rankSteps(steps, connections);
  const byLevel = new Map<number, WorkflowStep[]>();
  for (const step of steps) {
    const level = rank.get(step.id) ?? 0;
    byLevel.set(level, [...(byLevel.get(level) ?? []), step]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  // Alto de cada nivel = la carta más alta que contiene.
  const levelHeight = new Map<number, number>();
  for (const level of levels) {
    levelHeight.set(level, Math.max(...byLevel.get(level)!.map(nodeHeight)));
  }
  const levelTop = new Map<number, number>();
  let cursorY = TOP_PADDING;
  for (const level of levels) {
    levelTop.set(level, cursorY);
    cursorY += levelHeight.get(level)! + ROW_GAP;
  }

  // Orden dentro del nivel: baricentro de los predecesores ya colocados.
  const lane = NODE_WIDTH + COLUMN_GAP;
  const centerX = new Map<string, number>();
  const nodes: PositionedNode[] = [];

  for (const level of levels) {
    const inLevel = [...byLevel.get(level)!];
    const barycenter = (step: WorkflowStep): number => {
      const parents = predecessorsOf(connections, step.id)
        .map(id => centerX.get(id))
        .filter((value): value is number => value !== undefined);
      return parents.length > 0 ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER;
    };
    inLevel.sort((a, b) => barycenter(a) - barycenter(b));

    inLevel.forEach((step, index) => {
      const autoCenter = PADDING + NODE_WIDTH / 2 + index * lane;
      const height = nodeHeight(step);
      const x = typeof step.x === 'number' ? step.x : autoCenter - NODE_WIDTH / 2;
      const y = typeof step.y === 'number' ? step.y : levelTop.get(level)!;
      centerX.set(step.id, x + NODE_WIDTH / 2);

      const ports = outputsOf(step);
      const outputs: PortAnchor[] = ports.map((port, portIndex) => ({
        portId: port.id,
        label: port.label,
        // Varias salidas se reparten a lo ancho del borde inferior.
        x: x + (NODE_WIDTH * (portIndex + 1)) / (ports.length + 1),
        y: y + height,
      }));

      nodes.push({
        step,
        x,
        y,
        width: NODE_WIDTH,
        height,
        input: { x: x + NODE_WIDTH / 2, y },
        outputs,
        inDegree: connectionsTo(connections, step.id).length,
        outDegree: connectionsFrom(connections, step.id).length,
        missing: missingInputs(steps, connections, step.id),
      });
    });
  }

  // Los hilos, contra las posiciones finales y conservando su id real.
  const byId = new Map(nodes.map(node => [node.step.id, node]));
  const connectors: Connector[] = [];
  for (const link of connections) {
    const from = byId.get(link.fromStepId);
    const to = byId.get(link.toStepId);
    if (!from || !to) {
      continue;
    }
    const anchor = from.outputs.find(port => port.portId === link.fromPort) ?? from.outputs[0];
    const label = from.outputs.length > 1 ? (anchor.label ?? null) : null;
    connectors.push({
      id: link.id,
      path: connectorPath(anchor.x, anchor.y, to.input.x, to.input.y),
      midX: anchor.x + (to.input.x - anchor.x) / 2,
      midY: anchor.y + (to.input.y - anchor.y) / 2,
      fromStepId: link.fromStepId,
      fromPort: link.fromPort,
      toStepId: link.toStepId,
      label,
      labelX: anchor.x,
      labelY: anchor.y + 22,
    });
  }

  // Salidas sin hilo: ahí va el `+` para seguir. Antes esto se solapaba con el
  // conector al END y el clic acababa creando una raíz nueva.
  const openEnds: OpenEnd[] = [];
  for (const node of nodes) {
    for (const port of node.outputs) {
      if (connectionsFrom(connections, node.step.id, port.portId).length === 0) {
        openEnds.push({
          id: `${node.step.id}:${port.portId}`,
          stepId: node.step.id,
          port: port.portId,
          x: port.x,
          y: port.y + ROW_GAP / 2,
        });
      }
    }
  }

  const bottom = Math.max(...nodes.map(node => node.y + node.height));
  const spread = nodes.map(node => node.x);
  const canvasCenter =
    (Math.min(...spread) + Math.max(...nodes.map(node => node.x + node.width))) / 2;
  const end = { x: canvasCenter - END_WIDTH / 2, y: bottom + ROW_GAP, width: END_WIDTH, height: END_HEIGHT };

  const width = Math.max(...nodes.map(node => node.x + node.width), end.x + end.width) + PADDING * 4;
  const height = Math.max(end.y + end.height, bottom) + PADDING * 4;
  return { nodes, connectors, openEnds, end, width, height };
}
