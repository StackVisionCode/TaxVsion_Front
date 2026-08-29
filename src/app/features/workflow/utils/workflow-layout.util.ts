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
/**
 * Margen superior extra: la barra flotante de Builder/Debugger y el undo/redo
 * van encima del lienzo, y con solo `PADDING` tapaban el primer nodo.
 */
const TOP_PADDING = 104;

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

  /**
   * Fase 1 — posición automática del subárbol dentro de [laneStart, +ancho).
   * Es solo la posición POR DEFECTO: si el paso trae `x`/`y` porque el usuario
   * lo arrastró, esos ganan justo después.
   */
  function place(step: WorkflowStep, depth: number, laneStart: number, top: number): void {
    if (!guardCycle(placed, step.id)) {
      return;
    }
    const span = measure(steps, step, cache);
    const autoX = (laneStart + span / 2) * lane - NODE_WIDTH / 2;
    const height = nodeHeight(step);

    nodes.push({
      step,
      // El PADDING va aquí, no en una normalización al final: con posiciones
      // libres, recentrar todo el diagrama cada vez que se mueve un nodo haría
      // que el lienzo "salte" bajo el cursor.
      x: typeof step.x === 'number' ? step.x : autoX + PADDING,
      y: typeof step.y === 'number' ? step.y : top + TOP_PADDING,
      width: NODE_WIDTH,
      height,
      branch: step.branch,
    });

    const children = orderedChildren(steps, step.id);
    const childTop = top + height + ROW_GAP;
    let cursor = laneStart;

    for (const child of children) {
      place(child, depth + 1, cursor, childTop);
      cursor += measure(steps, child, cache);
    }
  }

  place(root, 0, 0, 0);

  // Fase 2 — conectores contra las posiciones FINALES. Separarlo de la fase 1
  // es lo que permite mover nodos libremente sin que las líneas se queden
  // dibujadas donde estaba el nodo antes.
  const byId = new Map(nodes.map(node => [node.step.id, node]));
  for (const node of nodes) {
    const children = orderedChildren(steps, node.step.id).map(child => byId.get(child.id)).filter(Boolean) as PositionedNode[];
    const branching = isBranching(node.step);
    const fromX = node.x + node.width / 2;
    const fromY = node.y + node.height;

    for (const child of children) {
      const toX = child.x + child.width / 2;
      const toY = child.y;
      connectors.push({
        id: `${node.step.id}->${child.step.id}`,
        path: connectorPath(fromX, fromY, toX, toY),
        midX: fromX + (toX - fromX) / 2,
        midY: fromY + (toY - fromY) / 2,
        parentId: node.step.id,
        branch: child.step.branch,
        label: branching ? (child.step.branch === 'no' ? 'No' : 'Yes') : null,
        labelX: toX,
        labelY: fromY + (toY - fromY) / 2,
      });
    }

    // Hoja: `+` colgando para seguir construyendo.
    if (children.length === 0) {
      connectors.push({
        id: `${node.step.id}->end`,
        path: '',
        midX: fromX,
        midY: fromY + ROW_GAP / 2,
        parentId: node.step.id,
        branch: branching ? 'yes' : null,
        label: null,
        labelX: fromX,
        labelY: 0,
      });
    }
  }

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

  // El lienzo crece con el contenido y deja siempre sitio libre alrededor,
  // para poder arrastrar un nodo más allá del último.
  const width = Math.max(...nodes.map(n => n.x + n.width), end.x + end.width) + PADDING * 4;
  const height = Math.max(end.y + end.height, ...nodes.map(n => n.y + n.height)) + PADDING * 4;
  return { nodes, connectors, end, width, height };
}
