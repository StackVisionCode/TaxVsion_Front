import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PublicSignerFieldView } from '../../data-access/public-signature.model';

/** Mismo tope que `SignatureFieldValue.MaxLength` en el backend. */
export const FIELD_VALUE_MAX_LENGTH = 500;

export interface SignDocumentPage {
  page: number;
  fields: PublicSignerFieldView[];
}

export interface FieldValueChange {
  fieldId: string;
  value: string;
}

/** Agrupa los campos del firmante por página (1-based), en orden de página y de lectura. */
export function groupFieldsByPage(fields: readonly PublicSignerFieldView[]): SignDocumentPage[] {
  const byPage = new Map<number, PublicSignerFieldView[]>();
  for (const field of fields) {
    const list = byPage.get(field.page) ?? [];
    list.push(field);
    byPage.set(field.page, list);
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, list]) => ({ page, fields: [...list].sort((a, b) => a.y - b.y || a.x - b.x) }));
}

/**
 * Hojas del documento con los campos del firmante en su posición real (coordenadas
 * normalizadas 0..1, origen arriba-izquierda, como las guarda el editor del preparador).
 * Los campos `Text` son inputs donde el firmante escribe directamente sobre la página;
 * firma, iniciales y fecha se marcan como recuadros.
 *
 * El contrato público NO sirve el PDF al firmante anónimo (solo `originalFileId`, y
 * CloudStorage exige JWT), así que por defecto la hoja es un lienzo en blanco con
 * proporción Letter. Cuando el backend exponga el documento, basta con pasar
 * `pageImages` (p. ej. renderizado con `renderPdfPages`) y cada hoja lo usa de fondo.
 */
@Component({
  selector: 'app-sign-document-view',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sign-document-view.component.html',
  styleUrl: './sign-document-view.component.css',
})
export class SignDocumentViewComponent implements OnChanges {
  private readonly host = inject(ElementRef<HTMLElement>);

  @Input() fields: PublicSignerFieldView[] = [];
  /** Texto escrito por el firmante, indexado por `fieldId`. */
  @Input() values: Record<string, string> = {};
  /** false = solo lectura (paso de revisión). */
  @Input() editable = false;
  /** Imagen (data URL) de cada página, indexada por número de página. null = hoja en blanco. */
  @Input() pageImages: Record<number, string> | null = null;

  @Output() valueChange = new EventEmitter<FieldValueChange>();

  readonly maxLength = FIELD_VALUE_MAX_LENGTH;

  pages: SignDocumentPage[] = [];
  textFieldCount = 0;

  ngOnChanges(): void {
    this.pages = groupFieldsByPage(this.fields);
    this.textFieldCount = this.fields.filter(f => f.kind === 'Text').length;
  }

  /** Requeridos de texto aún vacíos (lo que falta para poder firmar). */
  get pendingRequired(): number {
    return this.fields.filter(f => f.kind === 'Text' && f.isRequired && !this.values[f.id]?.trim()).length;
  }

  trackField(_: number, field: PublicSignerFieldView): string {
    return field.id;
  }

  onInput(field: PublicSignerFieldView, value: string): void {
    this.valueChange.emit({ fieldId: field.id, value });
  }

  /** Lleva el foco al siguiente campo de texto requerido sin completar. */
  focusNextPending(): void {
    const next = this.fields
      .filter(f => f.kind === 'Text' && f.isRequired && !this.values[f.id]?.trim())
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)[0];
    if (!next) {
      return;
    }
    const input = (this.host.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      `[data-field-id="${next.id}"]`,
    );
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
  }

  kindIcon(field: PublicSignerFieldView): string {
    switch (field.kind) {
      case 'Signature':
        return 'create-outline';
      case 'Initials':
        return 'text-outline';
      case 'Date':
        return 'calendar-outline';
      case 'Checkbox':
        return 'checkbox-outline';
      default:
        return 'document-text-outline';
    }
  }

  kindLabel(field: PublicSignerFieldView): string {
    switch (field.kind) {
      case 'Signature':
        return 'Sign here';
      case 'Initials':
        return 'Initials';
      case 'Date':
        return 'Date · automatic';
      case 'Checkbox':
        return field.label || 'Checkbox';
      default:
        return field.label || 'Text';
    }
  }

  /** Posición del campo en % de la hoja (el navegador escala solo con el ancho). */
  boxStyle(field: PublicSignerFieldView): Record<string, string> {
    const pct = (value: number): string => `${Math.min(Math.max(value, 0), 1) * 100}%`;
    return { left: pct(field.x), top: pct(field.y), width: pct(field.width), height: pct(field.height) };
  }
}
