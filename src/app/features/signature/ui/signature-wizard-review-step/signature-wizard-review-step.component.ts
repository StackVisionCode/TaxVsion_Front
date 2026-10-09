import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EditorSigner,
  FieldType,
  PREPARER_PARTY_ID,
  PlacedField,
  RequestRules,
  VerificationChannel,
  WizardClient,
  WizardDocKind,
  WizardDocument,
} from '../signature-request-panel/signature-wizard.model';
import {
  CHANNEL_META,
  FIELD_TYPE_ICON,
  FIELD_TYPE_LABEL,
  clientTypeBadge,
  kindChip,
  kindCircle,
  kindIcon,
} from '../signature-request-panel/signature-wizard.presenter';
import { SignatureCategory } from '../../data-access/signature.model';
import { SignatureCategoryPickerComponent } from '../signature-category-picker/signature-category-picker.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import {
  ToggleableRule,
  isPartialCopyAudienceInvalid,
  isSigningPinInvalid,
  reminderIntervalDays,
  togglePartialCopyRecipient,
  toggleRule,
  withDefaultChannel,
  withPartialCopyAudienceKind,
  withReminderIntervalDays,
  withSequential,
  withSigningPin,
} from '../../utils/request-rules.util';
import { signersMissingSignature } from '../../utils/editor-fields.util';

const FIELD_TYPE_ORDER: FieldType[] = ['signature', 'initials', 'date', 'text'];

/**
 * Paso 4 del wizard: resumen de todo lo elegido (cliente, documento, firmantes
 * con su desglose de campos) + los datos reales de POST /signature/requests:
 * título, categoría legal (SignatureCategory), fecha límite (→ tokenExpirationHours)
 * y descripción. Presentacional puro: recibe snapshots por @Input y emite cambios
 * por @Output (two-way con el panel).
 *
 * Reglas de la solicitud (antes en la columna derecha del editor): orden de firma, canal por
 * defecto, recordatorio + intervalo, certificado, entregas (solo con `canDeliverDocs`, el mismo
 * permiso `signature.document.send` que ya evaluaba el editor) y PIN. Emite `rulesChange` con el
 * objeto completo (transformaciones de request-rules.util, idénticas a las del editor); el panel lo
 * vuelve a poner en el mismo signal del editor, así el payload no cambia. `goToSigner` lleva al
 * editor con ese firmante activo (lista "Before you send").
 */
