import { WorkflowBranch, WorkflowStep, isBranching, summaryPairs } from '../data-access/workflow.model';

/**
 * Layout del diagrama: convierte la lista plana de pasos en geometría lista
 * para pintar.
 *
 * Es una función **pura** y determinista — misma entrada, mismo dibujo — así
 * que el canvas no guarda posiciones ni el usuario puede dejar el diagrama
 * desordenado. También la hace testeable sin montar el componente.
 *
 * Algoritmo: se mide el ancho de cada subárbol en "carriles" y luego se
 * reparte el espacio de arriba abajo, centrando cada padre sobre sus hijos
 * (tidy tree clásico). Las ramas `yes` se colocan a la izquierda y las `no` a
 * la derecha, como en el diseño.
 *
 * **Limitación consciente:** el modelo es un ÁRBOL, así que dos ramas no
 * pueden volver a unirse en un paso intermedio. Lo único que converge es el
 * nodo final `END`, al que llegan todas las hojas. Soportar merges reales
 * exigiría un grafo con aristas explícitas y un algoritmo de ranking; no
 * compensa mientras no haya motor que ejecute nada.
 */

export const NODE_WIDTH = 284;
/** Alto de un nodo sin pie de pares clave/valor. */
const NODE_BASE_HEIGHT = 96;
const NODE_PAIR_HEIGHT = 24;
/** Hueco vertical entre filas: deja sitio al conector, al `+` y a la píldora de rama. */
const ROW_GAP = 76;
const COLUMN_GAP = 36;
/** Radio de los codos de los conectores. */
const ELBOW = 14;
const END_WIDTH = 118;
const END_HEIGHT = 44;
/** Margen alrededor del diagrama. */
const PADDING = 48;

export interface PositionedNode {
  step: WorkflowStep;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Etiqueta de la rama por la que cuelga (se pinta sobre el conector). */
  branch: WorkflowBranch | null;
}

export interface Connector {
  /** Clave estable para `trackBy`. */
  id: string;
  path: string;
  /** Punto medio: ahí va el botón `+` de inserción. */
  midX: number;
  midY: number;
  /** Dónde insertaría ese `+`. */
  parentId: string | null;
  branch: WorkflowBranch | null;
  /** Etiqueta `Yes` / `No`, si la hay. */
  label: string | null;
  labelX: number;
  labelY: number;
}

export interface WorkflowLayout {
  nodes: PositionedNode[];
  connectors: Connector[];
  end: { x: number; y: number; width: number; height: number } | null;
  width: number;
  height: number;
}

function nodeHeight(step: WorkflowStep): number {
  return NODE_BASE_HEIGHT + summaryPairs(step).length * NODE_PAIR_HEIGHT;
}

/** Hijos de un paso, con las ramas ordenadas: primero `yes`, después `no`. */
function orderedChildren(steps: WorkflowStep[], parentId: string): WorkflowStep[] {
  const children = steps.filter(step => step.parentId === parentId);
  return [...children].sort((a, b) => branchRank(a.branch) - branchRank(b.branch));
}

/**
 * El documento vive en localStorage y es editable a mano, así que puede llegar
 * con un ciclo (A padre de B y B padre de A). Sin esta guarda el recorrido no
 * termina y cuelga la pestaña; con ella se dibuja lo que se pueda.
 */
function guardCycle(visited: Set<string>, id: string): boolean {
  if (visited.has(id)) {
    return false;
  }
  visited.add(id);
  return true;
}

function branchRank(branch: WorkflowBranch | null): number {
  if (branch === 'yes') {
    return 0;
  }
  return branch === 'no' ? 2 : 1;
}

/** Ancho del subárbol en carriles (1 carril = un nodo). */
function measure(
  steps: WorkflowStep[],
  step: WorkflowStep,
  cache: Map<string, number>,
  seen: Set<string> = new Set(),
): number {
  const cached = cache.get(step.id);
  if (cached !== undefined) {
    return cached;
  }
  if (!guardCycle(seen, step.id)) {
    return 1;
  }
  const children = orderedChildren(steps, step.id);
  const width =
    children.length === 0 ? 1 : children.reduce((sum, child) => sum + measure(steps, child, cache, seen), 0);
  cache.set(step.id, width);
  return width;
}

/**
 * Conector ortogonal con codos redondeados: baja del padre, gira hacia la
 * columna del hijo y vuelve a bajar. Si están alineados es una recta.
 */
