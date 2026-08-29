import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  WORKFLOW_CATEGORY_LABEL,
  WORKFLOW_CATEGORY_ORDER,
  WORKFLOW_STEP_TYPES,
  WorkflowStepCategory,
  WorkflowStepType,
  WorkflowStepTypeId,
} from '../../data-access/workflow.model';

interface PaletteGroup {
  category: WorkflowStepCategory;
  label: string;
  types: WorkflowStepType[];
}

/**
 * Panel "Add Step": catálogo de pasos con buscador.
 *
 * Insertar es **por clic**, no arrastrando. El lienzo vive dentro de un
 * `transform: scale()` y el drag&drop del CDK calcula posiciones contra
 * ancestros transformados, que es una fuente conocida de desalineación. El
 * diseño además muestra un `+` en cada fila y `+` por todo el canvas, así que
 * el clic es también lo que la pantalla sugiere.
 */
@Component({
  selector: 'app-workflow-step-palette',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-step-palette.component.html',
  styleUrl: './workflow-step-palette.component.css',
})
export class WorkflowStepPaletteComponent {
  /** true = hay un punto de inserción elegido en el canvas. */
  @Input() awaitingInsert = false;

  @Output() addStep = new EventEmitter<WorkflowStepTypeId>();
  @Output() collapsedChange = new EventEmitter<boolean>();

  @ViewChild('searchInput') private searchInputRef?: ElementRef<HTMLInputElement>;

  readonly search = signal('');
  readonly collapsed = signal(false);

  readonly groups = computed<PaletteGroup[]>(() => {
    const query = this.search().trim().toLowerCase();
    return WORKFLOW_CATEGORY_ORDER.map(category => ({
      category,
      label: WORKFLOW_CATEGORY_LABEL[category],
      types: WORKFLOW_STEP_TYPES.filter(
        type => type.category === category && (!query || type.label.toLowerCase().includes(query)),
      ),
    })).filter(group => group.types.length > 0);
  });

  readonly isEmpty = computed(() => this.groups().length === 0);

  /** ⌘K / Ctrl+K enfoca el buscador, como indica el atajo del diseño. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.collapsed.set(false);
      // El input puede estar oculto en el mismo tick en que se despliega.
      setTimeout(() => this.searchInputRef?.nativeElement.focus());
    }
  }

  toggleCollapsed(): void {
    this.collapsed.update(value => !value);
    this.collapsedChange.emit(this.collapsed());
  }
}
