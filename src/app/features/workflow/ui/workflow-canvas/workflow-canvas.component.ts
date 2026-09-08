import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Connector, OpenEnd, PositionedNode, WorkflowLayout } from '../../utils/workflow-layout.util';
import {
  INK_COLORS,
  INK_SIZES,
  WorkflowAnnotation,
  WorkflowInkSize,
  fontFamilyFor,
  fontSizeFor,
  noteColorClasses,
  strokeWidthFor,
} from '../../data-access/workflow.model';
import { PeerCursor } from '../../data-access/workflow-presence.service';
import { PreviewEdgeStatus, PreviewStepView } from '../../data-access/workflow-preview.service';
import { WorkflowNodeComponent } from '../workflow-node/workflow-node.component';

/** Dónde insertar el paso nuevo: de qué carta y por qué salida. */
export interface InsertRequest {
  fromStepId: string | null;
  fromPort: string;
}

/** Un hilo que se está tirando desde un puerto y aún no ha llegado a destino. */
export interface PendingLink {
  fromStepId: string;
  fromPort: string;
  /** Origen: el puerto de salida. */
  x: number;
  y: number;
  /** Punta: el cursor. */
  toX: number;
  toY: number;
}

/**
 * Herramientas del lienzo. Todas menos `select`/`pan` quedan a la espera de un gesto sobre
 * el lienzo: un clic (`note`, `text`) o un arrastre (`draw`, `arrow`, `rect`).
 */
export type CanvasTool = 'select' | 'pan' | 'note' | 'text' | 'draw' | 'arrow' | 'rect' | 'eraser';

/** Trazo o forma que se está dibujando ahora mismo, todavía sin confirmar. */
interface SketchState {
  pointerId: number;
  tool: 'draw' | 'arrow' | 'rect';
  startX: number;
  startY: number;
  /** Solo para `draw`: puntos absolutos del lienzo, aplanados. */
  points: number[];
  currentX: number;
  currentY: number;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/** Estado del arrastre del lienzo con la herramienta mano. */
interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
}

