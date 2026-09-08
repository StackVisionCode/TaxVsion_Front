import {
  AfterViewChecked,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SecurityContext,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import {
  DraftAttachmentSummary,
  MailCustomerSummary,
  formatFileSize,
  htmlToPlainText,
  parseRecipients,
} from '../../data-access/mail.model';
import { ComposeState } from '../../data-access/mail.store';

/** Lo que el editor emite al presionar Send; mail-page le agrega customerId/accountId del store. */
export interface ComposeDraftPayload {
  to: string;
  cc: string;
  subject: string;
  /** Cuerpo enriquecido tal cual quedó en el editor (viaja como HtmlBody del draft). */
  bodyHtml: string;
  /** Mismo cuerpo degradado a texto (TextBody, para clientes que no renderizan HTML). */
  bodyText: string;
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

/** Campo de destinatarios con autocompletar. Bcc no existe en el payload del store. */
type RecipientField = 'to' | 'cc';

/**
 * Las imágenes van EMBEBIDAS en el html (data URI): el contrato de adjuntos del draft no tiene
 * contentId, así que no hay forma de referenciarlas por CID. Pasado cierto peso el PATCH del
 * autosave se vuelve impracticable, así que se rechazan acá con un aviso en vez de fallar al enviar.
 */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

/** Comandos cuyo estado activo se refleja en la barra (los de lista también sirven de toggle). */
const TOOLBAR_MARKS = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'];

/** Suficiente para decidir si lo tecleado ya es una dirección utilizable, sin validar el RFC entero. */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Máximo de sugerencias visibles bajo el campo: el dropdown no debe tapar el editor. */
const MAX_RECIPIENT_OPTIONS = 6;

/**
 * Editor de redacción del módulo Mail. Ocupa el panel de lectura (no es un
 * modal): header, campos To/Cc/Subject con autocompletar de clientes, barra de
 * formato y un cuerpo enriquecido que llena el alto.
 *
 * Contrato del backend que condiciona la UI:
 * - Un envío es siempre un Draft de Correspondence: create → autosave → send
 *   síncrono. El editor no autoguarda mientras se escribe (evita PATCH por
 *   tecla); el store hace un único autosave justo antes del send.
 * - `SendDraft` exige Subject, HtmlBody y al menos un destinatario To, así que
 *   Send queda deshabilitado hasta tener los tres.
 * - Bcc existe en el contrato (`AutoSaveDraftRequest.bcc`) pero el store no lo
 *   expone en su payload, así que el campo no se muestra.
 * - El cuerpo es HTML real (`htmlBody`) y se manda además degradado a texto
 *   (`textBody`). Todo lo que entra por pegado o por un draft ajeno pasa por el
 *   sanitizador de Angular antes de tocar el DOM del editor.
 */
@Component({
  selector: 'app-mail-compose',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-compose.component.html',
  styleUrl: './mail-compose.component.css',
})
export class MailComposeComponent implements OnChanges, AfterViewChecked {
  @Input() state: ComposeState = EMPTY_STATE;
  /** Buzón desde el que sale el correo (cuenta activa del store). */
  @Input() accountEmail: string | null = null;
  /** Cliente dueño del hilo — Correspondence es customer-céntrico. */
  @Input() customerName: string | null = null;
  /** Clientes que devolvió la búsqueda del término tecleado en To/Cc. */
  @Input() recipientSuggestions: MailCustomerSummary[] = [];
  @Input() recipientSearching = false;

  @Output() closed = new EventEmitter<void>();
  @Output() discarded = new EventEmitter<void>();
  @Output() sendRequested = new EventEmitter<ComposeDraftPayload>();
  /** Término tecleado en el destinatario en curso: el padre lo busca contra /customers. */
  @Output() recipientSearchRequested = new EventEmitter<string>();

  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('bodyEditor') private bodyEditor?: ElementRef<HTMLDivElement>;
  @ViewChild('linkInput') private linkInput?: ElementRef<HTMLInputElement>;

  readonly to = signal('');
  readonly cc = signal('');
  readonly subject = signal('');
  /** Fuente de verdad del cuerpo: html del contenteditable (el DOM se sincroniza desde acá). */
  readonly bodyHtml = signal('');
  /** Archivos nuevos elegidos en esta sesión del editor (aún no subidos). */
  readonly files = signal<File[]>([]);
  /** Adjuntos que ya viven en el draft retomado y siguen vigentes. */
  readonly keptAttachments = signal<DraftAttachmentSummary[]>([]);
  /** Adjuntos del draft marcados para quitar (DELETE al enviar). */
  readonly removedFileIds = signal<string[]>([]);
  /** Aviso del editor (imagen demasiado grande, formato no soportado). */
  readonly bodyNotice = signal<string | null>(null);

  /** Draft ya volcado al formulario: evita re-prellenar en cada cambio de estado. */
  private prefilledDraftId: string | null = null;

  /** Último html escrito al DOM del editor: escribirlo de nuevo movería el cursor al inicio. */
  private lastRenderedHtml: string | null = null;

  readonly bodyText = computed(() => htmlToPlainText(this.bodyHtml()));

  /** Un cuerpo con solo una imagen es válido; `<br>` sueltos del contenteditable no lo son. */
  readonly bodyIsEmpty = computed(() => this.bodyText().length === 0 && !/<img\b/i.test(this.bodyHtml()));

  readonly canSend = computed(
    () =>
      !this.state.sending &&
      !this.state.loadingDraft &&
      this.to().trim().length > 0 &&
      this.subject().trim().length > 0 &&
      !this.bodyIsEmpty(),
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

  /**
   * El contenteditable no admite `[innerHTML]` (Angular lo re-escribiría en cada ciclo y el cursor
   * saltaría al inicio), así que el DOM se sincroniza a mano y solo cuando el html cambió por fuera
   * del propio tecleo: prefill de un draft, reset o inserción desde la barra.
   */
  ngAfterViewChecked(): void {
    const el = this.bodyEditor?.nativeElement;
    if (!el) {
      return;
    }
    const target = this.bodyHtml();
    if (this.lastRenderedHtml === target) {
      return;
    }
    el.innerHTML = target;
    this.lastRenderedHtml = target;
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
    // El html del draft puede venir de otro origen: se sanitiza antes de montarlo en el editor.
    this.setBodyHtml(this.clean(draft.htmlBody));
    this.keptAttachments.set([...draft.attachments]);
    this.removedFileIds.set([]);
    this.files.set([]);
    this.bodyNotice.set(null);
  }

  private joinRecipients(type: 'To' | 'Cc'): string {
    const recipients = this.state.draft?.recipients ?? [];
    return recipients
      .filter(recipient => recipient.type === type)
      .map(recipient => (recipient.displayName ? `${recipient.displayName} <${recipient.address}>` : recipient.address))
      .join(', ');
  }

  // ---------- Destinatarios con autocompletar ----------

  /** Campo cuyo dropdown está abierto (solo uno a la vez). */
  readonly openRecipientField = signal<RecipientField | null>(null);

  recipientValue(field: RecipientField): string {
    return field === 'to' ? this.to() : this.cc();
  }

  onRecipientInput(field: RecipientField, value: string): void {
    this.setRecipientValue(field, value);
    this.openRecipientField.set(field);
    this.recipientSearchRequested.emit(this.currentToken(value));
  }

  onRecipientFocus(field: RecipientField): void {
    this.openRecipientField.set(field);
    this.recipientSearchRequested.emit(this.currentToken(this.recipientValue(field)));
  }

  /** Cierra con delay para que el click en una sugerencia alcance a registrarse antes del blur. */
  closeRecipientPickerSoon(): void {
    setTimeout(() => this.openRecipientField.set(null), 150);
  }

  /**
   * Clientes sugeridos para el término en curso, sin los que ya están en el campo. La plantilla
   * la llama varias veces por ciclo, así que el resultado se cachea mientras no cambien ni el
   * campo, ni lo tecleado, ni la tanda de sugerencias: además de ahorrar el filtrado, mantiene
   * estable la referencia del array que consume el `*ngFor`.
   */
  recipientOptions(field: RecipientField): MailCustomerSummary[] {
    const value = this.recipientValue(field);
    const cached = this.recipientOptionsCache;
    if (cached && cached.field === field && cached.value === value && cached.source === this.recipientSuggestions) {
      return cached.options;
    }
    const chosen = this.chosenAddresses(value);
    const options = this.recipientSuggestions
      .filter(customer => !!customer.primaryEmail && !chosen.has(customer.primaryEmail.toLowerCase()))
      .slice(0, MAX_RECIPIENT_OPTIONS);
    this.recipientOptionsCache = { field, value, source: this.recipientSuggestions, options };
    return options;
  }

  private recipientOptionsCache: {
    field: RecipientField;
    value: string;
    source: MailCustomerSummary[];
    options: MailCustomerSummary[];
  } | null = null;

  /** Lo tecleado ya es una dirección y ningún cliente la tiene: se ofrece tal cual. */
  typedEmail(field: RecipientField): string | null {
    const token = this.currentToken(this.recipientValue(field));
    if (!EMAIL_PATTERN.test(token)) {
      return null;
    }
    const known = this.recipientOptions(field).some(
      customer => customer.primaryEmail.toLowerCase() === token.toLowerCase(),
    );
    return known ? null : token;
  }

  showRecipientPicker(field: RecipientField): boolean {
    if (this.openRecipientField() !== field) {
      return false;
    }
    return this.recipientOptions(field).length > 0 || !!this.typedEmail(field) || this.recipientSearching;
  }

  pickRecipient(field: RecipientField, customer: MailCustomerSummary): void {
    // El campo separa destinatarios por coma (igual que `parseRecipients`), así que un nombre
    // tipo "Peña, Enger" partiría la dirección en dos: se aplana antes de escribirlo.
    const name = customer.displayName.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    this.commitToken(field, name ? `${name} <${customer.primaryEmail}>` : customer.primaryEmail);
  }

  useTypedEmail(field: RecipientField): void {
    const token = this.typedEmail(field);
    if (token) {
      this.commitToken(field, token);
    }
  }

  private setRecipientValue(field: RecipientField, value: string): void {
    if (field === 'to') {
      this.to.set(value);
    } else {
      this.cc.set(value);
    }
  }

  /** Reemplaza el destinatario que se está tecleando por el elegido y deja el campo listo para otro. */
  private commitToken(field: RecipientField, replacement: string): void {
    const parts = this.recipientValue(field).split(/[,;]/);
    parts.pop();
    const head = parts.map(part => part.trim()).filter(part => part.length > 0);
    this.setRecipientValue(field, [...head, replacement].join(', ') + ', ');
    this.openRecipientField.set(null);
  }

  /** Último fragmento separado por coma: es el destinatario a medio escribir. */
  private currentToken(value: string): string {
    const parts = value.split(/[,;]/);
    return (parts[parts.length - 1] ?? '').trim();
  }

  /** Direcciones ya cerradas en el campo (excluye el token en curso). */
  private chosenAddresses(value: string): Set<string> {
    const parts = value.split(/[,;]/);
    parts.pop();
    return new Set(parseRecipients(parts.join(',')).map(recipient => recipient.address.toLowerCase()));
  }

  // ---------- Cuerpo enriquecido ----------

  /** Estado activo de los comandos, para pintar los botones de la barra. */
  readonly activeMarks = signal<Record<string, boolean>>({});

  /** Selección viva del editor: el foco se pierde al usar la barra y hay que restaurarla. */
  private savedRange: Range | null = null;

  isMarkActive(command: string): boolean {
    return !!this.activeMarks()[command];
  }

  /** El usuario escribió: el DOM ya tiene el html bueno, solo hay que leerlo (sin re-escribirlo). */
  onBodyInput(): void {
    this.pullBodyFromDom();
  }

  onBodySelectionChange(): void {
    this.saveSelection();
    this.syncMarks();
  }

  onBodyBlur(): void {
    this.saveSelection();
  }

  exec(command: string): void {
    if (this.state.sending) {
      return;
    }
    const el = this.bodyEditor?.nativeElement;
    if (!el) {
      return;
    }
    el.focus();
    this.restoreSelection();
    document.execCommand(command);
    this.pullBodyFromDom();
    this.syncMarks();
  }

  /**
   * Pegar: una imagen del portapapeles entra embebida; el html pegado pasa por el sanitizador
   * (nunca se inyecta markup ajeno crudo) y, si no hay html, se pega texto plano.
   */
  onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data) {
      return;
    }
    const image = Array.from(data.files ?? []).find(file => file.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      this.insertImageFile(image);
      return;
    }
    event.preventDefault();
    const html = data.getData('text/html');
    if (html) {
      document.execCommand('insertHTML', false, this.clean(html));
    } else {
      document.execCommand('insertText', false, data.getData('text/plain'));
    }
    this.pullBodyFromDom();
  }

  /** Soltar imágenes sobre el editor las embebe; cualquier otro archivo se deja al navegador. */
  onDrop(event: DragEvent): void {
    const images = Array.from(event.dataTransfer?.files ?? []).filter(file => file.type.startsWith('image/'));
    if (images.length === 0) {
      return;
    }
    event.preventDefault();
    for (const image of images) {
      this.insertImageFile(image);
    }
  }

  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files;
    if (!picked || picked.length === 0) {
      return;
    }
    for (const file of Array.from(picked)) {
      this.insertImageFile(file);
    }
    // Limpiar el input para permitir volver a elegir la misma imagen.
    input.value = '';
  }

  private insertImageFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      return;
    }
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      this.bodyNotice.set(
        `"${file.name}" is ${formatFileSize(file.size)} — inline images must stay under ` +
          `${formatFileSize(MAX_INLINE_IMAGE_BYTES)}. Send it as an attachment instead.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      if (!dataUrl.startsWith('data:image/')) {
        return;
      }
      this.bodyNotice.set(null);
      // El estilo va inline: los clientes de correo ignoran las hojas de estilo del remitente.
      this.insertHtml(
        `<img src="${dataUrl}" alt="${this.escapeAttribute(file.name)}" style="max-width:100%;height:auto;" />`,
      );
    };
    reader.onerror = () => this.bodyNotice.set(`Could not read "${file.name}".`);
    reader.readAsDataURL(file);
  }

  // ---------- Enlaces ----------

  readonly linkEditorOpen = signal(false);
  readonly linkUrl = signal('');

  openLinkEditor(): void {
    if (this.state.sending) {
      return;
    }
    this.saveSelection();
    this.linkUrl.set('');
    this.linkEditorOpen.set(true);
    // El input nace en el mismo ciclo: se enfoca cuando ya existe en el DOM.
    setTimeout(() => this.linkInput?.nativeElement.focus(), 0);
  }

  cancelLink(): void {
    this.linkEditorOpen.set(false);
  }

  applyLink(): void {
    const url = this.normalizeUrl(this.linkUrl());
    this.linkEditorOpen.set(false);
    if (!url) {
      return;
    }
    const el = this.bodyEditor?.nativeElement;
    if (!el) {
      return;
    }
    el.focus();
    this.restoreSelection();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      document.execCommand('createLink', false, url);
      this.pullBodyFromDom();
      return;
    }
    // Sin texto seleccionado el enlace se escribe entero, que es lo que espera quien lo pega.
    this.insertHtml(`<a href="${this.escapeAttribute(url)}">${this.escapeAttribute(url)}</a>&nbsp;`);
  }

  /** Sin esquema se asume https; `javascript:` y demás se descartan en vez de insertarse. */
  private normalizeUrl(raw: string): string | null {
    const value = raw.trim();
    if (!value) {
      return null;
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    return /^(https?|mailto):/i.test(withScheme) ? withScheme : null;
  }

  // ---------- Utilidades del editor ----------

  private insertHtml(html: string): void {
    const el = this.bodyEditor?.nativeElement;
    if (!el) {
      return;
    }
    el.focus();
    this.restoreSelection();
    document.execCommand('insertHTML', false, html);
    this.pullBodyFromDom();
  }

  /** Lee el DOM como fuente del cuerpo y marca ese html como ya renderizado (no lo re-escribe). */
  private pullBodyFromDom(): void {
    const el = this.bodyEditor?.nativeElement;
    if (!el) {
      return;
    }
    const html = el.innerHTML;
    this.lastRenderedHtml = html;
    this.bodyHtml.set(html);
    this.saveSelection();
  }

  /** Cambia el cuerpo desde fuera del editor (prefill/reset): fuerza el re-render del DOM. */
  private setBodyHtml(html: string): void {
    this.lastRenderedHtml = null;
    this.savedRange = null;
    this.bodyHtml.set(html);
  }

  private saveSelection(): void {
    const el = this.bodyEditor?.nativeElement;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      this.savedRange = range.cloneRange();
    }
  }

  private restoreSelection(): void {
    if (!this.savedRange) {
      return;
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(this.savedRange);
  }

  private syncMarks(): void {
    const marks: Record<string, boolean> = {};
    for (const command of TOOLBAR_MARKS) {
      try {
        marks[command] = document.queryCommandState(command);
      } catch {
        marks[command] = false;
      }
    }
    this.activeMarks.set(marks);
  }

  /**
   * Todo html que no escribió el propio editor (draft retomado, pegado) pasa por acá: primero el
   * sanitizador de Angular y después el reencuadre de las imágenes. El sanitizador quita el
   * atributo `style`, así que sin este segundo paso una imagen guardada perdería su `max-width` y
   * saldría a tamaño natural en el correo — y las pegadas de otro correo llegan con anchos fijos
   * enormes. Se opera sobre un nodo suelto y ya saneado: no ejecuta nada.
   */
  private clean(html: string | null | undefined): string {
    const safe = this.sanitizer.sanitize(SecurityContext.HTML, html ?? '') ?? '';
    if (!safe.includes('<img')) {
      return safe;
    }
    const holder = document.createElement('div');
    holder.innerHTML = safe;
    for (const image of Array.from(holder.querySelectorAll('img'))) {
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
      image.removeAttribute('width');
      image.removeAttribute('height');
    }
    return holder.innerHTML;
  }

  private escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      bodyHtml: this.bodyHtml(),
      bodyText: this.bodyText(),
      files: this.files(),
      removedFileIds: this.removedFileIds(),
    });
  }

  private reset(): void {
    this.prefilledDraftId = null;
    this.to.set('');
    this.cc.set('');
    this.subject.set('');
    this.setBodyHtml('');
    this.files.set([]);
    this.keptAttachments.set([]);
    this.removedFileIds.set([]);
    this.bodyNotice.set(null);
    this.openRecipientField.set(null);
    this.linkEditorOpen.set(false);
    this.activeMarks.set({});
  }
}
