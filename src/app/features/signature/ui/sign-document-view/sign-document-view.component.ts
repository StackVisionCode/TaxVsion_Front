import { labelDisplayText, linkHost, parseFieldLabel } from '../../utils/field-label-link.util';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PublicSignerFieldView, PublicStampStyleView } from '../../data-access/public-signature.model';
import { fitWrappedText, startingFontSize } from '../../utils/stamp-font-size.util';

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

export interface FieldSelection {
  fieldId: string;
  page: number;
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
 * El PDF público llega validado por token y se renderiza debajo de los campos. Si una
 * imagen no está disponible, se muestra un estado explícito; nunca una hoja vacía que
 * pueda confundirse con el documento original.
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

  /** Documento activo. Evita que un caller pueda mezclar campos de dos PDFs. */
  @Input() documentId = '';
  @Input() fields: PublicSignerFieldView[] = [];
  /** Texto escrito por el firmante, indexado por `fieldId`. */
  @Input() values: Record<string, string> = {};
  /** false = solo lectura (paso de revisión). */
  @Input() editable = false;
  /** Imagen (data URL) de cada página, indexada por número de página. null = hoja en blanco. */
  @Input() pageImages: Record<number, string> | null = null;
  @Input() pageAspectRatios: Record<number, number> | null = null;
  /** Ancho de cada página en pt del PDF (null = sin vista previa del tamaño). */
  @Input() pageWidthsPt: Record<number, number> | null = null;
  /** Regla de la letra del estampado que manda el backend con la vista pública. */
  @Input() stampStyle: PublicStampStyleView | null = null;
  @Input() zoomPercent = 100;
  @Input() selectedFieldId: string | null = null;

  @Output() valueChange = new EventEmitter<FieldValueChange>();
  @Output() fieldSelect = new EventEmitter<FieldSelection>();

  readonly maxLength = FIELD_VALUE_MAX_LENGTH;

  pages: SignDocumentPage[] = [];
  textFieldCount = 0;

  // Solo recomputamos cuando CAMBIAN los campos. Antes recomputábamos en cualquier @Input (también
  // `values`), lo que recreaba el array `pages` en cada tecla y Angular destruía los <input>, que
  // perdían el foco. Ahora `values` sólo refleja el ngModel y los inputs se mantienen vivos.
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['fields'] && !changes['documentId'] && !changes['pageImages']) {
      return;
    }
    const activeFields = this.documentId
      ? this.fields.filter((field) => field.documentId === this.documentId)
      : this.fields;
    const fieldsByPage = new Map(
      groupFieldsByPage(activeFields).map((page) => [page.page, page.fields]),
    );
    const pageNumbers = new Set<number>([
      ...fieldsByPage.keys(),
      ...Object.keys(this.pageImages ?? {})
        .map(Number)
        .filter(Number.isFinite),
    ]);
    this.pages = [...pageNumbers]
      .sort((left, right) => left - right)
      .map((page) => ({ page, fields: fieldsByPage.get(page) ?? [] }));
    this.textFieldCount = activeFields.filter((f) => f.kind === 'Text').length;
  }

  /** Requeridos de texto aún vacíos (lo que falta para poder firmar). */
  get pendingRequired(): number {
    return this.activeFields().filter(
      (f) => f.kind === 'Text' && f.isRequired && !this.values[f.id]?.trim(),
    ).length;
  }

  trackField(_: number, field: PublicSignerFieldView): string {
    return field.id;
  }

  onInput(field: PublicSignerFieldView, value: string): void {
    this.valueChange.emit({ fieldId: field.id, value });
  }

  selectField(field: PublicSignerFieldView): void {
    this.fieldSelect.emit({ fieldId: field.id, page: field.page });
  }

  scrollToField(fieldId: string): void {
    const element = this.host.nativeElement.querySelector(
      `[data-field-id="${fieldId}"]`,
    ) as HTMLElement | null;
    element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    element?.focus({ preventScroll: true });
  }

  /** Lleva el foco al siguiente campo de texto requerido sin completar. */
  focusNextPending(): void {
    const next = this.activeFields()
      .filter((f) => f.kind === 'Text' && f.isRequired && !this.values[f.id]?.trim())
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

  private activeFields(): PublicSignerFieldView[] {
    return this.documentId
      ? this.fields.filter((field) => field.documentId === this.documentId)
      : this.fields;
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

  /** Etiqueta del campo como enlace (en crudo o enmascarada); solo http/https. */
  labelLink(field: PublicSignerFieldView) {
    return parseFieldLabel(field.label);
  }

  /** Texto de la etiqueta: el del enlace enmascarado, o la etiqueta tal cual. */
  labelText(field: PublicSignerFieldView): string {
    return labelDisplayText(field.label);
  }

  linkHost(url: string | null): string {
    return linkHost(url);
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
        return this.labelText(field) || 'Checkbox';
      default:
        return this.labelText(field) || 'Text';
    }
  }

  /**
   * Letra del texto en pantalla = la que tendrá en el PDF sellado (misma regla que el sellador:
   * elegida o automática según la caja, achicada si lo escrito no cabe). En `cqw` del ancho de la
   * hoja, así acompaña al zoom. null = sin datos de la página: se queda la letra de la UI.
   */
  textFontSize(field: PublicSignerFieldView): string | null {
    const widthPt = this.pageWidthsPt?.[field.page];
    const ratio = this.pageAspectRatios?.[field.page];
    const style = this.stampStyle;
    if (!widthPt || !ratio || !style) {
      return null;
    }
    const box = { widthPt: field.width * widthPt, heightPt: field.height * (widthPt / ratio) };
    const start = startingFontSize(field.fontSizePt, box.heightPt, style);
    const value = this.values[field.id]?.trim();
    const pt = value ? fitWrappedText(value, start, box, style) : start;
    return `${((pt / widthPt) * 100).toFixed(4)}cqw`;
  }

  /** Posición del campo en % de la hoja (el navegador escala solo con el ancho). */
  boxStyle(field: PublicSignerFieldView): Record<string, string> {
    const pct = (value: number): string => `${Math.min(Math.max(value, 0), 1) * 100}%`;
    return {
      left: pct(field.x),
      top: pct(field.y),
      width: pct(field.width),
      height: pct(field.height),
    };
  }

  pageStyle(page: number): Record<string, string> {
    const ratio = this.pageAspectRatios?.[page];
    return {
      width: `${this.zoomPercent}%`,
      '--page-aspect-ratio': ratio && ratio > 0 ? `${ratio}` : '8.5 / 11',
    };
  }
}