@Component({
  selector: 'app-signature-wizard-review-step',
  imports: [CommonModule, FormsModule, SignatureCategoryPickerComponent, AvatarComponent, SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-wizard-review-step.component.html',
  styleUrl: './signature-wizard-review-step.component.css',
})
export class SignatureWizardReviewStepComponent {
  @Input() client: WizardClient | null = null;
  @Input() document: WizardDocument | null = null;
  @Input() documents: WizardDocument[] = [];
  @Input() signers: EditorSigner[] = [];
  @Input() fields: PlacedField[] = [];
  @Input() rules: RequestRules | null = null;
  @Input() title = '';
  @Input() category: SignatureCategory = 'Fiscal';
  @Input() dueDate = '';
  @Input() notes = '';
  @Output() titleChange = new EventEmitter<string>();
  @Output() categoryChange = new EventEmitter<SignatureCategory>();
  @Output() dueDateChange = new EventEmitter<string>();
  @Output() notesChange = new EventEmitter<string>();
  /** Permiso de entrega (signature.document.send) evaluado por el panel/editor; aquí solo se muestra u oculta. */
  @Input() canDeliverDocs = false;
  @Output() rulesChange = new EventEmitter<RequestRules>();
  /** "Go to signer": volver al editor con ese firmante activo. */
  @Output() goToSigner = new EventEmitter<string>();

  /** Canales de ENTREGA para el default de firmantes nuevos (mismos que ofrecía el editor). */
  readonly deliveryChannels: VerificationChannel[] = ['email', 'sms', 'whatsapp', 'none'];

  setSequential(sequential: boolean): void {
    this.emitRules(r => withSequential(r, sequential));
  }

  setDefaultChannel(channel: VerificationChannel): void {
    this.emitRules(r => withDefaultChannel(r, channel));
  }

  toggle(key: ToggleableRule): void {
    this.emitRules(r => toggleRule(r, key));
  }

  setReminderIntervalDays(days: number): void {
    this.emitRules(r => withReminderIntervalDays(r, days));
  }

  setSigningPin(value: string): void {
    this.emitRules(r => withSigningPin(r, value));
  }

  /**
   * El certificado se genera siempre en solicitudes nuevas; `rules.certificate === false` solo llega
   * al continuar un borrador VIEJO creado sin certificado (GenerateCertificate es inmutable en el
   * backend y SetCertificateDelivery(true) fallaría), así que "Send certificate" queda bloqueado.
   */
  certificateLocked(): boolean {
    return this.rules?.certificate === false;
  }

  reminderDays(): number {
    return this.rules ? reminderIntervalDays(this.rules) : 2;
  }

  signingPinInvalid(): boolean {
    return isSigningPinInvalid(this.rules);
  }

  // ---------- F7 — audiencia de la copia parcial ----------

  setAudienceKind(kind: 'All' | 'Specific'): void {
    this.emitRules(r => withPartialCopyAudienceKind(r, kind));
  }

  toggleRecipient(signerId: string): void {
    this.emitRules(r => togglePartialCopyRecipient(r, signerId));
  }

  isRecipient(signerId: string): boolean {
    return !!this.rules?.partialCopyAudienceSignerIds.includes(signerId);
  }

  audienceInvalid(): boolean {
    return isPartialCopyAudienceInvalid(this.rules);
  }

  trackSigner(_: number, s: EditorSigner): string {
    return s.id;
  }

  private emitRules(change: (rules: RequestRules) => RequestRules): void {
    if (!this.rules) {
      return;
    }
    const next = change(this.rules);
    if (next !== this.rules) {
      this.rulesChange.emit(next);
    }
  }

  /** Firmantes sin campo de Firma/Iniciales (los del preparador no cuentan): bloquean el envío. */
  signersMissingSignature(): EditorSigner[] {
    return signersMissingSignature(this.signers, this.fields);
  }

  readonly fieldIcon = FIELD_TYPE_ICON;
  readonly channelMeta = CHANNEL_META;

  /** Etiquetas de los canales habilitados, para la tarjeta de reglas. */
  channelLabels(): string {
    return (this.rules?.channels ?? []).map(ch => CHANNEL_META[ch].label).join(' · ');
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

  /** Campos de los firmantes (los del preparador se cuentan aparte). */
  totalFields(): number {
    return this.fields.filter(field => field.signerId !== PREPARER_PARTY_ID).length;
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

  fieldSummaryByDocument(signerId: string): string {
    return this.documents
      .map(document => {
        const count = this.fields.filter(
          field => field.signerId === signerId && field.documentLocalId === document.id,
        ).length;
        return count > 0 ? `${document.name.replace(/\.pdf$/i, '')} (${count})` : null;
      })
      .filter((value): value is string => value !== null)
      .join(' · ');
  }

  signersWithoutFields(): EditorSigner[] {
    return this.signers.filter(signer => this.fieldCountFor(signer.id) === 0);
  }

  /** El backend exige al menos un campo Signature o Initials (de un firmante; el del preparador no cuenta). */
  hasSignatureField(): boolean {
    return this.fields.some(
      field => field.signerId !== PREPARER_PARTY_ID && (field.type === 'signature' || field.type === 'initials'),
    );
  }

  titleTooShort(): boolean {
    return this.title.trim().length > 0 && this.title.trim().length < 3;
  }

  dueDateLabel(): string {
    if (!this.dueDate) {
      return 'in 7 days (default)';
    }
    return new Date(`${this.dueDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