function connectorPath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (Math.abs(fromX - toX) < 1) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = fromY + (toY - fromY) / 2;
  const dir = toX > fromX ? 1 : -1;
  // El radio se ACOTA al espacio real disponible: con ramas juntas o filas
  // cortas, un radio fijo hace que el arco se pase de largo y la línea se
  // doble hacia atrás.
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

export function layoutWorkflow(steps: WorkflowStep[]): WorkflowLayout {
  const root = steps.find(step => step.parentId === null);
  if (!root) {
    return { nodes: [], connectors: [], end: null, width: 0, height: 0 };
  }

  const cache = new Map<string, number>();
  const nodes: PositionedNode[] = [];
  const connectors: Connector[] = [];
  const lane = NODE_WIDTH + COLUMN_GAP;

  const placed = new Set<string>();

  /** Coloca el subárbol dentro de la banda [laneStart, laneStart + ancho). */
  function place(step: WorkflowStep, depth: number, laneStart: number, top: number): void {
    if (!guardCycle(placed, step.id)) {
      return;
    }
    const span = measure(steps, step, cache);
    const centerX = (laneStart + span / 2) * lane;
    const height = nodeHeight(step);
    const x = centerX - NODE_WIDTH / 2;

    nodes.push({ step, x, y: top, width: NODE_WIDTH, height, branch: step.branch });

    const children = orderedChildren(steps, step.id);
    const childTop = top + height + ROW_GAP;
    const branching = isBranching(step);
    let cursor = laneStart;

    for (const child of children) {
      const childSpan = measure(steps, child, cache);
      const childCenter = (cursor + childSpan / 2) * lane;
      const label = branching ? (child.branch === 'no' ? 'No' : 'Yes') : null;

      connectors.push({
        id: `${step.id}->${child.id}`,
        path: connectorPath(centerX, top + height, childCenter, childTop),
        midX: centerX + (childCenter - centerX) / 2,
        midY: top + height + ROW_GAP / 2,
        parentId: step.id,
        branch: child.branch,
        label,
        // La píldora va cerca del padre, antes del codo, como en el diseño.
        labelX: childCenter,
        labelY: top + height + ROW_GAP / 2,
      });

      place(child, depth + 1, cursor, childTop);
      cursor += childSpan;
    }

    // Una hoja: deja un `+` colgando para seguir construyendo.
    if (children.length === 0) {
      const branch = branching ? 'yes' : null;
      connectors.push({
        id: `${step.id}->end`,
        path: '',
        midX: centerX,
        midY: top + height + ROW_GAP / 2,
        parentId: step.id,
        branch,
        label: null,
        labelX: centerX,
        labelY: 0,
      });
    }
  }

  place(root, 0, 0, 0);

  // El END cuelga bajo la fila más profunda y recoge todas las hojas.
  const leaves = nodes.filter(node => !nodes.some(other => other.step.parentId === node.step.id));
  const bottom = Math.max(...nodes.map(node => node.y + node.height));
  const endY = bottom + ROW_GAP;
  const centerOfAll = (Math.min(...nodes.map(n => n.x)) + Math.max(...nodes.map(n => n.x + n.width))) / 2;
  const end = { x: centerOfAll - END_WIDTH / 2, y: endY, width: END_WIDTH, height: END_HEIGHT };

  for (const leaf of leaves) {
    connectors.push({
      id: `${leaf.step.id}->END`,
      path: connectorPath(leaf.x + leaf.width / 2, leaf.y + leaf.height, centerOfAll, endY),
      midX: leaf.x + leaf.width / 2,
      midY: leaf.y + leaf.height + ROW_GAP / 2,
      parentId: null,
      branch: null,
      label: null,
      labelX: 0,
      labelY: 0,
    });
  }

  // Normaliza a coordenadas positivas con margen.
  const minX = Math.min(...nodes.map(n => n.x), end.x);
  const shift = PADDING - minX;
  for (const node of nodes) {
    node.x += shift;
  }
  for (const connector of connectors) {
    connector.midX += shift;
    connector.labelX += shift;
    connector.path = shiftPath(connector.path, shift);
  }
  end.x += shift;

  const width = Math.max(...nodes.map(n => n.x + n.width), end.x + end.width) + PADDING;
  const height = end.y + end.height + PADDING;
  return { nodes, connectors, end, width, height };
}

/** Desplaza en X un path ya generado (solo tiene números `x y` en pares). */
function shiftPath(path: string, dx: number): string {
  if (!path) {
    return path;
  }
  return path.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_match, x: string, y: string) =>
    `${(parseFloat(x) + dx).toFixed(2)} ${y}`,
  );
}
