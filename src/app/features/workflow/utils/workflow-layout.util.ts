import {
  WorkflowAnnotation,
  WorkflowConnection,
  WorkflowDataField,
  WorkflowPort,
  WorkflowStep,
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
/**
 * Alto de una carta SIN pie: cabecera 40 (icono de 24 + `py-2`) + cuerpo 56
 * (líneas `leading-5` + `leading-4` + `py-2.5`). La carta se dibuja con
 * `overflow: hidden` a esta altura exacta, así que lo que no se cuente aquí
 * se ve cortado.
 */
const NODE_BASE_HEIGHT = 96;
/**
 * Borde superior + `py-1.5` del pie. Solo suma cuando hay pares, y es
 * justamente lo que faltaba: se contaban las filas pero no el marco del
 * bloque, así que la última fila salía partida por la mitad.
 */
const NODE_FOOTER_CHROME = 16;
/** Cada fila del pie: `leading-4` (16) + `py-0.5` (4). */
const NODE_PAIR_HEIGHT = 20;
const ROW_GAP = 96;
const COLUMN_GAP = 40;
/** Radio de los codos de los hilos. */
const ELBOW = 14;
/**
 * Holgura alrededor del contenido. Es lo que hace que SIEMPRE haya lienzo por delante: al
 * arrastrar hacia fuera el contenido crece y el margen se recalcula detrás, así que el
 * borde nunca se alcanza. Los 192px de antes (PADDING*4) se acababan a la primera.
 */
const CANVAS_MARGIN = 900;
/**
 * Lienzo mínimo, ~2,5 pantallas a zoom 1. Un flujo de dos cartas no debe sentirse
 * encajonado, y hace falta sitio vacío donde dejar notas al lado del diagrama.
 */
const MIN_CANVAS_WIDTH = 3600;
const MIN_CANVAS_HEIGHT = 2600;
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

/** Rectángulo que envuelve algo dibujado en el lienzo. */
export interface ContentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Sitio que la ESTRUCTURA le reserva a una carta, sin mirar dónde está. */
interface NodeSlot {
  level: number;
  index: number;
  height: number;
  /** Dónde iría si el usuario no la hubiera movido a mano. */
  autoX: number;
  autoY: number;
}

/** Todo lo que se puede calcular sin saber dónde está cada carta. */
export interface WorkflowSkeleton {
  slots: Map<string, NodeSlot>;
  ports: Map<string, WorkflowPort[]>;
  missing: Map<string, WorkflowDataField[]>;
  inDegree: Map<string, number>;
  outDegree: Map<string, number>;
  /** Salidas sin hilo: que EXISTAN es estructural; dónde cae su `+`, no. */
  openPorts: { stepId: string; port: string }[];
}

export interface WorkflowLayout {
  nodes: PositionedNode[];
  connectors: Connector[];
  openEnds: OpenEnd[];
  end: { x: number; y: number; width: number; height: number } | null;
  /** Caja ajustada al contenido. `fit()` encaja ESTO, no el lienzo entero. */
  content: ContentBox;
  width: number;
  height: number;
}

/**
 * Alto de la carta a partir de lo que realmente se dibuja. Los conectores se
 * anclan a `y + height`, así que la carta no puede crecer sola: es este
 * cálculo el que tiene que coincidir con el template.
 */
export function nodeHeight(step: WorkflowStep): number {
  const pairs = summaryPairs(step).length;
  return NODE_BASE_HEIGHT + (pairs > 0 ? NODE_FOOTER_CHROME + pairs * NODE_PAIR_HEIGHT : 0);
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

/**
 * Hilo ortogonal con codos redondeados; el radio se acota al espacio real.
 *
 * Los dos tramos verticales tienen que acortarse HACIA su propio sentido de avance. El
 * signo vertical (`dirY`) no estaba: se restaba el radio siempre como si el hilo bajara,
 * así que en un hilo que sube —una carta conectada a otra que está más arriba, algo normal
 * cuando el usuario mueve las cartas a mano— cada tramo se pasaba `radius` de largo y el
 * codo lo hacía volver. Eso dibujaba un muñón recto asomando por fuera de cada esquina, que
 * es lo que se veía como "líneas cortadas".
 */
function connectorPath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (Math.abs(fromX - toX) < 1) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = fromY + (toY - fromY) / 2;
  const dirX = toX > fromX ? 1 : -1;
  const dirY = toY > fromY ? 1 : -1;
  const radius = Math.min(ELBOW, Math.abs(toX - fromX) / 2, Math.abs(toY - fromY) / 2);
  return [
    `M ${fromX} ${fromY}`,
    `L ${fromX} ${midY - radius * dirY}`,
    `Q ${fromX} ${midY} ${fromX + radius * dirX} ${midY}`,
    `L ${toX - radius * dirX} ${midY}`,
    `Q ${toX} ${midY} ${toX} ${midY + radius * dirY}`,
    `L ${toX} ${toY}`,
  ].join(' ');
}

/**
 * Fase CARA: niveles, orden, alturas, grados, datos que faltan y salidas libres.
 *
 * Recorre el grafo varias veces y no depende de dónde esté cada carta. Está separada para
 * poder memoizarla: arrastrar mueve una carta, no cambia la estructura, así que por frame
 * solo debería pagarse la fase de posiciones. Antes todo esto —incluido un recorrido
 * ascendente completo del grafo POR CADA nodo, dentro de `missingInputs`— se rehacía
 * sesenta veces por segundo mientras se arrastraba. Ese era el lag.
 *
 * Matiz: el orden dentro de un nivel usa el baricentro de los padres ya colocados, así que
 * sí lee `x`. Congelarlo mientras dura el arrastre es además una mejora: hoy las cartas sin
 * posición manual se recolocan bajo el cursor mientras mueves otra.
 */
export function layoutSkeleton(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
): WorkflowSkeleton {
  // Índices por extremo. `predecessorsOf`/`connectionsFrom` filtran el array ENTERO por
  // carta, y el ranking los llama N veces por pasada: de ahí sale el coste cuadrático.
  const byFrom = new Map<string, WorkflowConnection[]>();
  const byTo = new Map<string, WorkflowConnection[]>();
  for (const link of connections) {
    const out = byFrom.get(link.fromStepId);
    out ? out.push(link) : byFrom.set(link.fromStepId, [link]);
    const into = byTo.get(link.toStepId);
    into ? into.push(link) : byTo.set(link.toStepId, [link]);
  }
  const parentsOf = (id: string): string[] => (byTo.get(id) ?? []).map(link => link.fromStepId);

  const slots = new Map<string, NodeSlot>();
  const ports = new Map<string, WorkflowPort[]>();
  const missing = new Map<string, WorkflowDataField[]>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const openPorts: { stepId: string; port: string }[] = [];

  if (steps.length === 0) {
    return { slots, ports, missing, inDegree, outDegree, openPorts };
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

  for (const level of levels) {
    const inLevel = [...byLevel.get(level)!];
    const barycenter = (step: WorkflowStep): number => {
      const parents = parentsOf(step.id)
        .map(id => centerX.get(id))
        .filter((value): value is number => value !== undefined);
      return parents.length > 0 ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER;
    };
    inLevel.sort((a, b) => barycenter(a) - barycenter(b));

    inLevel.forEach((step, index) => {
      const autoCenter = PADDING + NODE_WIDTH / 2 + index * lane;
      const height = nodeHeight(step);
      const autoX = autoCenter - NODE_WIDTH / 2;
      const autoY = levelTop.get(level)!;
      // El baricentro del siguiente nivel se mide contra la posición EFECTIVA, que es la
      // manual si la hay: si no, mover una carta a mano no reordenaría a sus hijas.
      const x = typeof step.x === 'number' ? step.x : autoX;
      centerX.set(step.id, x + NODE_WIDTH / 2);

      slots.set(step.id, { level, index, height, autoX, autoY });
      ports.set(step.id, outputsOf(step));
      missing.set(step.id, missingInputs(steps, connections, step.id));
      inDegree.set(step.id, (byTo.get(step.id) ?? []).length);
      outDegree.set(step.id, (byFrom.get(step.id) ?? []).length);

      for (const port of outputsOf(step)) {
        // Que una salida esté libre es estructural; dónde cae su `+`, no.
        if (!(byFrom.get(step.id) ?? []).some(link => link.fromPort === port.id)) {
          openPorts.push({ stepId: step.id, port: port.id });
        }
      }
    });
  }

  return { slots, ports, missing, inDegree, outDegree, openPorts };
}

/**
 * Fase BARATA: solo posiciones. O(N + E), sin recorrer el grafo.
 *
 * Es lo único que debe correr por frame mientras se arrastra.
 */
export function positionLayout(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
  skeleton: WorkflowSkeleton,
  annotations: readonly WorkflowAnnotation[] = [],
): WorkflowLayout {
  // Un esqueleto que no conoce a algún paso está desfasado, y dibujar sin él sería perder
  // cartas. Comprobarlo cuesta O(N) y cierra una clase entera de bugs de sincronización.
  const shape = steps.every(step => skeleton.slots.has(step.id))
    ? skeleton
    : layoutSkeleton(steps, connections);

  if (steps.length === 0) {
    const content = contentBox([], annotations);
    return {
      nodes: [],
      connectors: [],
      openEnds: [],
      end: null,
      content,
      ...canvasSize(content),
    };
  }

  const nodes: PositionedNode[] = steps.map(step => {
    const slot = shape.slots.get(step.id)!;
    const x = typeof step.x === 'number' ? step.x : slot.autoX;
    const y = typeof step.y === 'number' ? step.y : slot.autoY;
    const portList = shape.ports.get(step.id) ?? [{ id: 'main' }];

    return {
      step,
      x,
      y,
      width: NODE_WIDTH,
      height: slot.height,
      input: { x: x + NODE_WIDTH / 2, y },
      outputs: portList.map((port, portIndex) => ({
        portId: port.id,
        label: port.label,
        // Varias salidas se reparten a lo ancho del borde inferior.
        x: x + (NODE_WIDTH * (portIndex + 1)) / (portList.length + 1),
        y: y + slot.height,
      })),
      inDegree: shape.inDegree.get(step.id) ?? 0,
      outDegree: shape.outDegree.get(step.id) ?? 0,
      missing: shape.missing.get(step.id) ?? [],
    };
  });

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
  for (const { stepId, port } of shape.openPorts) {
    const anchor = byId.get(stepId)?.outputs.find(output => output.portId === port);
    if (anchor) {
      openEnds.push({
        id: `${stepId}:${port}`,
        stepId,
        port,
        x: anchor.x,
        y: anchor.y + ROW_GAP / 2,
      });
    }
  }

  const bottom = Math.max(...nodes.map(node => node.y + node.height));
  const spread = nodes.map(node => node.x);
  const canvasCenter =
    (Math.min(...spread) + Math.max(...nodes.map(node => node.x + node.width))) / 2;
  const end = { x: canvasCenter - END_WIDTH / 2, y: bottom + ROW_GAP, width: END_WIDTH, height: END_HEIGHT };

  const content = contentBox(nodes, annotations, end);
  return { nodes, connectors, openEnds, end, content, ...canvasSize(content) };
}

/**
 * Huella de la ESTRUCTURA. Mientras no cambie, el esqueleto memoizado sigue valiendo.
 *
 * Se recalcula por frame —es O(N+E) y solo construye texto— pero devuelve el MISMO valor
 * mientras se arrastra, que es justo lo que evita invalidar el `computed` caro.
 *
 * `nodeHeight` entra porque el alto de la carta decide el alto del nivel; `typeId` porque
 * decide puertos, `produces` y `consumes`; y la bandera de posición manual porque decide si
 * `autoX`/`autoY` llegan a usarse.
 */
export function workflowStructureKey(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
): string {
  const cards = steps
    .map(
      step =>
        `${step.id}|${step.typeId}|${nodeHeight(step)}|${typeof step.x === 'number' ? 1 : 0}${
          typeof step.y === 'number' ? 1 : 0
        }`,
    )
    .join(';');
  const links = connections.map(c => `${c.fromStepId}>${c.fromPort}>${c.toStepId}`).join(';');
  return `${cards}#${links}`;
}

/**
 * Caja de una anotación.
 *
 * `arrow` guarda en width/height el DESPLAZAMIENTO hasta la punta, que puede ser negativo:
 * sin normalizar, una flecha hacia arriba mediría al revés y se saldría del lienzo.
 */
function annotationBox(annotation: WorkflowAnnotation): ContentBox {
  return {
    minX: Math.min(annotation.x, annotation.x + annotation.width),
    minY: Math.min(annotation.y, annotation.y + annotation.height),
    maxX: Math.max(annotation.x, annotation.x + annotation.width),
    maxY: Math.max(annotation.y, annotation.y + annotation.height),
  };
}

/** Lo que ocupa TODO lo dibujado: cartas, el END y las anotaciones. */
function contentBox(
  nodes: readonly PositionedNode[],
  annotations: readonly WorkflowAnnotation[],
  end?: { x: number; y: number; width: number; height: number } | null,
): ContentBox {
  const boxes: ContentBox[] = nodes.map(node => ({
    minX: node.x,
    minY: node.y,
    maxX: node.x + node.width,
    maxY: node.y + node.height,
  }));
  if (end) {
    boxes.push({ minX: end.x, minY: end.y, maxX: end.x + end.width, maxY: end.y + end.height });
  }
  // Las anotaciones ENTRAN en los límites. Antes el layout ni las recibía, así que una nota
  // arrastrada más allá de la última carta no ensanchaba el área desplazable y quedaba
  // recortada fuera, sin forma de llegar a ella.
  for (const annotation of annotations) {
    boxes.push(annotationBox(annotation));
  }
  if (boxes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...boxes.map(box => box.minX)),
    minY: Math.min(...boxes.map(box => box.minY)),
    maxX: Math.max(...boxes.map(box => box.maxX)),
    maxY: Math.max(...boxes.map(box => box.maxY)),
  };
}

/** Tamaño del lienzo: el contenido más holgura, y nunca menos que el mínimo. */
function canvasSize(content: ContentBox): { width: number; height: number } {
  return {
    width: Math.max(content.maxX + CANVAS_MARGIN, MIN_CANVAS_WIDTH),
    height: Math.max(content.maxY + CANVAS_MARGIN, MIN_CANVAS_HEIGHT),
  };
}

/** API pública: las dos fases compuestas. Mismo resultado que siempre. */
export function layoutWorkflow(
  steps: WorkflowStep[],
  connections: WorkflowConnection[],
  annotations: readonly WorkflowAnnotation[] = [],
): WorkflowLayout {
  return positionLayout(steps, connections, layoutSkeleton(steps, connections), annotations);
}