/** Estado del arrastre de una nota o imagen. */
interface AnnotationDragState {
  pointerId: number;
  id: string;
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

/** Estado del arrastre de un nodo. */
interface NodeDragState {
  pointerId: number;
  stepId: string;
  /** Distancia del puntero a la esquina del nodo, en coordenadas del lienzo. */
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

/**
 * Lienzo del workflow.
 *
 * Estructura en tres capas, que es lo que hace que el zoom sea trivial:
 * - `viewport` con `overflow: auto` → el **pan es scroll nativo** (rueda,
 *   trackpad y scroll-into-view al tabular vienen gratis).
 * - `sizer` con el tamaño ya multiplicado por el zoom → define el área
 *   desplazable.
 * - `stage` con `transform: scale()` y `transform-origin: 0 0` → escala el
 *   dibujo sin tocar ni una coordenada.
 *
 * Es deliberadamente distinto del editor de PDF de firmas, que sí reescala
 * coordenadas: allí son el dato que se envía al backend y hay que re-renderizar
 * el PDF. Aquí la geometría es derivada y el zoom es puramente visual.
 */
@Component({
  selector: 'app-workflow-canvas',
  imports: [CommonModule, WorkflowNodeComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-canvas.component.html',
  styleUrl: './workflow-canvas.component.css',
})
export class WorkflowCanvasComponent implements OnDestroy {
  @Input({ required: true }) layout!: WorkflowLayout;
  @Input() selectedId: string | null = null;
  @Input() selectedConnectionId: string | null = null;
  /** Overlay de la simulación; null = no hay corrida en pantalla. */
  @Input() stepPreview: ReadonlyMap<string, PreviewStepView> | null = null;
  @Input() edgePreview: ReadonlyMap<string, PreviewEdgeStatus> | null = null;

  previewFor(node: PositionedNode): PreviewStepView | null {
    return this.stepPreview?.get(node.step.id) ?? null;
  }

  edgeRunClass(connectorId: string): string {
    const status = this.edgePreview?.get(connectorId);
    return status ? `wf-edge--run-${status}` : '';
  }

  @Output() selectStep = new EventEmitter<string>();
  @Output() deleteStep = new EventEmitter<string>();
  @Output() duplicateStep = new EventEmitter<string>();
  @Output() insertStep = new EventEmitter<InsertRequest>();
  /** Arrastre de un nodo: en vivo mientras se mueve, y al soltar. */
  @Output() moveStepLive = new EventEmitter<{ id: string; x: number; y: number }>();
  @Output() moveStepEnd = new EventEmitter<void>();
  @Output() moveStepStart = new EventEmitter<void>();
  /** Soltar un tipo de paso arrastrado desde el catálogo. */
  @Output() dropStep = new EventEmitter<{ typeId: string; x: number; y: number }>();
  /** Volver al layout automático. */
  @Output() tidy = new EventEmitter<void>();
  /** Hilos: seleccionar, borrar y crear arrastrando de puerto a puerto. */
  @Output() selectConnection = new EventEmitter<string>();
  @Output() deleteConnection = new EventEmitter<string>();
  @Output() connectSteps = new EventEmitter<{ fromStepId: string; fromPort: string; toStepId: string }>();

  /** Notas e imágenes: colocar, editar, mover y borrar. */
  @Output() addNote = new EventEmitter<{ x: number; y: number }>();
  @Output() pickImage = new EventEmitter<{ x: number; y: number }>();
  @Output() updateAnnotation = new EventEmitter<{ id: string; patch: Partial<WorkflowAnnotation> }>();
  @Output() removeAnnotation = new EventEmitter<string>();
  @Output() moveAnnotationLive = new EventEmitter<{ id: string; x: number; y: number }>();
  /** Mi cursor, en coordenadas del lienzo, para que lo vean los demás. */
  @Output() cursorMoved = new EventEmitter<{ x: number; y: number }>();
  @Output() addText = new EventEmitter<{ x: number; y: number; stroke: string; size: WorkflowInkSize }>();
  @Output() addDrawing = new EventEmitter<{ points: number[]; stroke: string; size: WorkflowInkSize }>();
  @Output() addArrow = new EventEmitter<{
    fromX: number; fromY: number; toX: number; toY: number; stroke: string; size: WorkflowInkSize;
  }>();
  @Output() addRect = new EventEmitter<{
    x: number; y: number; width: number; height: number; stroke: string; size: WorkflowInkSize;
  }>();
  /** Qué anotación está seleccionada, para que la página abra Propiedades. */
  @Output() annotationSelected = new EventEmitter<string | null>();

  /** Notas e imágenes sueltas del documento. */
  @Input() annotations: readonly WorkflowAnnotation[] = [];
  /** Cursores de quien más está mirando el mismo workflow. */
  @Input() peers: readonly PeerCursor[] = [];

  @ViewChild('viewport') private viewportRef?: ElementRef<HTMLElement>;

  readonly zoom = signal(1);
  readonly tool = signal<CanvasTool>('select');
  /** Nodo que se está arrastrando: solo ese se promociona a capa propia. */
  readonly draggingId = signal<string | null>(null);

  private pan: PanState | null = null;
  private nodeDrag: NodeDragState | null = null;
  private annotationDrag: AnnotationDragState | null = null;

  /** Anotación seleccionada: la que enseña su barra y llena el panel de Propiedades. */
  readonly activeAnnotationId = signal<string | null>(null);
  /** Nota que se está escribiendo (no se arrastra mientras se escribe). */
  readonly editingAnnotationId = signal<string | null>(null);
  noteClasses = noteColorClasses;
  toPath = pointsToPath;
  strokeWidth = strokeWidthFor;
  fontSize = fontSizeFor;
  fontFamily = fontFamilyFor;

  /** Tinta y grosor con los que se crea lo siguiente. Se ajustan luego en Propiedades. */
  readonly inkColors = INK_COLORS;
  readonly inkSizes = INK_SIZES;
  readonly ink = signal<string>(INK_COLORS[0]);
  readonly inkSize = signal<WorkflowInkSize>('M');
  /** Se muestra la paleta solo con una herramienta de trazo activa. */
  readonly showInkBar = computed(() => {
    const tool = this.tool();
    return tool === 'draw' || tool === 'arrow' || tool === 'rect' || tool === 'text';
  });

  /** Las que son cajas (nota, texto, imagen): van como divs posicionados. */
  boxAnnotations(): WorkflowAnnotation[] {
    return this.annotations.filter(a => a.kind === 'note' || a.kind === 'text' || a.kind === 'image');
  }

  /** Las que son formas: van al SVG, con coordenadas absolutas del lienzo. */
  inkAnnotations(): WorkflowAnnotation[] {
    return this.annotations.filter(a => a.kind === 'draw' || a.kind === 'arrow' || a.kind === 'rect');
  }

  /** Cada flecha necesita su propio marker: el color de la punta es el suyo. */
  arrowAnnotations(): WorkflowAnnotation[] {
    return this.annotations.filter(a => a.kind === 'arrow');
  }

  /** Herramientas de anotación, en el orden de la barra. */
  readonly drawTools: ReadonlyArray<{ id: CanvasTool; icon: string; label: string }> = [
    { id: 'draw', icon: 'brush-outline', label: 'Draw' },
    { id: 'arrow', icon: 'arrow-forward-outline', label: 'Arrow' },
    { id: 'rect', icon: 'square-outline', label: 'Frame' },
    { id: 'text', icon: 'text-outline', label: 'Text' },
    { id: 'note', icon: 'reader-outline', label: 'Sticky note' },
    { id: 'eraser', icon: 'trash-bin-outline', label: 'Erase' },
  ];

  min = Math.min;
  abs = Math.abs;

  /** Boceto en curso (trazo, flecha o marco), para pintarlo mientras se arrastra. */
  readonly sketch = signal<SketchState | null>(null);

  /** Path del trazo en curso — el mismo formato que el ya confirmado. */
  readonly sketchPath = computed(() => {
    const current = this.sketch();
    return current && current.tool === 'draw' ? pointsToPath(current.points) : '';
  });

  /**
   * Throttle a un frame.
   *
   * `pointermove` dispara más veces de las que el navegador pinta, así que sin
   * esto se recalculaba el layout entero (nodos, conectores y paths) varias
   * veces por frame para tirar todo salvo el último resultado. Se guarda solo
   * el ÚLTIMO callback pendiente y se ejecuta una vez por frame.
   */
  private queuedMove: (() => void) | null = null;
  private rafId: number | null = null;

  private scheduleFrame(callback: () => void): void {
    this.queuedMove = callback;
    if (this.rafId !== null) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const pending = this.queuedMove;
      this.queuedMove = null;
      pending?.();
    });
  }

