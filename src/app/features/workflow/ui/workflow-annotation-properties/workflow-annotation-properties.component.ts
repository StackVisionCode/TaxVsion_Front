import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  INK_COLORS,
  INK_SIZES,
  NOTE_COLORS,
  TEXT_STYLES,
  WorkflowAnnotation,
  WorkflowInkSize,
  WorkflowNoteColor,
  WorkflowTextStyle,
  annotationSupports,
  fontFamilyFor,
  noteColorClasses,
} from '../../data-access/workflow.model';

/**
 * Propiedades del objeto seleccionado del lienzo.
 *
 * Cada sección se pinta SOLO si tiene sentido para ese objeto (`annotationSupports`): una
 * imagen no tiene tinta ni tipografía, y una nota no tiene grosor de trazo. Un panel con
 * controles muertos en gris enseña opciones que no existen y obliga a probar cuál sirve.
 */
@Component({
  selector: 'app-workflow-annotation-properties',
  imports: [NgClass],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-annotation-properties.component.html',
})
export class WorkflowAnnotationPropertiesComponent {
  readonly annotation = input.required<WorkflowAnnotation>();

  readonly patch = output<Partial<WorkflowAnnotation>>();
  readonly remove = output<void>();

  readonly inkColors = INK_COLORS;
  readonly noteColors = NOTE_COLORS;
  readonly sizes = INK_SIZES;
  readonly textStyles = TEXT_STYLES;

  readonly supports = computed(() => annotationSupports(this.annotation().kind));

  /** Nombre humano del objeto, para que la cabecera diga qué se está editando. */
  readonly label = computed(() => {
    switch (this.annotation().kind) {
      case 'note':
        return 'Note';
      case 'image':
        return 'Image';
      case 'draw':
        return 'Drawing';
      case 'arrow':
        return 'Arrow';
      case 'text':
        return 'Text';
      default:
        return 'Frame';
    }
  });

  readonly opacityPercent = computed(() => Math.round((this.annotation().opacity ?? 1) * 100));

  noteClasses = noteColorClasses;
  fontFamily = fontFamilyFor;

  setInk(stroke: string): void {
    this.patch.emit({ stroke });
  }

  setNoteColor(color: WorkflowNoteColor): void {
    this.patch.emit({ color });
  }

  setSize(size: WorkflowInkSize): void {
    this.patch.emit({ size });
  }

  setTextStyle(textStyle: WorkflowTextStyle): void {
    this.patch.emit({ textStyle });
  }

  onOpacity(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.patch.emit({ opacity: Math.min(1, Math.max(0.1, value / 100)) });
  }
}
