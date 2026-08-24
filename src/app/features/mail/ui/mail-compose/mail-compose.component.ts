import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DraftAttachmentSummary, formatFileSize } from '../../data-access/mail.model';
import { ComposeState } from '../../data-access/mail.store';

/** Lo que el editor emite al presionar Send; mail-page le agrega customerId/accountId del store. */
export interface ComposeDraftPayload {
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** Archivos nuevos: el store los sube a CloudStorage y los referencia en el draft. */
  files: File[];
  /** fileIds de adjuntos ya persistidos en el draft que el usuario quitó. */
  removedFileIds: string[];
}

const EMPTY_STATE: ComposeState = {
  open: false,
  draft: null,
  loadingDraft: false,
  loadError: null,
  sending: false,
  error: null,
};

/**
 * Editor de redacción del módulo Mail. Ocupa el panel de lectura (no es un
 * modal): header, campos To/Cc/Subject, adjuntos reales y un textarea que llena
 * el alto.
 *
 * Contrato del backend que condiciona la UI:
 * - Un envío es siempre un Draft de Correspondence: create → autosave → send
 *   síncrono. El editor no autoguarda mientras se escribe (evita PATCH por
 *   tecla); el store hace un único autosave justo antes del send.
 * - `SendDraft` exige Subject, HtmlBody y al menos un destinatario To, así que
 *   Send queda deshabilitado hasta tener los tres.
 * - Bcc existe en el contrato (`AutoSaveDraftRequest.bcc`) pero el store no lo
 *   expone en su payload, así que el campo no se muestra.
 * - El cuerpo es TEXTO PLANO: el store lo serializa con `plainTextToHtml`. Por
 *   eso desapareció el toolbox de formato del mock (era decorativo).
 */
@Component({
  selector: 'app-mail-compose',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-compose.component.html',
  styleUrl: './mail-compose.component.css',
})
export class MailComposeComponent implements OnChanges {
  @Input() state: ComposeState = EMPTY_STATE;
  /** Buzón desde el que sale el correo (cuenta activa del store). */
  @Input() accountEmail: string | null = null;
  /** Cliente dueño del hilo — Correspondence es customer-céntrico. */
  @Input() customerName: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() discarded = new EventEmitter<void>();
  @Output() sendRequested = new EventEmitter<ComposeDraftPayload>();

  readonly to = signal('');
  readonly cc = signal('');
  readonly subject = signal('');
  readonly body = signal('');
  /** Archivos nuevos elegidos en esta sesión del editor (aún no subidos). */
  readonly files = signal<File[]>([]);
  /** Adjuntos que ya viven en el draft retomado y siguen vigentes. */
  readonly keptAttachments = signal<DraftAttachmentSummary[]>([]);
  /** Adjuntos del draft marcados para quitar (DELETE al enviar). */
  readonly removedFileIds = signal<string[]>([]);

  /** Draft ya volcado al formulario: evita re-prellenar en cada cambio de estado. */
  private prefilledDraftId: string | null = null;

  readonly canSend = computed(
    () =>
      !this.state.sending &&
      !this.state.loadingDraft &&
      this.to().trim().length > 0 &&
      this.subject().trim().length > 0 &&
      this.body().trim().length > 0,
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['state']) {
      return;
    }
    const draft = this.state?.draft ?? null;
    if (!draft) {
      // Redacción nueva: si se venía de un draft retomado, limpiar el formulario.
      if (this.prefilledDraftId !== null) {
        this.reset();
      }
      return;
    }
    if (draft.draftId !== this.prefilledDraftId) {
      this.prefill(draft.draftId);
    }
  }

  // ---------- Prefill de un draft retomado ----------

  private prefill(draftId: string): void {
    const draft = this.state.draft;
    if (!draft) {
      return;
    }
    this.prefilledDraftId = draftId;
    this.subject.set(draft.subject ?? '');
    this.to.set(this.joinRecipients('To'));
    this.cc.set(this.joinRecipients('Cc'));
    // El textarea es texto plano: se usa textBody y, si el draft venía de otro
    // origen sin él, se degrada el htmlBody a texto en vez de mostrar markup.
    this.body.set(draft.textBody ?? this.htmlToPlainText(draft.htmlBody));
    this.keptAttachments.set([...draft.attachments]);
    this.removedFileIds.set([]);
    this.files.set([]);
  }

  private joinRecipients(type: 'To' | 'Cc'): string {
    const recipients = this.state.draft?.recipients ?? [];
    return recipients
      .filter(recipient => recipient.type === type)
      .map(recipient => (recipient.displayName ? `${recipient.displayName} <${recipient.address}>` : recipient.address))
      .join(', ');
  }

  /** Degradado mínimo html → texto (sin librerías): saltos de <br>/</p> y sin tags. */
  private htmlToPlainText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  // ---------- Adjuntos ----------

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files;
    if (!picked || picked.length === 0) {
      return;
    }
    this.files.update(list => [...list, ...Array.from(picked)]);
    // Limpiar el input para permitir volver a elegir el mismo archivo.
    input.value = '';
  }

  removeFile(index: number): void {
    this.files.update(list => list.filter((_, i) => i !== index));
  }

  /** Quitar un adjunto ya persistido sólo se materializa al enviar (DELETE en la cadena del store). */
  removeExistingAttachment(fileId: string): void {
    this.keptAttachments.update(list => list.filter(item => item.fileId !== fileId));
    this.removedFileIds.update(list => (list.includes(fileId) ? list : [...list, fileId]));
  }

  fileSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  // ---------- Acciones ----------

  close(): void {
    if (this.state.sending) {
      return;
    }
    this.reset();
    this.closed.emit();
  }

  discard(): void {
    if (this.state.sending) {
      return;
    }
    this.reset();
    this.discarded.emit();
  }

  send(): void {
    if (!this.canSend()) {
      return;
    }
    this.sendRequested.emit({
      to: this.to(),
      cc: this.cc(),
      subject: this.subject(),
      body: this.body(),
      files: this.files(),
      removedFileIds: this.removedFileIds(),
    });
  }

  private reset(): void {
    this.prefilledDraftId = null;
    this.to.set('');
    this.cc.set('');
    this.subject.set('');
    this.body.set('');
    this.files.set([]);
    this.keptAttachments.set([]);
    this.removedFileIds.set([]);
  }
}
