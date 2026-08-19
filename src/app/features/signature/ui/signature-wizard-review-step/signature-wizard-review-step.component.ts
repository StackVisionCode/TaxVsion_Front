import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EditorSigner,
  FieldType,
  PlacedField,
  RequestRules,
  WizardClient,
  WizardDocKind,
  WizardDocument,
} from '../signature-request-panel/signature-wizard.model';
import {
  CHANNEL_META,
  FIELD_TYPE_ICON,
  FIELD_TYPE_LABEL,
  clientTypeBadge,
  initialsOf,
  kindChip,
  kindCircle,
  kindIcon,
} from '../signature-request-panel/signature-wizard.mock';

const FIELD_TYPE_ORDER: FieldType[] = ['signature', 'initials', 'date', 'text'];

/**
 * Paso 4 del wizard: resumen de todo lo elegido (cliente, documento, firmantes
 * con su desglose de campos) + fecha límite y notas, antes de enviar.
 * Presentacional puro: recibe snapshots por @Input y emite cambios de
 * dueDate/notes por @Output (two-way con el panel).
 */
@Component({
  selector: 'app-signature-wizard-review-step',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-review-step.component.html',
  styleUrl: './signature-wizard-review-step.component.css',
})
export class SignatureWizardReviewStepComponent {
  @Input() client: WizardClient | null = null;
  @Input() document: WizardDocument | null = null;
  @Input() signers: EditorSigner[] = [];
  @Input() fields: PlacedField[] = [];
  @Input() rules: RequestRules | null = null;
  @Input() dueDate = '';
  @Input() notes = '';
  @Output() dueDateChange = new EventEmitter<string>();
  @Output() notesChange = new EventEmitter<string>();

  readonly fieldIcon = FIELD_TYPE_ICON;
  readonly channelMeta = CHANNEL_META;

  /** Etiquetas de los canales habilitados, para la tarjeta de reglas. */
  channelLabels(): string {
    return (this.rules?.channels ?? []).map(ch => CHANNEL_META[ch].label).join(' · ');
  }

  initials(name: string): string {
    return initialsOf(name);
  }

  typeBadge(client: WizardClient): string {
    return clientTypeBadge(client.type);
  }

  circle(kind: WizardDocKind): string {
    return kindCircle(kind);
  }

  chip(kind: WizardDocKind): string {
    return kindChip(kind);
  }

  icon(kind: WizardDocKind): string {
    return kindIcon(kind);
  }

  totalFields(): number {
    return this.fields.length;
  }

  fieldCountFor(signerId: string): number {
    return this.fields.filter(field => field.signerId === signerId).length;
  }

  /** Desglose "2 Signature · 1 Date" de los campos de un firmante. */
  fieldSummaryFor(signerId: string): string {
    const counts = new Map<FieldType, number>();
    for (const field of this.fields) {
      if (field.signerId === signerId) {
        counts.set(field.type, (counts.get(field.type) ?? 0) + 1);
      }
    }
    return FIELD_TYPE_ORDER.filter(type => counts.has(type))
      .map(type => `${counts.get(type)} ${FIELD_TYPE_LABEL[type]}`)
      .join(' · ');
  }

  signersWithoutFields(): EditorSigner[] {
    return this.signers.filter(signer => this.fieldCountFor(signer.id) === 0);
  }

  dueDateLabel(): string {
    if (!this.dueDate) {
      return 'Today';
    }
    return new Date(`${this.dueDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
