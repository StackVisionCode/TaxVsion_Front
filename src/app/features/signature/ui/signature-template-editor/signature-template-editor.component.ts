import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';
import { SignatureService } from '../../data-access/signature.service';
import { SignatureCategoryPickerComponent } from '../signature-category-picker/signature-category-picker.component';
import {
  SignatureCategory,
  SignatureTemplateDetail,
  SignerLanguage,
  SignerVerificationMethod,
  signatureCategoryLabel,
  TemplateFieldResponse,
  TemplatePreparerFieldResponse,
  TemplateSlotResponse,
  fieldTypeToKind,
} from '../../data-access/signature.model';
import { FieldType } from '../signature-request-panel/signature-wizard.model';
import { FIELD_TYPE_ICON, FIELD_TYPE_LABEL } from '../signature-request-panel/signature-wizard.presenter';
import { RenderedPage, blankPages, renderPdfPages } from '../../utils/pdf-render.util';
import { denormalizeFieldRect } from '../../utils/field-normalize.util';
import {
  TEMPLATE_EDITOR_INSPECTOR_COLLAPSED_KEY,
  readPanelCollapsed,
  writePanelCollapsed,
} from '../../utils/panel-collapse.util';
import {
  RETURN_MS,
  SETTLE_MS,
  animateGhostTo,
  dropRectOnPage,
  hitTestPages,
  measurePages,
  resetGhost,
  setGhostPosition,
  startPaletteDrag,
} from '../../utils/palette-drag.util';
import {
  MIN_FIELD_H,
  MIN_FIELD_W,
  PREPARER_SLOT,
  TemplateFieldLocal,
  buildNormalizedPreparerFields,
  buildNormalizedSignerFields,
  copyFieldToAllPages,
  duplicateField,
  isPreparerSlot,
  maxLocalSeq,
  moveFieldToPage,
  nudgeField,
  preserveLocalLayout,
  remapFieldsToPages,
  rolesMissingSignature,
} from '../../utils/template-layout.util';

/** Escala de render a zoom 100 % (la misma que el editor de solicitudes). */
const BASE_SCALE = 1.2;
/** Pasos de zoom relativos a BASE_SCALE. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

/** Paleta por slot (mismo criterio de color estable que el editor de firmas). */
const SLOT_PALETTE = [
  { bg: 'bg-brand-bold', border: 'border-brand-bold', text: 'text-brand-bold' },
  { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-600' },
  { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-600' },
  { bg: 'bg-sky-600', border: 'border-sky-600', text: 'text-sky-700' },
  { bg: 'bg-brand-ink', border: 'border-brand-ink', text: 'text-brand-ink' },
];

/** Tamaño por defecto a zoom 100 % (se multiplica por el zoom para que el tamaño en el PDF no cambie). */
const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 200, h: 60 },
  initials: { w: 90, h: 50 },
  date: { w: 130, h: 40 },
  text: { w: 170, h: 40 },
};

/** Mensajes amables: nunca el texto técnico de pdf.js. */
const RENDER_ERROR = "We couldn't open this PDF. Try again or upload another file.";
const BASE_DOC_ERROR = "We couldn't load this template's document. Try again.";
const ZOOM_ERROR = "We couldn't redraw the document at that zoom. Try again.";

type SettingsSection = 'details' | 'defaults' | 'roles';
type MobileTab = 'document' | 'settings';

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  pointerId: number;
  target: HTMLElement;
  /** Se re-mide en cada movimiento: si hay scroll durante el arrastre, el rect cambia. */
  pageEl: HTMLElement;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  startPointerX: number;
  startPointerY: number;
}

/** Fantasma del arrastre desde la paleta (mismo aspecto y tamaño, al zoom actual, que el campo colocado). */
export interface TemplatePaletteGhost {
  type: FieldType;
  /** slotOrder destino; PREPARER_SLOT para los campos del preparador. */
  slotOrder: number;
  width: number;
  height: number;
  overPage: boolean;
  phase: 'drag' | 'settle' | 'return';
}

/** Error con texto ya pensado para el usuario (run() lo muestra tal cual). */
class FriendlyError extends Error {}

/** Layout local que se re-aplica tras recargar si había cambios sin guardar. */
interface LayoutSnapshot {
  fields: TemplateFieldLocal[];
  slots: TemplateSlotResponse[];
  pages: RenderedPage[];
}

/**
 * Editor de autoría de una plantilla de firma (`/signature/templates`). Reutiliza las
 * mismas utilidades de render/coordenadas que el wizard de solicitudes, PERO es un
 * componente aparte: la plantilla trabaja con SLOTS (roles) en vez de firmantes con
 * email, y el layout se coloca sobre una superficie de muestra (PDF subido o páginas en
 * blanco) porque el documento real llega recién al instanciar.
 *
 * Estrategia de persistencia:
 *  - Metadatos/defaults y slots se guardan INCREMENTALMENTE contra el backend (el backend
 *    es la fuente de verdad del `order` de cada slot) y se recarga el detalle. Si el layout
 *    tiene cambios sin guardar, se CONSERVA tras la recarga (preserveLocalLayout).
 *  - Los campos se editan en local (drag/resize/teclado/inspector) y se persisten con
 *    "Save layout" como reemplazo total (borra los del server y re-postea los locales): no hay
 *    endpoint de update de campo. Si falla a mitad se recarga y el layout local sigue ahí para
 *    reintentar.
 *
 * Disposición: ≥ lg acordeón de ajustes a la izquierda + documento + inspector (columna en xl,
 * flotante en lg). < lg pestañas Document | Settings e inspector como panel inferior.
 */
