import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkflowStep, stepTypeOrFallback, summaryPairs } from '../../data-access/workflow.model';
import { PositionedNode } from '../../utils/workflow-layout.util';

/**
 * Tarjeta de un paso en el canvas.
 *
 * La **altura la manda el layout**, no el contenido: se aplica con
 * `[style.height.px]` porque los conectores se calcularon contra esa medida.
 * Si el contenido decidiera el alto, las líneas se despegarían de las
 * tarjetas en cuanto un texto ocupara dos renglones.
 *
 * Presentacional puro: no conoce el store.
 */
@Component({
  selector: 'app-workflow-node',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-node.component.html',
  styleUrl: './workflow-node.component.css',
})
export class WorkflowNodeComponent {
  @Input({ required: true }) node!: PositionedNode;
  @Input() selected = false;
  /** true mientras se arrastra: promociona el nodo a su propia capa. */
  @Input() dragging = false;
  /** true mientras se tira un hilo: la carta se marca como destino posible. */
  @Input() linking = false;

  @Output() selectStep = new EventEmitter<string>();
  @Output() deleteStep = new EventEmitter<string>();
  @Output() duplicateStep = new EventEmitter<string>();
  /** El arrastre lo gestiona el canvas, que es quien conoce zoom y scroll. */
  @Output() dragStart = new EventEmitter<PointerEvent>();

  readonly menuOpen = signal(false);

  get step(): WorkflowStep {
    return this.node.step;
  }

  get type() {
    return stepTypeOrFallback(this.step.typeId);
  }

  get pairs(): { label: string; value: string }[] {
    return summaryPairs(this.step);
  }

  /** Resumen de conexiones: "2 in · 1 out". */
  get degreeLabel(): string {
    return `${this.node.inDegree} in · ${this.node.outDegree} out`;
  }

  /** Datos que la carta necesita y nadie le manda. */
  get missingLabel(): string {
    return this.node.missing.map(field => field.label).join(', ');
  }

  /** El menú se cierra al pulsar fuera; el `data-dropdown` lo identifica. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest(`[data-dropdown="node-${this.step.id}"]`)) {
      this.menuOpen.set(false);
    }
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update(open => !open);
  }

  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.set(false);
    this.deleteStep.emit(this.step.id);
  }

  onDuplicate(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.set(false);
    this.duplicateStep.emit(this.step.id);
  }
}
