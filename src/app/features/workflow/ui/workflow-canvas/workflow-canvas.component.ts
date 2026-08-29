import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkflowBranch } from '../../data-access/workflow.model';
import { Connector, PositionedNode, WorkflowLayout } from '../../utils/workflow-layout.util';
import { WorkflowNodeComponent } from '../workflow-node/workflow-node.component';

export interface InsertRequest {
  parentId: string | null;
  branch: WorkflowBranch | null;
}

export type CanvasTool = 'select' | 'pan';

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
export class WorkflowCanvasComponent {
  @Input({ required: true }) layout!: WorkflowLayout;
  @Input() selectedId: string | null = null;

  @Output() selectStep = new EventEmitter<string>();
  @Output() deleteStep = new EventEmitter<string>();
  @Output() duplicateStep = new EventEmitter<string>();
  @Output() insertStep = new EventEmitter<InsertRequest>();

  @ViewChild('viewport') private viewportRef?: ElementRef<HTMLElement>;

  readonly zoom = signal(1);
  readonly tool = signal<CanvasTool>('select');

  private pan: PanState | null = null;

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
    this.pan = null;
  }

  onInsert(connector: Connector, event: MouseEvent): void {
    event.stopPropagation();
    this.insertStep.emit({ parentId: connector.parentId, branch: connector.branch });
  }
}