@Component({
  selector: 'app-signature-template-editor',
  imports: [CommonModule, FormsModule, SignatureCategoryPickerComponent, ConfirmDialogComponent, SegmentedComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-template-editor.component.html',
  styleUrl: './signature-template-editor.component.css',
})
export class SignatureTemplateEditorComponent implements OnChanges, AfterViewInit, OnDestroy {
  private readonly service = inject(SignatureService);
  private readonly toast = inject(ToastService);

  @Input() templateId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  /** Se emite cuando cambió algo persistido (para refrescar la lista al volver). */
  @Output() changed = new EventEmitter<void>();

  @ViewChild('scroller') private scroller?: ElementRef<HTMLElement>;
  @ViewChild('ghostEl') private ghostRef?: ElementRef<HTMLElement>;

  readonly categoryLabel = signatureCategoryLabel;
  readonly fieldTypes: FieldType[] = ['signature', 'initials', 'date', 'text'];
  readonly fieldLabel = FIELD_TYPE_LABEL;
  readonly fieldIcon = FIELD_TYPE_ICON;
  readonly languageOptions: ReadonlyArray<{ value: SignerLanguage; label: string }> = [
    { value: 'En', label: 'English' },
    { value: 'Es', label: 'Español' },
  ];
  readonly mobileTabs: SegmentedOption<MobileTab>[] = [
    { id: 'document', label: 'Document' },
    { id: 'settings', label: 'Settings' },
  ];

  readonly detail = signal<SignatureTemplateDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly busyLabel = signal('');

  /** Coreografía de publicación (overlay a pantalla completa, mismo idioma que el envío). */
  readonly publishPhase = signal<'idle' | 'sealing' | 'done'>('idle');
  readonly isPublishing = computed(() => this.publishPhase() !== 'idle');
  readonly publishCaption = computed(() =>
    this.publishPhase() === 'done' ? 'Template published' : 'Publishing template…',
  );
  /** Líneas del "papel" del overlay (solo presentación). */
  readonly paperLines = [92, 76, 84, 60, 88];

  // ---------- Disposición compacta ----------
  /** Acordeón: una sección abierta a la vez (null = todas plegadas). */
  readonly openSection = signal<SettingsSection | null>('roles');
  /** < lg: pestaña visible. */
  readonly mobileTab = signal<MobileTab>('document');
  /** Confirmación al salir con layout sin guardar. */
  readonly confirmCloseOpen = signal(false);

  // ---------- Metadatos / defaults (form) ----------
  readonly title = signal('');
  readonly description = signal('');
  readonly category = signal<SignatureCategory>('Fiscal');
  readonly expirationHours = signal(168);
  readonly sequential = signal(false);
  readonly consent = signal(true);
  // El certificado de firma se genera SIEMPRE (generateCertificate = true en updateTemplateDefaults):
  // ya no hay switch. UpdateDefaults sí acepta cambiarlo, así que una plantilla vieja con false
  // queda en true al guardar.
  // Defaults de entrega/recordatorio que "from template" copia a la solicitud (mismos que la solicitud).
  readonly sendSealedDocument = signal(true);
  readonly sendCertificate = signal(false);
  readonly autoReminders = signal(true);
  readonly reminderIntervalHours = signal(48);
  readonly reminderIntervalDays = computed(() => Math.max(1, Math.round(this.reminderIntervalHours() / 24)));
  // Practitioner PIN por defecto de la plantilla (Form 8879). El hash no se expone: solo sabemos si HAY
  // uno (`requiresPractitionerPin`). `templatePin` es el valor NUEVO a fijar (vacío = no cambiar).
  readonly requiresPractitionerPin = signal(false);
  readonly templatePin = signal('');
  readonly templatePinInvalid = computed(() => {
    const pin = this.templatePin();
    return pin.length > 0 && pin.length < 4;
  });

  // ---------- Slots ----------
  readonly newSlotRole = signal('');
  readonly newSlotLanguage = signal<SignerLanguage>('En');
  /** OTP requerido para el nuevo rol: 'none' o un método. */
  readonly newSlotVerification = signal<SignerVerificationMethod | 'none'>('none');
  readonly activeSlotOrder = signal<number | null>(null);

  /** Opciones del selector de verificación por rol. */
  readonly verificationOptions: ReadonlyArray<{ value: SignerVerificationMethod | 'none'; label: string }> = [
    { value: 'none', label: 'No OTP' },
    { value: 'EmailOtp', label: 'Email code' },
    { value: 'SmsOtp', label: 'SMS code' },
    { value: 'WhatsAppOtp', label: 'WhatsApp code' },
  ];

  /** Etiqueta corta del método para la lista de roles. */
  verificationLabel(method: SignerVerificationMethod | null | undefined): string {
    switch (method) {
      case 'EmailOtp':
        return 'Email OTP';
      case 'SmsOtp':
        return 'SMS OTP';
      case 'WhatsAppOtp':
        return 'WhatsApp OTP';
      default:
        return '';
    }
  }

  // ---------- Campos (layout local) ----------
  readonly pages = signal<RenderedPage[]>([]);
  readonly fields = signal<TemplateFieldLocal[]>([]);
  /** true cuando el layout local difiere de lo persistido (habilita "Save layout"). */
  readonly layoutDirty = signal(false);
  readonly pdfError = signal('');
  /** Aviso no bloqueante sobre la superficie (p. ej. campos movidos a la página 1). */
  readonly surfaceNotice = signal('');
  /** P7: subiendo la muestra a CloudStorage para guardarla como documento base de la plantilla. */
  readonly savingBaseDoc = signal(false);
  /** Renderizando la superficie (abrir doc base, zoom, muestra): bloquea la edición. */
  readonly rendering = signal(false);
  /** El documento base no se pudo cargar: se muestra "Retry" y se bloquea la edición. */
  readonly renderError = signal('');
  readonly zoom = signal(1);
  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));
  readonly currentPage = signal(1);
  readonly selectedId = signal<string | null>(null);

  private drag: DragState | null = null;
  private seq = 0;
  /** Bytes del PDF de la superficie (muestra o doc base); null = páginas en blanco. */
  private pdfSource: Uint8Array | null = null;
  /** fileId del doc base del que salen `pdfSource` (null = muestra local o nada). */
  private sourceFileId: string | null = null;
  /** Descarta renders viejos (zoom/doc) si llega uno más nuevo. */
  private renderSeq = 0;
  private destroyed = false;

  // ---------- Derivados ----------

  readonly slots = computed(() => [...(this.detail()?.slots ?? [])].sort((a, b) => a.order - b.order));
  readonly isDraft = computed(() => this.detail()?.status === 'Draft');
  readonly isPublished = computed(() => this.detail()?.status === 'Published');
  /** Se puede tocar el layout: Draft, sin render en curso ni fallido y sin acción en vuelo. */
  readonly canEdit = computed(() => this.isDraft() && !this.rendering() && !this.renderError() && !this.busy());

  /** Roles firmantes sin campo de firma/iniciales (los del preparador no cuentan). */
  readonly rolesWithoutSignature = computed(() => rolesMissingSignature(this.slots(), this.fields()));

  /** Motivos que bloquean "Publish", en el orden en que hay que resolverlos. */
  readonly publishBlockers = computed<string[]>(() => {
    const out: string[] = [];
    if (this.slots().length === 0) {
      out.push('Add at least one signer role.');
    }
    const missing = this.rolesWithoutSignature();
    if (missing.length > 0) {
      out.push(`Add a Signature or Initials field for: ${missing.join(', ')}.`);
    }
    if (this.layoutDirty()) {
      out.push('Save the layout to enable publishing.');
    }
    return out;
  });
  readonly canPublish = computed(() => this.isDraft() && this.publishBlockers().length === 0);

  /** Rol del slot activo para la toolbar (o '—' si no hay ninguno). */
  readonly activeSlotLabel = computed(() => {
    const order = this.activeSlotOrder();
    return order === null ? '—' : this.slotRole(order);
  });

  readonly fieldCountBySlot = computed<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const field of this.fields()) {
      counts[field.slotOrder] = (counts[field.slotOrder] ?? 0) + 1;
    }
    return counts;
  });

  readonly selectedField = computed(() => {
    const id = this.selectedId();
    return id ? (this.fields().find(f => f.localId === id) ?? null) : null;
  });

  readonly hasPdfSurface = computed(() => this.pages().length > 0 && !!this.pages()[0].src);

  /**
   * xl: columna del inspector plegada (el documento ocupa su sitio). Se recuerda en localStorage.
   * Seleccionar un campo no la reabre: la toolbar muestra "Field settings" para reabrirla.
   * < xl no aplica (en lg flota sobre el documento y < lg es el panel inferior).
   */
  readonly inspectorCollapsed = signal(readPanelCollapsed(TEMPLATE_EDITOR_INSPECTOR_COLLAPSED_KEY));

  setInspectorCollapsed(collapsed: boolean): void {
    this.inspectorCollapsed.set(collapsed);
    writePanelCollapsed(TEMPLATE_EDITOR_INSPECTOR_COLLAPSED_KEY, collapsed);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['templateId']) {
      // Plantilla nueva: la superficie anterior no sirve.
      this.pdfSource = null;
      this.sourceFileId = null;
      this.pages.set([]);
      this.fields.set([]);
      this.layoutDirty.set(false);
      this.selectedId.set(null);
      this.renderError.set('');
      this.surfaceNotice.set('');
      void this.load();
    }
  }

  ngAfterViewInit(): void {
    // Fantasma position: fixed colgado de <body> (un ancestro con transform rompería el fixed).
    const ghost = this.ghostRef?.nativeElement;
    if (ghost && typeof document !== 'undefined') {
      document.body.appendChild(ghost);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.renderSeq++;
    this.detachDragListeners();
    this.stopPaletteDrag?.();
    if (this.ghostTimer) {
      clearTimeout(this.ghostTimer);
    }
    this.ghostRef?.nativeElement.remove();
  }

  // ------------------------------------------------------------------
  // Carga
  // ------------------------------------------------------------------

  private async load(): Promise<void> {
    const id = this.templateId;
    if (!id) {
      this.detail.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    let detail: SignatureTemplateDetail;
    try {
      detail = await firstValueFrom(this.service.getTemplate(id));
    } catch (err) {
      this.error.set(toApiError(err).message);
      this.loading.set(false);
      return;
    }
    this.loading.set(false);
    // Primera vez: si hay pocos campos de ancho (tablet/móvil) se ajusta al ancho.
    await this.applyDetail(detail, null);
    await this.fitIfOverflowing();
  }

  private async applyDetail(detail: SignatureTemplateDetail, preserved: LayoutSnapshot | null): Promise<void> {
    this.detail.set(detail);
    this.title.set(detail.title);
    this.description.set(detail.description ?? '');
    this.category.set(detail.category);
    this.expirationHours.set(detail.defaultTokenExpirationHours);
    this.sequential.set(detail.requiresSequentialSigning);
    this.consent.set(detail.requiresConsent);
    this.sendSealedDocument.set(detail.sendSealedDocumentToSigners);
    this.sendCertificate.set(detail.sendCertificateToSigners);
    this.autoReminders.set(detail.autoRemindersEnabled);
    this.reminderIntervalHours.set(detail.reminderIntervalHours);
    this.requiresPractitionerPin.set(detail.requiresPractitionerPin);
    this.templatePin.set('');
    if (this.activeSlotOrder() === null || !detail.slots.some(s => s.order === this.activeSlotOrder())) {
      this.activeSlotOrder.set([...detail.slots].sort((a, b) => a.order - b.order)[0]?.order ?? null);
    }
    await this.rebuildSurface(detail, preserved);
  }

  /**
   * Superficie de layout + campos. Si la plantilla tiene documento base y aún no está en memoria,
   * se descarga y se renderiza (antes salían páginas en blanco al reabrir). Los campos salen del
   * server, salvo que haya un layout local sin guardar: entonces se re-aplica ese.
   */
  private async rebuildSurface(detail: SignatureTemplateDetail, preserved: LayoutSnapshot | null): Promise<void> {
    const seq = ++this.renderSeq;
    const baseId = detail.baseDocumentFileId;
    let needsRender = this.pages().length === 0;

    if (baseId && baseId !== this.sourceFileId) {
      this.rendering.set(true);
      this.renderError.set('');
      try {
        this.pdfSource = await this.fetchBaseDocument(baseId);
        this.sourceFileId = baseId;
      } catch {
        if (seq !== this.renderSeq) {
          return;
        }
        this.pdfSource = null;
        this.sourceFileId = null;
        this.renderError.set(BASE_DOC_ERROR);
      }
      needsRender = true;
    } else if (!baseId && this.sourceFileId) {
      // El doc base se quitó en el server: la superficie vuelve a páginas en blanco.
      this.pdfSource = null;
      this.sourceFileId = null;
      needsRender = true;
    }
    if (seq !== this.renderSeq) {
      return;
    }

    const serverPageCount = Math.max(
      1,
      ...detail.fields.map(f => f.page),
      ...detail.preparerFields.map(f => f.page),
      ...(preserved?.fields.map(f => f.page) ?? []),
    );
    if (!this.pdfSource && this.pages().length < serverPageCount) {
      needsRender = true;
    }

    let pages = this.pages();
    if (needsRender) {
      this.rendering.set(true);
      try {
        pages = await this.buildPages(this.zoom(), serverPageCount);
      } catch {
        // PDF que no se pudo dibujar: superficie en blanco + error amable con "Retry".
        pages = blankPages(serverPageCount, BASE_SCALE * this.zoom());
        this.renderError.set(this.renderError() || BASE_DOC_ERROR);
      }
      if (seq !== this.renderSeq) {
        return;
      }
    }
    this.rendering.set(false);

    if (preserved) {
      const kept = preserveLocalLayout(preserved.fields, preserved.slots, detail.slots);
      const { fields, moved } = remapFieldsToPages(kept, preserved.pages, pages);
      this.pages.set(pages);
      this.fields.set(fields);
      this.layoutDirty.set(true);
      this.warnMoved(moved);
    } else {
      this.pages.set(pages);
      this.fields.set(serverFieldsToLocal(detail, pages));
      this.layoutDirty.set(false);
    }
    if (this.selectedId() && !this.fields().some(f => f.localId === this.selectedId())) {
      this.selectedId.set(null);
    }
    this.seq = Math.max(this.seq, maxLocalSeq(this.fields()) + 1);
    this.currentPage.set(Math.min(this.currentPage(), pages.length || 1));
  }

  /** Descarga los bytes del documento base (URL firmada de CloudStorage). */
  private async fetchBaseDocument(fileId: string): Promise<Uint8Array> {
    const url = await firstValueFrom(this.service.getDownloadUrl(fileId));
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Páginas a un zoom dado: el PDF en memoria o páginas en blanco tamaño carta. */
  private async buildPages(zoom: number, blankCount: number): Promise<RenderedPage[]> {
    const scale = BASE_SCALE * zoom;
    if (this.pdfSource) {
      // pdf.js transfiere el buffer al worker: se le pasa una copia para poder re-renderizar.
      return renderPdfPages({ data: this.pdfSource.slice() }, scale);
    }
    return blankPages(Math.max(1, blankCount), scale);
  }

  /** Reintenta cargar el documento base tras un fallo. */
  async retryRender(): Promise<void> {
    const detail = this.detail();
    if (!detail || this.rendering()) {
      return;
    }
    this.renderError.set('');
    this.sourceFileId = null;
    const preserved = this.layoutDirty() ? this.snapshot() : null;
    await this.rebuildSurface(detail, preserved);
  }

  // ------------------------------------------------------------------
  // Metadatos / defaults
  // ------------------------------------------------------------------

  async saveDetails(): Promise<void> {
    const id = this.templateId;
    if (!id || this.busy()) {
      return;
    }
    const title = this.title().trim();
    if (title.length < 3) {
      this.error.set('The template title must be at least 3 characters.');
      return;
    }
    await this.run('Saving template…', async () => {
      await firstValueFrom(
        this.service.updateTemplateMetadata(id, {
          title,
          description: this.description().trim() || null,
          category: this.category(),
        }),
      );
      await firstValueFrom(
        this.service.updateTemplateDefaults(id, {
          defaultTokenExpirationHours: this.expirationHours(),
          requiresSequentialSigning: this.sequential(),
          requiresConsent: this.consent(),
          generateCertificate: true,
          sendSealedDocumentToSigners: this.sendSealedDocument(),
          // Independiente de la generación: el certificado siempre se genera.
          sendCertificateToSigners: this.sendCertificate(),
          autoRemindersEnabled: this.autoReminders(),
          reminderIntervalHours: this.reminderIntervalHours(),
        }),
      );
      // PIN nuevo (4–10 dígitos) → fijar/reemplazar. Vacío = no se toca el PIN existente.
      const pin = this.templatePin();
      if (pin.length >= 4) {
        await firstValueFrom(this.service.setTemplatePractitionerPin(id, pin));
      }
      await this.reload();
      this.toast.success('Template details saved');
      this.changed.emit();
    });
  }

  setTemplatePin(value: string): void {
    this.templatePin.set((value ?? '').replace(/\D/g, '').slice(0, 10));
  }

  /** Quita el Practitioner PIN por defecto de la plantilla (efecto inmediato). */
  async removeTemplatePin(): Promise<void> {
    const id = this.templateId;
    if (!id || this.busy()) {
      return;
    }
    await this.run('Removing PIN…', async () => {
      await firstValueFrom(this.service.clearTemplatePractitionerPin(id));
      this.templatePin.set('');
      await this.reload();
      this.changed.emit();
    });
  }

  setReminderIntervalDays(days: number): void {
    const clamped = Math.min(30, Math.max(1, Math.round(days) || 1));
    this.reminderIntervalHours.set(clamped * 24);
  }

  toggleSection(section: SettingsSection): void {
    this.openSection.set(this.openSection() === section ? null : section);
  }

  // ------------------------------------------------------------------
  // Slots
  // ------------------------------------------------------------------

  async addSlot(): Promise<void> {
    const id = this.templateId;
    const role = this.newSlotRole().trim();
    if (!id || role.length < 2 || this.busy()) {
      if (role.length < 2) {
        this.error.set('Enter a role name (e.g. Client, Spouse, Preparer).');
      }
      return;
    }
    const method = this.newSlotVerification();
    await this.run('Adding role…', async () => {
      const created = await firstValueFrom(
        this.service.addTemplateSlot(id, {
          role,
          defaultLanguage: this.newSlotLanguage(),
          requiredVerificationMethod: method === 'none' ? null : method,
        }),
      );
      this.newSlotRole.set('');
      this.newSlotLanguage.set('En');
      this.newSlotVerification.set('none');
      await this.reload();
      this.activeSlotOrder.set(created.order);
      this.changed.emit();
    });
  }

  /** Valor actual del selector de verificación de un slot ('none' si no tiene). */
  slotVerificationValue(slot: TemplateSlotResponse): SignerVerificationMethod | 'none' {
    return slot.requiredVerificationMethod ?? 'none';
  }

  /** Edita idioma y/o método de verificación de un slot existente (persiste en el acto). */
  async updateSlot(
    slot: TemplateSlotResponse,
    patch: { defaultLanguage?: SignerLanguage; verification?: SignerVerificationMethod | 'none' },
  ): Promise<void> {
    const id = this.templateId;
    if (!id || this.busy()) {
      return;
    }
    const method =
      patch.verification !== undefined
        ? patch.verification === 'none'
          ? null
          : patch.verification
        : (slot.requiredVerificationMethod ?? null);
    await this.run('Updating role…', async () => {
      await firstValueFrom(
        this.service.updateTemplateSlot(id, slot.order, {
          role: slot.role,
          defaultLanguage: (patch.defaultLanguage ?? slot.defaultLanguage) as SignerLanguage,
          requiredVerificationMethod: method,
        }),
      );
      await this.reload();
      this.changed.emit();
    });
  }

  /** Devuelve una plantilla Published a Draft para poder editarla. */
  async revertToDraft(): Promise<void> {
    const id = this.templateId;
    if (!id || this.busy()) {
      return;
    }
    await this.run('Unlocking for editing…', async () => {
      await firstValueFrom(this.service.revertTemplateToDraft(id));
      await this.reload();
      this.changed.emit();
    });
  }

  async removeSlot(slotOrder: number): Promise<void> {
    const id = this.templateId;
    if (!id || this.busy()) {
      return;
    }
    await this.run('Removing role…', async () => {
      await firstValueFrom(this.service.removeTemplateSlot(id, slotOrder));
      // El backend puede renumerar: se recarga; el layout sin guardar se traduce por slot.id.
      await this.reload();
      this.changed.emit();
    });
  }

  setActiveSlot(order: number): void {
    this.activeSlotOrder.set(order);
  }

  slotPalette(order: number): (typeof SLOT_PALETTE)[number] {
    const index = this.slots().findIndex(s => s.order === order);
    return SLOT_PALETTE[(index < 0 ? 0 : index) % SLOT_PALETTE.length];
  }

  // ------------------------------------------------------------------
  // Superficie PDF de muestra (opcional)
  // ------------------------------------------------------------------

  async onSamplePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.pdfError.set('');
    if (!file || !this.isDraft() || this.rendering()) {
      return;
    }
    if (file.type !== 'application/pdf') {
      this.pdfError.set('Only a PDF can be used as the layout sample.');
      return;
    }
    const id = this.templateId;
    this.savingBaseDoc.set(true);
    try {
      // 1) Validación en el backend ANTES de previsualizar: un PDF rechazado no toca la superficie.
      let validationRecordId: string | null = null;
      if (id) {
        const validation = await firstValueFrom(this.service.validateDocument(file));
        if (!validation.isAcceptable) {
          this.pdfError.set(validation.issues[0]?.message ?? 'That PDF cannot be used as a base document.');
          return;
        }
        validationRecordId = validation.validationRecordId;
      }

      // 2) Vista previa local (sin el texto técnico de pdf.js si falla).
      const bytes = new Uint8Array(await file.arrayBuffer());
      const seq = ++this.renderSeq;
      this.rendering.set(true);
      let next: RenderedPage[];
      try {
        next = await renderPdfPages({ data: bytes.slice() }, BASE_SCALE * this.zoom());
      } catch {
        this.pdfError.set(RENDER_ERROR);
        return;
      } finally {
        this.rendering.set(false);
      }
      if (seq !== this.renderSeq) {
        return;
      }
      const { fields, moved } = remapFieldsToPages(this.fields(), this.pages(), next);
      this.pdfSource = bytes;
      this.sourceFileId = null;
      this.renderError.set('');
      this.pages.set(next);
      this.fields.set(fields);
      if (moved > 0) {
        this.layoutDirty.set(true);
      }
      this.warnMoved(moved);

      // 3) P7: sube el PDF a CloudStorage y lo guarda como documento base de la plantilla, para que
      //    "from template" lo pre-seleccione sin re-subir.
      if (!id || validationRecordId === null) {
        return;
      }
      const fileId = await firstValueFrom(this.service.uploadOriginalDocument(file, validationRecordId));
      await firstValueFrom(this.service.setTemplateBaseDocument(id, fileId));
      // Refleja el nuevo doc base sin recargar (los bytes ya están en memoria).
      this.sourceFileId = fileId;
      this.detail.update(d => (d ? { ...d, baseDocumentFileId: fileId } : d));
      this.changed.emit();
    } catch (err) {
      this.pdfError.set(toApiError(err).message);
    } finally {
      this.savingBaseDoc.set(false);
    }
  }

  async clearSample(): Promise<void> {
    if (!this.isDraft() || this.rendering()) {
      return;
    }
    const pages = blankPages(Math.max(1, ...this.fields().map(f => f.page)), BASE_SCALE * this.zoom());
    const { fields, moved } = remapFieldsToPages(this.fields(), this.pages(), pages);
    this.renderSeq++;
    this.pdfSource = null;
    this.sourceFileId = null;
    this.renderError.set('');
    this.pages.set(pages);
    this.fields.set(fields);
    this.warnMoved(moved);

    // P7: si había documento base, se quita también en el backend.
    const id = this.templateId;
    if (!id || !this.detail()?.baseDocumentFileId) {
      return;
    }
    this.savingBaseDoc.set(true);
    try {
      await firstValueFrom(this.service.setTemplateBaseDocument(id, null));
      this.detail.update(d => (d ? { ...d, baseDocumentFileId: null } : d));
      this.changed.emit();
    } catch (err) {
      this.pdfError.set(toApiError(err).message);
    } finally {
      this.savingBaseDoc.set(false);
    }
  }

  private warnMoved(moved: number): void {
    if (moved > 0) {
      this.surfaceNotice.set(
        `${moved} field${moved === 1 ? ' was' : 's were'} on pages this document doesn't have and moved to page 1. Check them before saving.`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Zoom y páginas
  // ------------------------------------------------------------------

  readonly canZoomOut = computed(() => !this.rendering() && this.zoom() > MIN_ZOOM + 0.001);
  readonly canZoomIn = computed(() => !this.rendering() && this.zoom() < MAX_ZOOM - 0.001);

  zoomIn(): void {
    const next = ZOOM_STEPS.find(z => z > this.zoom() + 0.001) ?? MAX_ZOOM;
    void this.setZoom(Math.min(next, MAX_ZOOM));
  }

  zoomOut(): void {
    const next = [...ZOOM_STEPS].reverse().find(z => z < this.zoom() - 0.001) ?? MIN_ZOOM;
    void this.setZoom(Math.max(next, MIN_ZOOM));
  }

  /** Ajusta el zoom al ancho disponible del visor. */
  async fitWidth(): Promise<void> {
    const zoom = this.fitZoom();
    if (zoom !== null) {
      await this.setZoom(zoom);
    }
  }

  /** Solo al abrir: si la página no cabe a lo ancho (tablet/móvil), se ajusta. */
  private async fitIfOverflowing(): Promise<void> {
    const zoom = this.fitZoom();
    if (zoom !== null && zoom < this.zoom() - 0.01) {
      await this.setZoom(zoom);
    }
  }

  private fitZoom(): number | null {
    const el = this.scroller?.nativeElement;
    const first = this.pages()[0];
    if (!el || !first || el.clientWidth <= 0 || first.scale <= 0) {
      return null;
    }
    const naturalWidth = (first.width / first.scale) * BASE_SCALE;
    // 32 px = padding horizontal del visor.
    const zoom = (el.clientWidth - 32) / naturalWidth;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
  }

  /**
   * Cambia el zoom re-dibujando la superficie. Los campos se re-escalan SOLO si el render terminó
   * bien; si falla, el zoom no cambia y se avisa sin texto técnico.
   */
  async setZoom(zoom: number): Promise<void> {
    if (this.rendering() || Math.abs(zoom - this.zoom()) < 0.001 || this.pages().length === 0) {
      return;
    }
    const seq = ++this.renderSeq;
    const prev = this.pages();
    this.stopPaletteDrag?.();
    this.stopPaletteDrag = null;
    this.rendering.set(true);
    let next: RenderedPage[];
    try {
      next = await this.buildPages(zoom, prev.length);
    } catch {
      if (seq === this.renderSeq) {
        this.rendering.set(false);
        this.toast.error(ZOOM_ERROR);
      }
      return;
    }
    if (seq !== this.renderSeq || this.destroyed) {
      return;
    }
    this.fields.set(remapFieldsToPages(this.fields(), prev, next).fields);
    this.pages.set(next);
    this.zoom.set(zoom);
    this.rendering.set(false);
  }

  /** Actualiza "Page X / N" según el scroll del visor. */
  onScroll(): void {
    const el = this.scroller?.nativeElement;
    if (!el) {
      return;
    }
    const top = el.getBoundingClientRect().top;
    const pageEls = Array.from(el.querySelectorAll<HTMLElement>('[data-page]'));
    let current = 1;
    for (const pageEl of pageEls) {
      if (pageEl.getBoundingClientRect().top - top <= el.clientHeight / 3) {
        current = Number(pageEl.dataset['page']) || current;
      }
    }
    this.currentPage.set(current);
  }

  goToPage(page: number): void {
    const target = this.scroller?.nativeElement.querySelector<HTMLElement>(`[data-page="${page}"]`);
    this.currentPage.set(page);
    target?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------------
  // Campos (layout local)
  // ------------------------------------------------------------------

  fieldsForPage(page: number): TemplateFieldLocal[] {
    return this.fields().filter(f => f.page === page);
  }

  trackField(_index: number, field: TemplateFieldLocal): string {
    return field.localId;
  }

  /** Página donde se coloca un campo nuevo: la visible. */
  private targetPage(): RenderedPage | undefined {
    const pages = this.pages();
    return pages.find(p => p.page === this.currentPage()) ?? pages[0];
  }

  /** Tamaño por defecto de un tipo en px de pantalla al zoom actual. */
  private defaultSize(type: FieldType): { w: number; h: number } {
    const z = this.zoom();
    return { w: DEFAULT_SIZE[type].w * z, h: DEFAULT_SIZE[type].h * z };
  }

  /**
   * Crea un campo. Sin `at`: en la página visible, centrado y escalonado (botón / Enter). Con `at`
   * (soltar desde la paleta): centrado en el punto de esa página y metido dentro de ella.
   */
  private newField(
    type: FieldType,
    slotOrder: number,
    baseY: number,
    at?: { page: number; x: number; y: number },
  ): TemplateFieldLocal | null {
    const page = at ? this.pages().find(p => p.page === at.page) : this.targetPage();
    if (!page || !this.canEdit()) {
      return null;
    }
    const z = this.zoom();
    const { w, h } = this.defaultSize(type);
    const count = this.fields().length;
    const rect = at
      ? dropRectOnPage(at, { w, h }, page)
      : {
          x: Math.max(8 * z, (page.width - w) / 2),
          y: Math.min(Math.max((baseY + (count % 6) * 16) * z, 8 * z), page.height - h - 8 * z),
          width: w,
          height: h,
        };
    const field: TemplateFieldLocal = { localId: this.nextId(), slotOrder, type, page: page.page, ...rect };
    this.fields.update(list => [...list, field]);
    this.selectedId.set(field.localId);
    this.layoutDirty.set(true);
    this.liveMessage.set(
      `${isPreparerSlot(slotOrder) ? 'Preparer ' : ''}${FIELD_TYPE_LABEL[type]} field placed on page ${page.page}`,
    );
    return field;
  }

  addField(type: FieldType): void {
    const slotOrder = this.activeSlotOrder();
    if (slotOrder === null) {
      return;
    }
    this.newField(type, slotOrder, 120);
  }

  /** Tipos que puede colocar el preparador en la plantilla (sin `text`: sus campos se estampan, no se rellenan). */
  readonly preparerFieldTypes: FieldType[] = ['signature', 'initials', 'date'];

  /** Coloca un campo del PREPARADOR (sin slot). "from template" lo hereda en la solicitud. */
  addPreparerField(type: FieldType = 'signature'): void {
    this.newField(type, PREPARER_SLOT, 180);
  }

  // ---------- arrastrar desde la paleta (mantener pulsado y soltar sobre la página) ----------

  readonly paletteGhost = signal<TemplatePaletteGhost | null>(null);
  /** Contorno de dónde caerá el campo (px de la página). */
  readonly dropPreview = signal<{ page: number; x: number; y: number; width: number; height: number } | null>(null);
  /** Táctil: botón mantenido pulsado ('signer:<type>' / 'preparer:<type>'). */
  readonly paletteArming = signal<string | null>(null);
  /** Mensaje para lectores de pantalla (aria-live) al colocar un campo. */
  readonly liveMessage = signal('');
  private stopPaletteDrag: (() => void) | null = null;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private paletteOrigin: { left: number; top: number; width: number; height: number } | null = null;

  /** Mismas reglas que los botones: sin rol activo, fuera de Draft o renderizando no se arrastra. */
  private dragSlotFor(preparer: boolean): number | null {
    if (!this.canEdit()) {
      return null;
    }
    if (preparer) {
      return this.pages().length > 0 ? PREPARER_SLOT : null;
    }
    return this.activeSlotOrder();
  }

  /** pointerdown en un botón de campo: el clic sigue igual; mover (ratón) o mantener (táctil) arrastra. */
  onPalettePointerDown(event: PointerEvent, type: FieldType, preparer = false): void {
    if (event.button > 0 || this.dragSlotFor(preparer) === null || this.paletteGhost()?.phase === 'drag') {
      return;
    }
    this.stopPaletteDrag?.();
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    this.paletteOrigin = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    const key = `${preparer ? 'preparer' : 'signer'}:${type}`;
    this.stopPaletteDrag = startPaletteDrag(event, {
      getScrollContainer: () => this.scroller?.nativeElement ?? null,
      onArming: armed => this.paletteArming.set(armed ? key : null),
      onStart: point => this.beginPaletteDrag(type, preparer, point),
      onFrame: point => this.onPaletteFrame(point),
      onDrop: point => this.dropFromPalette(point),
      onCancel: () => this.cancelPaletteDrag(),
    });
  }

  private beginPaletteDrag(type: FieldType, preparer: boolean, point: { clientX: number; clientY: number }): void {
    const slotOrder = this.dragSlotFor(preparer);
    if (slotOrder === null) {
      this.stopPaletteDrag?.();
      return;
    }
    if (this.ghostTimer) {
      clearTimeout(this.ghostTimer);
      this.ghostTimer = null;
    }
    const { w, h } = this.defaultSize(type);
    this.selectedId.set(null);
    const ghost = this.ghostRef?.nativeElement;
    resetGhost(ghost);
    setGhostPosition(ghost, point.clientX - w / 2, point.clientY - h / 2);
    this.paletteGhost.set({ type, slotOrder, width: w, height: h, overPage: false, phase: 'drag' });
  }

  private onPaletteFrame(point: { clientX: number; clientY: number }): void {
    const ghost = this.paletteGhost();
    if (!ghost || ghost.phase !== 'drag') {
      return;
    }
    setGhostPosition(this.ghostRef?.nativeElement, point.clientX - ghost.width / 2, point.clientY - ghost.height / 2);
    const hit = hitTestPages(point, measurePages(this.scroller?.nativeElement));
    const page = hit ? this.pages().find(p => p.page === hit.page) : undefined;
    const next = hit && page ? { page: hit.page, ...dropRectOnPage(hit, { w: ghost.width, h: ghost.height }, page) } : null;
    const prev = this.dropPreview();
    if (
      prev?.page !== next?.page ||
      prev?.x !== next?.x ||
      prev?.y !== next?.y ||
      prev?.width !== next?.width ||
      prev?.height !== next?.height
    ) {
      this.dropPreview.set(next);
    }
    if (ghost.overPage !== !!next) {
      this.paletteGhost.set({ ...ghost, overPage: !!next });
    }
  }

  private dropFromPalette(point: { clientX: number; clientY: number }): void {
    this.stopPaletteDrag = null;
    const ghost = this.paletteGhost();
    this.dropPreview.set(null);
    if (!ghost) {
      return;
    }
    const pageRects = measurePages(this.scroller?.nativeElement);
    const hit = hitTestPages(point, pageRects);
    const field = hit && this.canEdit() ? this.newField(ghost.type, ghost.slotOrder, 0, hit) : null;
    if (!field || !hit) {
      this.cancelPaletteDrag();
      return;
    }
    if (!isPreparerSlot(field.slotOrder)) {
      this.setActiveSlot(field.slotOrder);
    }
    const pageRect = pageRects.find(r => r.page === hit.page);
    if (!pageRect || prefersReducedMotion()) {
      this.clearGhost();
      return;
    }
    this.paletteGhost.set({ ...ghost, phase: 'settle', overPage: true });
    this.ghostTimer = animateGhostTo(
      this.ghostRef?.nativeElement,
      { left: pageRect.left + field.x, top: pageRect.top + field.y, opacity: 0 },
      SETTLE_MS,
      () => this.clearGhost(),
    );
  }

  /** Escape, pointercancel o soltar fuera: vuelve a la paleta sin crear nada. */
  private cancelPaletteDrag(): void {
    this.stopPaletteDrag = null;
    this.dropPreview.set(null);
    const ghost = this.paletteGhost();
    const origin = this.paletteOrigin;
    if (!ghost || !origin || prefersReducedMotion()) {
      this.clearGhost();
      return;
    }
    this.paletteGhost.set({ ...ghost, phase: 'return' });
    this.ghostTimer = animateGhostTo(
      this.ghostRef?.nativeElement,
      {
        left: origin.left + origin.width / 2 - ghost.width / 2,
        top: origin.top + origin.height / 2 - ghost.height / 2,
        scale: 0.5,
        opacity: 0,
      },
      RETURN_MS,
      () => this.clearGhost(),
    );
  }

  private clearGhost(): void {
    if (this.ghostTimer) {
      clearTimeout(this.ghostTimer);
      this.ghostTimer = null;
    }
    this.paletteGhost.set(null);
    this.paletteArming.set(null);
    resetGhost(this.ghostRef?.nativeElement);
  }

  isPreparerField(field: TemplateFieldLocal): boolean {
    return isPreparerSlot(field.slotOrder);
  }

  /** Etiqueta/instrucción de un campo de texto de la plantilla; el firmante la ve como placeholder. */
  setFieldLabel(localId: string, label: string): void {
    if (!this.canEdit()) {
      return;
    }
    this.fields.update(list => list.map(f => (f.localId === localId ? { ...f, label } : f)));
    this.layoutDirty.set(true);
  }

  removeField(localId: string): void {
    if (!this.canEdit()) {
      return;
    }
    this.fields.update(list => list.filter(f => f.localId !== localId));
    if (this.selectedId() === localId) {
      this.selectedId.set(null);
    }
    this.layoutDirty.set(true);
  }

  selectField(localId: string | null): void {
    this.selectedId.set(localId);
  }

  /** Inspector: reasigna el campo a otro rol firmante (los del preparador no se reasignan). */
  reassignField(localId: string, slotOrder: number): void {
    if (!this.canEdit() || isPreparerSlot(slotOrder)) {
      return;
    }
    this.fields.update(list =>
      list.map(f => (f.localId === localId && !isPreparerSlot(f.slotOrder) ? { ...f, slotOrder } : f)),
    );
    this.activeSlotOrder.set(slotOrder);
    this.layoutDirty.set(true);
  }

  /** Inspector: lleva el campo a otra página (misma posición relativa). */
  setFieldPage(localId: string, page: number): void {
    const field = this.fields().find(f => f.localId === localId);
    const from = this.pages().find(p => p.page === field?.page);
    const to = this.pages().find(p => p.page === page);
    if (!this.canEdit() || !field || !from || !to || field.page === page) {
      return;
    }
    const moved = moveFieldToPage(field, from, to);
    this.fields.update(list => list.map(f => (f.localId === localId ? moved : f)));
    this.layoutDirty.set(true);
    this.goToPage(page);
  }

  /** Duplica el campo en la misma página (desplazado); la copia queda seleccionada. */
  duplicate(localId: string): void {
    const field = this.fields().find(f => f.localId === localId);
    const page = this.pages().find(p => p.page === field?.page);
    if (!this.canEdit() || !field || !page) {
      return;
    }
    const copy = duplicateField(field, page, this.nextId(), 16 * this.zoom());
    this.fields.update(list => [...list, copy]);
    this.selectedId.set(copy.localId);
    this.layoutDirty.set(true);
  }

  /** Copia el campo a todas las demás páginas (campos normales e independientes). */
  duplicateToAllPages(localId: string): void {
    const field = this.fields().find(f => f.localId === localId);
    if (!this.canEdit() || !field || this.pages().length < 2) {
      return;
    }
    const copies = copyFieldToAllPages(field, this.pages(), () => this.nextId());
    this.fields.update(list => [...list, ...copies]);
    this.layoutDirty.set(true);
    this.toast.success(`Copied to ${copies.length} other page${copies.length === 1 ? '' : 's'}`);
  }

  /** Teclado sobre un campo enfocado: Supr/Backspace, flechas (Shift = 10 px), Ctrl/Cmd+D, Esc. */
  onFieldKeydown(event: KeyboardEvent, field: TemplateFieldLocal): void {
    const fromInput = (event.target as HTMLElement | null)?.tagName === 'INPUT';
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (fromInput) {
        (event.target as HTMLElement).blur();
      }
      this.selectedId.set(null);
      return;
    }
    if (fromInput || !this.canEdit()) {
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.removeField(field.localId);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicate(field.localId);
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    const page = this.pages().find(p => p.page === field.page);
    if (!d || !page) {
      return;
    }
    event.preventDefault();
    const moved = nudgeField(field, d[0], d[1], page);
    this.fields.update(list => list.map(f => (f.localId === field.localId ? moved : f)));
    this.layoutDirty.set(true);
  }

  borderClass(slotOrder: number): string {
    return this.slotPalette(slotOrder).border;
  }

  textClass(slotOrder: number): string {
    return this.slotPalette(slotOrder).text;
  }

  slotRole(slotOrder: number): string {
    return this.slots().find(s => s.order === slotOrder)?.role ?? `Slot ${slotOrder}`;
  }

  private nextId(): string {
    return `f-${this.seq++}`;
  }

  // ---------- drag & resize (pointer capture; listeners solo durante el arrastre) ----------

  startMove(event: PointerEvent, field: TemplateFieldLocal, pageEl: HTMLElement): void {
    this.beginDrag(event, field, 'move', pageEl);
  }

  startResize(event: PointerEvent, field: TemplateFieldLocal, pageEl: HTMLElement): void {
    this.beginDrag(event, field, 'resize', pageEl);
  }

  private beginDrag(event: PointerEvent, field: TemplateFieldLocal, mode: DragState['mode'], pageEl: HTMLElement): void {
    event.stopPropagation();
    this.selectedId.set(field.localId);
    if (!isPreparerSlot(field.slotOrder)) {
      this.setActiveSlot(field.slotOrder);
    }
    if (!this.canEdit() || event.button > 0 || this.drag) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Sin soporte de captura (navegadores viejos): los listeners de window bastan.
    }
    // preventDefault evita el foco nativo: se enfoca a mano para el teclado.
    target.closest<HTMLElement>('[data-field]')?.focus({ preventScroll: true });
    const rect = pageEl.getBoundingClientRect();
    this.drag = {
      id: field.localId,
      mode,
      pointerId: event.pointerId,
      target,
      pageEl,
      offsetX: event.clientX - rect.left - field.x,
      offsetY: event.clientY - rect.top - field.y,
      startX: field.x,
      startY: field.y,
      startW: field.width,
      startH: field.height,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    };
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.endDrag);
    window.addEventListener('pointercancel', this.endDrag);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) {
      return;
    }
    event.preventDefault();
    const rect = d.pageEl.getBoundingClientRect();
    const pageW = d.pageEl.clientWidth;
    const pageH = d.pageEl.clientHeight;
    let patch: Partial<TemplateFieldLocal>;
    if (d.mode === 'move') {
      patch = {
        x: Math.min(Math.max(event.clientX - rect.left - d.offsetX, 0), Math.max(0, pageW - d.startW)),
        y: Math.min(Math.max(event.clientY - rect.top - d.offsetY, 0), Math.max(0, pageH - d.startH)),
      };
    } else {
      const minW = MIN_FIELD_W * this.zoom();
      const minH = MIN_FIELD_H * this.zoom();
      patch = {
        width: Math.min(Math.max(d.startW + (event.clientX - d.startPointerX), minW), pageW - d.startX),
        height: Math.min(Math.max(d.startH + (event.clientY - d.startPointerY), minH), pageH - d.startY),
      };
    }
    let changed = false;
    this.fields.update(list =>
      list.map(f => {
        if (f.localId !== d.id) {
          return f;
        }
        const next = { ...f, ...patch };
        changed = next.x !== f.x || next.y !== f.y || next.width !== f.width || next.height !== f.height;
        return changed ? next : f;
      }),
    );
    // Un clic para seleccionar no ensucia el layout: solo si de verdad se movió.
    if (changed) {
      this.layoutDirty.set(true);
    }
  };

  private readonly endDrag = (event: PointerEvent): void => {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) {
      return;
    }
    try {
      d.target.releasePointerCapture(d.pointerId);
    } catch {
      // Ya liberada (pointercancel).
    }
    this.drag = null;
    this.detachDragListeners();
  };

  private detachDragListeners(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.endDrag);
    window.removeEventListener('pointercancel', this.endDrag);
  }

  // ------------------------------------------------------------------
  // Guardar layout (reemplazo total) + publicar
  // ------------------------------------------------------------------

  async saveLayout(): Promise<void> {
    const id = this.templateId;
    const detail = this.detail();
    if (!id || !detail || this.busy() || this.rendering() || !this.isDraft()) {
      return;
    }
    const signer = buildNormalizedSignerFields(this.fields(), this.pages());
    const preparer = buildNormalizedPreparerFields(this.fields(), this.pages());
    // Lo que hay en el server mientras avanza el reemplazo: si algo falla a mitad, el detalle
    // queda reflejando el estado real para que el reintento borre lo correcto.
    const serverSigner: TemplateFieldResponse[] = [...detail.fields];
    const serverPreparer: TemplatePreparerFieldResponse[] = [...detail.preparerFields];

    await this.run('Saving layout…', async () => {
      try {
        // Reemplazo total: borra los campos del server y re-postea los locales normalizados.
        for (const existing of [...serverSigner]) {
          await this.tolerateNotFound(firstValueFrom(this.service.removeTemplateField(id, existing.id)));
          serverSigner.splice(serverSigner.indexOf(existing), 1);
        }
        for (const existing of [...serverPreparer]) {
          await this.tolerateNotFound(firstValueFrom(this.service.removeTemplatePreparerField(id, existing.id)));
          serverPreparer.splice(serverPreparer.indexOf(existing), 1);
        }
        for (const field of signer) {
          const created = await firstValueFrom(
            this.service.placeTemplateField(id, {
              slotOrder: field.slotOrder,
              kind: fieldTypeToKind(field.type),
              page: field.page,
              x: field.x,
              y: field.y,
              width: field.width,
              height: field.height,
              label: field.label ?? null,
              isRequired: true,
            }),
          );
          serverSigner.push({
            id: created.id,
            slotOrder: field.slotOrder,
            kind: fieldTypeToKind(field.type),
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            label: field.label ?? null,
            isRequired: true,
          });
        }
        for (const field of preparer) {
          const created = await firstValueFrom(
            this.service.placeTemplatePreparerField(id, {
              kind: fieldTypeToKind(field.type),
              page: field.page,
              x: field.x,
              y: field.y,
              width: field.width,
              height: field.height,
              label: null,
            }),
          );
          serverPreparer.push({
            id: created.id,
            kind: fieldTypeToKind(field.type),
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            label: null,
          });
        }
      } catch (err) {
        // Fallo a mitad: el server quedó con un layout parcial. Se refleja lo que hay, se intenta
        // recargar (conservando el layout local, que sigue sucio) y se avisa para reintentar.
        this.detail.update(d => (d ? { ...d, fields: serverSigner, preparerFields: serverPreparer } : d));
        try {
          await this.reload();
        } catch {
          // Sin red: el detalle ya refleja lo borrado/creado en esta pasada.
        }
        this.changed.emit();
        throw new FriendlyError(
          `The layout was only partly saved (${toApiError(err).message}) Your changes are still here — press Save layout to try again.`,
        );
      }
      this.layoutDirty.set(false);
      await this.reload();
      this.toast.success('Layout saved');
      this.changed.emit();
    });
  }

  /** Un campo que ya no existe (404) cuenta como borrado: hace seguro el reintento. */
  private async tolerateNotFound(request: Promise<void>): Promise<void> {
    try {
      await request;
    } catch (err) {
      if (!(err instanceof HttpErrorResponse && err.status === 404)) {
        throw err;
      }
    }
  }

  async publish(): Promise<void> {
    const id = this.templateId;
    if (!id || !this.canPublish() || this.busy() || this.isPublishing()) {
      return;
    }
    this.error.set('');
    this.publishPhase.set('sealing');
    try {
      // La petición y un mínimo de coreografía corren en paralelo: el sellado se ve
      // completo aunque el backend responda al instante.
      await Promise.all([firstValueFrom(this.service.publishTemplate(id)), this.delay(1400)]);
      this.publishPhase.set('done');
      await this.delay(1000);
      this.publishPhase.set('idle');
      this.changed.emit();
      // Vuelta fluida al listado de plantillas (la página cierra el editor).
      this.closed.emit();
    } catch (err) {
      this.publishPhase.set('idle');
      this.error.set(toApiError(err).message);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async archive(): Promise<void> {
    const id = this.templateId;
    if (!id || this.busy()) {
      return;
    }
    await this.run('Archiving…', async () => {
      await firstValueFrom(this.service.archiveTemplate(id));
      await this.reload();
      this.changed.emit();
    });
  }

  /** Volver al listado: si hay layout sin guardar, se confirma antes. */
  close(): void {
    if (this.busy()) {
      return;
    }
    if (this.layoutDirty() && this.isDraft()) {
      this.confirmCloseOpen.set(true);
      return;
    }
    this.closed.emit();
  }

  confirmDiscardAndClose(): void {
    this.confirmCloseOpen.set(false);
    this.layoutDirty.set(false);
    this.closed.emit();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private snapshot(): LayoutSnapshot {
    return { fields: this.fields(), slots: this.slots(), pages: this.pages() };
  }

  /**
   * Recarga el detalle. Si el layout local tiene cambios sin guardar, se conserva (traducido por
   * slot.id por si el backend renumeró) en vez de pisarlo con el del server.
   */
  private async reload(): Promise<void> {
    const id = this.templateId;
    if (!id) {
      return;
    }
    const preserved = this.layoutDirty() ? this.snapshot() : null;
    const detail = await firstValueFrom(this.service.getTemplate(id));
    await this.applyDetail(detail, preserved);
  }

  private async run(label: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.busyLabel.set(label);
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(err instanceof FriendlyError ? err.message : toApiError(err).message);
    } finally {
      this.busy.set(false);
      this.busyLabel.set('');
    }
  }
}

/**
 * Campos del server (normalizados) → px de la superficie actual. Misma conversión que antes
 * (valor × tamaño de página); si la página no existe se usa la primera.
 */
function serverFieldsToLocal(detail: SignatureTemplateDetail, pages: readonly RenderedPage[]): TemplateFieldLocal[] {
  const pageFor = (n: number): RenderedPage => pages.find(p => p.page === n) ?? pages[0];
  const signer = detail.fields.map((f): TemplateFieldLocal => {
    const page = pageFor(f.page);
    return {
      localId: `srv-${f.id}`,
      slotOrder: f.slotOrder,
      type: kindToType(f.kind),
      page: page.page,
      ...denormalizeFieldRect(f, page),
      label: f.label ?? undefined,
    };
  });
  // Campos del preparador: mismo array con slotOrder sentinela PREPARER_SLOT.
  const preparer = detail.preparerFields.map((f): TemplateFieldLocal => {
    const page = pageFor(f.page);
    return {
      localId: `srv-prep-${f.id}`,
      slotOrder: PREPARER_SLOT,
      type: kindToType(f.kind),
      page: page.page,
      ...denormalizeFieldRect(f, page),
    };
  });
  return [...signer, ...preparer];
}

/** Enum del backend → tipo del editor. */
function kindToType(kind: SignatureTemplateDetail['fields'][number]['kind']): FieldType {
  switch (kind) {
    case 'Initials':
      return 'initials';
    case 'Date':
      return 'date';
    case 'Text':
    case 'Checkbox':
      return 'text';
    default:
      return 'signature';
  }
}