  /**
   * Throttle propio para el cursor. No puede compartir el hueco de `scheduleFrame`: ese
   * guarda UN solo callback pendiente, así que publicar el cursor ahí se comería el frame
   * del arrastre (o al revés) y una de las dos cosas se quedaría a medias.
   */
  private cursorRaf: number | null = null;
  private cursorPoint: { x: number; y: number } | null = null;

  private publishCursor(clientX: number, clientY: number): void {
    this.cursorPoint = { x: clientX, y: clientY };
    if (this.cursorRaf !== null) {
      return;
    }
    this.cursorRaf = requestAnimationFrame(() => {
      this.cursorRaf = null;
      const pending = this.cursorPoint;
      this.cursorPoint = null;
      if (pending) {
        this.cursorMoved.emit(this.toCanvas(pending.x, pending.y));
      }
    });
  }

  private cancelFrame(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.queuedMove = null;
  }

  ngOnDestroy(): void {
    this.cancelFrame();
    if (this.cursorRaf !== null) {
      cancelAnimationFrame(this.cursorRaf);
    }
  }

  /**
   * Pantalla → lienzo. Hay que descontar el scroll del viewport y **dividir
   * por el zoom**: el `stage` está escalado con `transform`, así que un píxel
   * de pantalla no es un píxel de lienzo.
   */
  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport) {
      return { x: 0, y: 0 };
    }
    const rect = viewport.getBoundingClientRect();
    const zoom = this.zoom();
    return {
      x: (clientX - rect.left + viewport.scrollLeft) / zoom,
      y: (clientY - rect.top + viewport.scrollTop) / zoom,
    };
  }

  /** Arrastre de un nodo. Con la herramienta mano activa manda el pan. */
  startNodeDrag(event: PointerEvent, node: PositionedNode): void {
    if (this.tool() === 'pan') {
      return;
    }
    event.stopPropagation();
    // Ata el puntero al elemento: los eventos siguen llegando aunque el cursor
    // se salga del nodo o del viewport, que es el fallo clásico del arrastre.
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = this.toCanvas(event.clientX, event.clientY);
    this.nodeDrag = {
      pointerId: event.pointerId,
      stepId: node.step.id,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
      moved: false,
    };
    this.draggingId.set(node.step.id);
    this.moveStepStart.emit();
  }

  /**
   * Arranca un trazo, una flecha o un marco. Se engancha en el `pointerdown` del lienzo,
   * ANTES que el pan: con una herramienta de dibujo activa, arrastrar dibuja, no desplaza.
   */
  startSketch(event: PointerEvent): boolean {
    const tool = this.tool();
    if (tool !== 'draw' && tool !== 'arrow' && tool !== 'rect') {
      return false;
    }
    const point = this.toCanvas(event.clientX, event.clientY);
    this.sketch.set({
      pointerId: event.pointerId,
      tool,
      startX: point.x,
      startY: point.y,
      points: [point.x, point.y],
      currentX: point.x,
      currentY: point.y,
    });
    return true;
  }

  /** Cierra el gesto y lo manda al store. Un gesto demasiado corto se descarta allí. */
  private endSketch(): void {
    const current = this.sketch();
    this.sketch.set(null);
    if (!current) {
      return;
    }
    const stroke = this.ink();
    const size = this.inkSize();
    if (current.tool === 'draw') {
      this.addDrawing.emit({ points: current.points, stroke, size });
    } else if (current.tool === 'arrow') {
      this.addArrow.emit({
        fromX: current.startX, fromY: current.startY,
        toX: current.currentX, toY: current.currentY, stroke, size,
      });
    } else {
      this.addRect.emit({
        x: current.startX, y: current.startY,
        width: current.currentX - current.startX,
        height: current.currentY - current.startY,
        stroke, size,
      });
    }
    // La herramienta se queda activa: dibujar suele venir en tandas.
  }

  /** Arrastre de una nota o imagen. Con la mano activa manda el pan; escribiendo, no se mueve. */
  startAnnotationDrag(event: PointerEvent, annotation: WorkflowAnnotation): void {
    if (this.tool() === 'pan' || this.editingAnnotationId() === annotation.id) {
      return;
    }
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = this.toCanvas(event.clientX, event.clientY);
    this.annotationDrag = {
      pointerId: event.pointerId,
      id: annotation.id,
      offsetX: point.x - annotation.x,
      offsetY: point.y - annotation.y,
      moved: false,
    };
    this.selectAnnotation(annotation.id);
    this.moveStepStart.emit();
  }

  /**
   * Clic en el lienzo vacío. Con la herramienta `note` coloca una nota AHÍ, que es lo que
   * se espera de una herramienta de colocar; con `select` solo deselecciona.
   */
  onCanvasClick(event: MouseEvent): void {
    const tool = this.tool();
    if (tool === 'note') {
      const point = this.toCanvas(event.clientX, event.clientY);
      // Se centra en el cursor, como el drop del catálogo.
      this.addNote.emit({ x: point.x - 110, y: point.y - 90 });
      this.tool.set('select');
      return;
    }
    if (tool === 'text') {
      const point = this.toCanvas(event.clientX, event.clientY);
      this.addText.emit({ x: point.x, y: point.y - 16, stroke: this.ink(), size: this.inkSize() });
      this.tool.set('select');
      return;
    }
    this.selectAnnotation(null);
    this.editingAnnotationId.set(null);
  }

  /** Punto único de selección: mantiene el panel y el lienzo diciendo lo mismo. */
  selectAnnotation(id: string | null): void {
    this.activeAnnotationId.set(id);
    this.annotationSelected.emit(id);
  }

  /**
   * Clic sobre una anotación. Con la goma borra; si no, la selecciona para el panel de
   * propiedades. Un arrastre recién terminado no cuenta como clic.
   */
  onAnnotationClick(event: MouseEvent, annotation: WorkflowAnnotation): void {
    event.stopPropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.tool() === 'eraser') {
      this.removeAnnotation.emit(annotation.id);
      return;
    }
    this.selectAnnotation(annotation.id);
  }

  /** Coloca la imagen en el centro de lo que se está viendo, no en una esquina cualquiera. */
  requestImage(): void {
    this.pickImage.emit(this.viewportCenter());
  }

  requestNoteAtCenter(): void {
    const center = this.viewportCenter();
    this.addNote.emit({ x: center.x - 110, y: center.y - 90 });
  }

  private viewportCenter(): { x: number; y: number } {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport) {
      return { x: 0, y: 0 };
    }
    const zoom = this.zoom();
    return {
      x: (viewport.scrollLeft + viewport.clientWidth / 2) / zoom,
      y: (viewport.scrollTop + viewport.clientHeight / 2) / zoom,
    };
  }

  onNoteInput(annotation: WorkflowAnnotation, event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.updateAnnotation.emit({ id: annotation.id, patch: { text } });
  }

  trackAnnotation = (_index: number, annotation: WorkflowAnnotation): string => annotation.id;
  trackPeer = (_index: number, peer: PeerCursor): string => peer.userId;

  /** Recibe el tipo soltado desde el catálogo y lo sitúa bajo el cursor. */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    const typeId = event.dataTransfer?.getData('text/workflow-step');
    if (!typeId) {
      return;
    }
    const point = this.toCanvas(event.clientX, event.clientY);
    // Se centra en el cursor: es donde el usuario "ve" el paso al soltarlo.
    this.dropStep.emit({ typeId, x: point.x - 142, y: point.y - 40 });
  }

  allowDrop(event: DragEvent): void {
    // Sin esto el navegador rechaza el drop.
    event.preventDefault();
  }

  trackNode = (_index: number, node: PositionedNode): string => node.step.id;
  trackConnector = (_index: number, connector: Connector): string => connector.id;

  zoomPercent(): number {
    return Math.round(this.zoom() * 100);
  }

  canZoomIn(): boolean {
    return this.zoom() < ZOOM_MAX;
  }

  canZoomOut(): boolean {
    return this.zoom() > ZOOM_MIN;
  }

  /** El zoom se ancla al centro del viewport para que no salte el contenido. */
  zoomBy(delta: number): void {
    const before = this.zoom();
    const after = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((before + delta) * 10) / 10));
    if (after === before) {
      return;
    }
    const viewport = this.viewportRef?.nativeElement;
    this.zoom.set(after);
    if (!viewport) {
      return;
    }
    const ratio = after / before;
    const halfW = viewport.clientWidth / 2;
    const halfH = viewport.clientHeight / 2;
    viewport.scrollLeft = (viewport.scrollLeft + halfW) * ratio - halfW;
    viewport.scrollTop = (viewport.scrollTop + halfH) * ratio - halfH;
  }

  /** Ajusta el zoom para que quepa el diagrama entero. */
  fit(): void {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport || !this.layout.width || !this.layout.height) {
      return;
    }
    const scale = Math.min(
      viewport.clientWidth / this.layout.width,
      viewport.clientHeight / this.layout.height,
      1,
    );
    this.zoom.set(Math.max(ZOOM_MIN, Math.round(scale * 10) / 10));
    viewport.scrollTo({ left: 0, top: 0 });
  }

  setTool(tool: CanvasTool): void {
    this.tool.set(tool);
  }

  // ---------- Pan con la herramienta mano ----------

  startPan(event: PointerEvent): void {
    // Con una herramienta de dibujo activa, arrastrar DIBUJA. Se comprueba antes que el
    // pan porque ambos nacen del mismo pointerdown sobre el lienzo.
    if (this.startSketch(event)) {
      event.preventDefault();
      return;
    }
    if (this.tool() !== 'pan') {
      return;
    }
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport) {
      return;
    }
    event.preventDefault();
    this.pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  }

  /** En `document`, no en el elemento: si no, el arrastre se pierde al salirse. */
  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    // Mi cursor se publica SIEMPRE, se esté arrastrando algo o no: es lo que ven los demás.
    this.publishCursor(event.clientX, event.clientY);

    const sketch = this.sketch();
    if (sketch && event.pointerId === sketch.pointerId) {
      const { clientX, clientY } = event;
      this.scheduleFrame(() => {
        const point = this.toCanvas(clientX, clientY);
        this.sketch.set(
          sketch.tool === 'draw'
            ? { ...sketch, points: [...sketch.points, point.x, point.y], currentX: point.x, currentY: point.y }
            : { ...sketch, currentX: point.x, currentY: point.y },
        );
      });
      return;
    }

    const annotation = this.annotationDrag;
    if (annotation && event.pointerId === annotation.pointerId) {
      annotation.moved = true;
      const { clientX, clientY } = event;
      this.scheduleFrame(() => {
        const point = this.toCanvas(clientX, clientY);
        this.moveAnnotationLive.emit({
          id: annotation.id,
          x: point.x - annotation.offsetX,
          y: point.y - annotation.offsetY,
        });
      });
      return;
    }

    const link = this.pendingLink();
    if (link && event.pointerId === this.linkPointerId) {
      const { clientX, clientY } = event;
      this.scheduleFrame(() => {
        const point = this.toCanvas(clientX, clientY);
        this.pendingLink.set({ ...link, toX: point.x, toY: point.y });
      });
      return;
    }

    const drag = this.nodeDrag;
    if (drag && event.pointerId === drag.pointerId) {
      drag.moved = true;
      const { clientX, clientY } = event;
      this.scheduleFrame(() => {
        const point = this.toCanvas(clientX, clientY);
        this.moveStepLive.emit({ id: drag.stepId, x: point.x - drag.offsetX, y: point.y - drag.offsetY });
      });
      return;
    }

    const pan = this.pan;
    const viewport = this.viewportRef?.nativeElement;
    if (!pan || !viewport || event.pointerId !== pan.pointerId) {
      return;
    }
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onPointerUp(): void {
    if (this.pendingLink()) {
      // Soltar fuera de una carta cancela el hilo, sin dejar estado colgando.
      this.pendingLink.set(null);
      this.linkPointerId = null;
      this.cancelFrame();
    }
    if (this.sketch()) {
      this.cancelFrame();
      this.endSketch();
    }
    if (this.annotationDrag) {
      this.cancelFrame();
      this.moveStepEnd.emit();
      this.suppressClick = this.annotationDrag.moved;
      this.annotationDrag = null;
    }
    if (this.nodeDrag) {
      this.cancelFrame();
      this.draggingId.set(null);
      this.moveStepEnd.emit();
      // Un arrastre no debe además "seleccionar": el clic que sigue al
      // pointerup se ignora si el nodo llegó a moverse.
      this.suppressClick = this.nodeDrag.moved;
      this.nodeDrag = null;
    }
    this.pan = null;
  }

  /** true justo después de un arrastre, para no tratarlo como clic. */
  private suppressClick = false;

  /**
   * Escape cancela el hilo en curso; Supr borra el hilo seleccionado. Sin esto
   * la única salida era soltar en el vacío o buscar el botón con el ratón.
   */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.pendingLink()) {
      this.pendingLink.set(null);
      this.linkPointerId = null;
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedConnectionId && !typing) {
      event.preventDefault();
      this.deleteConnection.emit(this.selectedConnectionId);
    }
  }

  onNodeClick(stepId: string): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.selectStep.emit(stepId);
  }

  /** `+` sobre un hilo: mete un paso entre esas dos cartas. */
  onInsert(connector: Connector, event: MouseEvent): void {
    event.stopPropagation();
    this.insertStep.emit({ fromStepId: connector.fromStepId, fromPort: connector.fromPort });
  }

  /** `+` de una salida libre: cuelga un paso nuevo de ahí. */
  onInsertOpenEnd(openEnd: OpenEnd, event: MouseEvent): void {
    event.stopPropagation();
    this.insertStep.emit({ fromStepId: openEnd.stepId, fromPort: openEnd.port });
  }

  onConnectorClick(connector: Connector, event: MouseEvent): void {
    event.stopPropagation();
    this.selectConnection.emit(connector.id);
  }

  trackOpenEnd = (_index: number, openEnd: OpenEnd): string => openEnd.id;

  // ---------- Tirar un hilo de puerto a puerto ----------

  readonly pendingLink = signal<PendingLink | null>(null);
  private linkPointerId: number | null = null;

  startLink(event: PointerEvent, node: PositionedNode, portId: string): void {
    event.stopPropagation();
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.linkPointerId = event.pointerId;
    const anchor = node.outputs.find(port => port.portId === portId) ?? node.outputs[0];
    this.pendingLink.set({
      fromStepId: node.step.id,
      fromPort: portId,
      x: anchor.x,
      y: anchor.y,
      toX: anchor.x,
      toY: anchor.y,
    });
  }

  /** Path del hilo en curso, del puerto al cursor. */
  pendingPath(): string {
    const link = this.pendingLink();
    return link ? `M ${link.x} ${link.y} L ${link.toX} ${link.toY}` : '';
  }

  /** Suelta el hilo sobre una carta: ahí se decide si la conexión vale. */
  finishLinkOn(node: PositionedNode, event: PointerEvent): void {
    const link = this.pendingLink();
    if (!link) {
      return;
    }
    event.stopPropagation();
    this.connectSteps.emit({ fromStepId: link.fromStepId, fromPort: link.fromPort, toStepId: node.step.id });
    this.pendingLink.set(null);
    this.linkPointerId = null;
  }
}

/** Puntos aplanados → path SVG. Formato compartido por el trazo en curso y el guardado. */
export function pointsToPath(points: readonly number[]): string {
  if (points.length < 4) {
    return '';
  }
  const parts: string[] = [`M ${points[0]} ${points[1]}`];
  for (let i = 2; i < points.length; i += 2) {
    parts.push(`L ${points[i]} ${points[i + 1]}`);
  }
  return parts.join(' ');
}
