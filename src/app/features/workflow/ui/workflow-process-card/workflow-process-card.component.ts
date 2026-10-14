import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { PreviewStepView } from '../../data-access/workflow-preview.service';
import { stepTypeOrFallback } from '../../data-access/workflow.model';
import {
  ADD_ROW_HEIGHT,
  EXIT_ROW_HEIGHT,
  ExitSlot,
  HEADER_HEIGHT,
  PROCESS_PAD,
  ProcessBox,
  START_LABEL_HEIGHT,
  StepSlot,
} from '../../utils/workflow-process-layout.util';

/** Otro proceso al que se puede saltar desde una salida. */
export interface ExitTarget {
  id: string;
  name: string;
  /** Un proceso vacío no se puede enlazar: no hay primer paso al que entrar. */
  disabled: boolean;
}

/** Dónde insertar el paso nuevo. */
export interface InsertRequest {
  processId: string;
  /** Posición dentro del proceso; `null` = al final. */
  index: number | null;
}

/**
 * Tarjeta de un proceso en el lienzo: cabecera, pasos, `+` de inserción y salidas.
 *
 * La geometría la manda `layoutProcesses` (todo va con `top` en píxeles, alturas fijas): los
 * hilos entre procesos se anclan a la fila exacta de cada salida y no pueden despegarse. Es
 * presentacional: no conoce el store, solo emite lo que el usuario quiere hacer.
 */
@Component({
  selector: 'app-workflow-process-card',
  imports: [NgClass],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-process-card.component.html',
  styleUrl: './workflow-process-card.component.css',
})
export class WorkflowProcessCardComponent {
  readonly box = input.required<ProcessBox>();
  readonly selectedStepId = input<string | null>(null);
  readonly selected = input(false);
  readonly dragging = input(false);
  /** Overlay de la simulación; null = sin corrida. */
  readonly preview = input<ReadonlyMap<string, PreviewStepView> | null>(null);
  /** Destinos posibles para las salidas (el resto de procesos). */
  readonly targets = input<readonly ExitTarget[]>([]);
  /** Punto de inserción elegido, para marcarlo mientras la paleta espera. */
  readonly pendingIndex = input<number | null | undefined>(undefined);

  readonly select = output<void>();
  readonly selectStep = output<string>();
  readonly insertAt = output<InsertRequest>();
  readonly headerDown = output<PointerEvent>();
  readonly rename = output<string>();
  readonly toggleCollapsed = output<void>();
  readonly duplicateProcess = output<void>();
  readonly deleteProcess = output<void>();
  readonly duplicateStep = output<string>();
  readonly deleteStep = output<string>();
  readonly moveStep = output<{ id: string; delta: -1 | 1 }>();
  readonly connectExit = output<{ stepId: string; port: string; processId: string }>();
  readonly disconnectExit = output<string>();

  protected readonly pad = PROCESS_PAD;
  protected readonly headerHeight = HEADER_HEIGHT;
  protected readonly startLabelHeight = START_LABEL_HEIGHT;
  protected readonly addHeight = ADD_ROW_HEIGHT;
  protected readonly exitHeight = EXIT_ROW_HEIGHT;

  /** Menú abierto: `process`, `step:<id>` o `exit:<id>`. Uno solo a la vez. */
  protected readonly menu = signal<string | null>(null);
  protected readonly renaming = signal(false);

  protected readonly innerWidth = computed(() => this.box().width - PROCESS_PAD * 2);
  protected readonly actionCount = computed(() => this.box().stepCount);
  protected readonly statusLabel = computed(() => {
    switch (this.box().status) {
      case 'needs-setup':
        return 'Needs setup';
      case 'empty':
        return 'Empty';
      default:
        return 'Ready';
    }
  });

  protected readonly collapsedIcons = computed(() => this.box().stepIcons.slice(0, 6));

  protected typeOf(slot: StepSlot) {
    return stepTypeOrFallback(slot.step.typeId);
  }

  /** Clase de color del cuadrito de icono según la categoría del paso. */
  protected tone(slot: StepSlot): string {
    switch (this.typeOf(slot).category) {
      case 'trigger':
        return 'tone-trigger';
      case 'ai-logic':
        return 'tone-logic';
      case 'utility':
        return 'tone-utility';
      default:
        return 'tone-action';
    }
  }

  protected runState(slot: StepSlot): PreviewStepView | null {
    return this.preview()?.get(slot.step.id) ?? null;
  }

  protected missingLabel(slot: StepSlot): string {
    return slot.missing.map(field => field.label).join(', ');
  }

  protected isMenu(key: string): boolean {
    return this.menu() === key;
  }

  protected toggleMenu(key: string, event: Event): void {
    event.stopPropagation();
    this.menu.update(current => (current === key ? null : key));
  }

  protected closeMenu(): void {
    this.menu.set(null);
  }

  protected startRename(event: Event): void {
    event.stopPropagation();
    this.menu.set(null);
    this.renaming.set(true);
  }

  protected commitRename(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.renaming.set(false);
    if (value.trim() && value.trim() !== this.box().process.name) {
      this.rename.emit(value.trim());
    }
  }

  protected pick(exit: ExitSlot, target: ExitTarget, event: Event): void {
    event.stopPropagation();
    this.menu.set(null);
    if (!target.disabled) {
      this.connectExit.emit({ stepId: exit.stepId, port: exit.port, processId: target.id });
    }
  }

  protected disconnect(exit: ExitSlot, event: Event): void {
    event.stopPropagation();
    this.menu.set(null);
    if (exit.connectionId) {
      this.disconnectExit.emit(exit.connectionId);
    }
  }

  protected emitInsert(index: number | null, event: Event): void {
    event.stopPropagation();
    this.insertAt.emit({ processId: this.box().process.id, index });
  }

  protected stopDrag(event: Event): void {
    event.stopPropagation();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.menu() !== null) {
      this.menu.set(null);
    }
  }
}
