import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  EditorSigner,
  FieldType,
  PlacedField,
  RequestRules,
  VerificationChannel,
  WizardClient,
  WizardDocKind,
  WizardDocument,
} from '../signature-request-panel/signature-wizard.model';
import { SignerLanguage, channelRequiresPhone } from '../../data-access/signature.model';
import { PageMetrics, PdfRect, screenRectToPdf } from '../signature-request-panel/signature-coords.util';
import {
  CHANNEL_META,
  FIELD_TYPE_CIRCLE,
  FIELD_TYPE_ICON,
  FIELD_TYPE_LABEL,
  defaultRules,
  initialsOf,
  kindCircle,
  kindIcon,
} from '../signature-request-panel/signature-wizard.presenter';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { RenderedPage, blankPages, renderPdfPages } from '../../utils/pdf-render.util';
import { PermissionService } from '../../../../core/auth/permission.service';

const MIN_W = 48;
const MIN_H = 28;

/**
 * Mínimo de tamaño POR TIPO al redimensionar. Una firma/iniciales se sella como un cuño apilado
 * (firma + fecha, y caption si cabe): por debajo de ~44px de alto la firma queda diminuta y se
 * encarama sobre la fecha en el PDF. Fecha/texto sí pueden ser más bajos. Evita que el preparador
 * achique el campo a algo inusable.
 */
const MIN_SIZE_BY_TYPE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 120, h: 44 },
  initials: { w: 64, h: 40 },
  date: { w: MIN_W, h: MIN_H },
  text: { w: MIN_W, h: MIN_H },
};

/** Escala base del render (100% de zoom). */
const BASE_SCALE = 1.2;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;

const SIGNER_PALETTE = [
  { bg: 'bg-indigo-500', border: 'border-indigo-500', text: 'text-indigo-600' },
  { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-600' },
  { bg: 'bg-brand-bold', border: 'border-brand-bold', text: 'text-brand-bold' },
  { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-600' },
  { bg: 'bg-brand-bold', border: 'border-brand-bold', text: 'text-gray-900' },
];

const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 200, h: 60 },
  initials: { w: 90, h: 50 },
  date: { w: 130, h: 40 },
  text: { w: 170, h: 40 },
};

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  pageLeft: number;
  pageTop: number;
  pageW: number;
  pageH: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  startPointerX: number;
  startPointerY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Campo colocado en coordenadas NORMALIZADAS [0..1] respecto a la página, origen
 * arriba-izquierda — exactamente la convención de FieldPosition del backend
 * (POST /signature/requests/{id}/fields). Independiente del zoom/DPI del editor.
 */
export interface NormalizedPlacedField {
  localId: string;
  signerLocalId: string;
  type: FieldType;
  /** 1-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Instrucción/etiqueta del campo (solo `text`); el firmante la ve como placeholder. */
  label?: string;
}

/**
 * Paso 3 del wizard: editor de colocación de campos sobre el PDF (adaptado del
 * `PdfSignatureEditorComponent` + `generador-firmas` del CRM). Renderiza el PDF
 * con pdf.js (bytes subidos, PDF de muestra para docs mock, o páginas en blanco),
 * gestiona firmantes (el cliente es el #1) y permite colocar/arrastrar/redimensionar/
 * borrar campos de Firma/Iniciales/Fecha/Texto por firmante. Expone `buildPdfPayload()`
 * (transform pantalla→PDF con Y-flip) para el envío.
 */
@Component({
  selector: 'app-signature-pdf-editor',
  imports: [CommonModule, FormsModule, ModalComponent, CdkDropList, CdkDrag, CdkDragHandle],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-pdf-editor.component.html',
  styleUrl: './signature-pdf-editor.component.css',
})
export class SignaturePdfEditorComponent implements OnChanges {
  @Input() client: WizardClient | null = null;
  @Input() document: WizardDocument | null = null;
  /** Clientes reales del tenant (GET /customers) para el select del modal "Add signer". */
  @Input() registeredClients: WizardClient[] = [];
  @Output() fieldCountChange = new EventEmitter<number>();

  readonly fieldTypes: FieldType[] = ['signature', 'initials', 'date', 'text'];
  readonly fieldLabel = FIELD_TYPE_LABEL;
  readonly fieldIcon = FIELD_TYPE_ICON;
  readonly fieldCircle = FIELD_TYPE_CIRCLE;

  readonly pages = signal<RenderedPage[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');

  /** Zoom del documento (1 = 100%); la escala efectiva de render es BASE_SCALE * zoom. */
  readonly zoom = signal(1);
  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));
  readonly canZoomIn = computed(() => this.zoom() < ZOOM_MAX);
  readonly canZoomOut = computed(() => this.zoom() > ZOOM_MIN);

  /** Bytes del PDF cacheados (subido o sample) para re-render por zoom/retry sin re-fetch. */
  private docBytes: Uint8Array | null = null;

  readonly signers = signal<EditorSigner[]>([]);
  readonly activeSignerId = signal<string | null>(null);
  readonly fields = signal<PlacedField[]>([]);

  /** Reglas de la solicitud (sección Rules del sidebar). */
  readonly rules = signal<RequestRules>(defaultRules());
  readonly channelMeta = CHANNEL_META;

  private readonly perms = inject(PermissionService);
  /** P2/P8: los toggles de entrega solo se muestran a quien puede entregar (signature.document.send). */
  readonly canDeliverDocs = computed(() => this.perms.has('signature.document.send'));

  /** Modal "Add signer": cliente registrado o datos manuales + canal. */
  readonly isAddSignerOpen = signal(false);
  readonly draftClientId = signal('');
  readonly draftName = signal('');
  readonly draftEmail = signal('');
  readonly draftPhone = signal('');
  readonly draftChannel = signal<VerificationChannel>('email');
  readonly draftLanguage = signal<SignerLanguage>('En');
  readonly draftError = signal('');
  /** Atestación del preparador de que el firmante consintió recibir SMS (TCPA); exigida en SMS/WhatsApp. */
  readonly draftSmsConsent = signal(false);

  /** El canal elegido exige teléfono (SMS/WhatsApp): controla la visibilidad del campo. */
  readonly draftChannelNeedsPhone = computed(() => channelRequiresPhone(this.draftChannel()));

  /** Opciones del selector de idioma del firmante (correos). */
  readonly languageOptions: ReadonlyArray<{ value: SignerLanguage; label: string }> = [
    { value: 'En', label: 'English' },
    { value: 'Es', label: 'Español' },
  ];

  readonly activeSignerName = computed(
    () => this.signers().find(s => s.id === this.activeSignerId())?.name ?? '—',
  );

  /** Nº de campos colocados por firmante (badge del sidebar). */
  readonly fieldCountBySigner = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const field of this.fields()) {
      counts[field.signerId] = (counts[field.signerId] ?? 0) + 1;
    }
    return counts;
  });

  /** Desglose de campos por tipo (summary de la columna derecha). */
  readonly fieldTypeBreakdown = computed<Record<FieldType, number>>(() => {
    const counts: Record<FieldType, number> = { signature: 0, initials: 0, date: 0, text: 0 };
    for (const field of this.fields()) {
      counts[field.type]++;
    }
    return counts;
  });

  private drag: DragState | null = null;
  private seq = 0;
  private loadToken = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['client']) {
      this.syncClientSigner();
    }
    if (changes['document']) {
      void this.loadDocument();
    }
  }

  // ---------- firmantes ----------

  isClientSigner(signer: EditorSigner): boolean {
    return signer.id.startsWith('client:');
  }

  initials(name: string): string {
    return initialsOf(name);
  }

  setActiveSigner(id: string): void {
    this.activeSignerId.set(id);
  }

  /** Canal por defecto para un firmante nuevo = el default de la request (chips). Email si está ofrecido,
   * si no el primero ofrecido. Así los canales de la request dejan de ser decorativos. */
  private defaultSignerChannel(): VerificationChannel {
    // El canal por defecto de un firmante nuevo = el default elegido en las chips (primer elemento).
    return this.rules().channels[0] ?? 'email';
  }

  openAddSigner(): void {
    this.draftClientId.set('');
    this.draftName.set('');
    this.draftEmail.set('');
    this.draftPhone.set('');
    this.draftChannel.set(this.defaultSignerChannel());
    this.draftLanguage.set('En');
    this.draftError.set('');
    this.draftSmsConsent.set(false);
    this.isAddSignerOpen.set(true);
  }

  closeAddSigner(): void {
    this.isAddSignerOpen.set(false);
  }

  /** Elegir un cliente registrado autollena nombre y email (editables). */
  onDraftClientChange(id: string): void {
    this.draftClientId.set(id);
    const client = this.registeredClients.find(c => c.id === id);
    if (client) {
      this.draftName.set(client.displayName);
      this.draftEmail.set(client.email);
      this.draftPhone.set(client.phone ?? '');
    }
  }

  confirmAddSigner(): void {
    const name = this.draftName().trim();
    const email = this.draftEmail().trim();
    if (name.length < 2) {
      this.draftError.set('Enter the signer name.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      this.draftError.set('Enter a valid email address.');
      return;
    }
    const phone = this.draftPhone().trim();
    // SMS/WhatsApp no pueden entregar el código sin teléfono (el backend responde NoDeliveryAddress).
    if (this.draftChannelNeedsPhone() && phone.length < 7) {
      this.draftError.set('Enter a phone number for SMS/WhatsApp verification.');
      return;
    }
    // TCPA: no se envían textos sin confirmar que el firmante los consintió.
    if (this.draftChannelNeedsPhone() && !this.draftSmsConsent()) {
      this.draftError.set('Confirm the signer agreed to receive text messages.');
      return;
    }
    const id = `signer-${this.seq++}`;
    this.signers.update(list => {
      const color = SIGNER_PALETTE[list.length % SIGNER_PALETTE.length].bg;
      return [
        ...list,
        { id, name, email, color, channel: this.draftChannel(), phone, language: this.draftLanguage() },
      ];
    });
    this.activeSignerId.set(id);
    this.closeAddSigner();
  }

  /** Reordenar firmantes (solo tiene sentido en modo secuencial; CDK drag-drop). */
  dropSigner(event: CdkDragDrop<EditorSigner[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    this.signers.update(list => {
      const next = [...list];
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      return next;
    });
  }

  // ---------- reglas ----------

  setSequential(sequential: boolean): void {
    this.rules.update(r => ({ ...r, sequential }));
  }

  /** Canales de ENTREGA reales (por firmante). 'app' no entrega a firmantes externos, se excluye. */
  readonly deliveryChannels: VerificationChannel[] = ['email', 'sms', 'whatsapp', 'none'];

  /** Canal por defecto para firmantes NUEVOS (chips): se guarda como primer elemento de rules.channels. */
  setDefaultChannel(channel: VerificationChannel): void {
    this.rules.update(r => ({ ...r, channels: [channel] }));
  }

  /** Fija el canal de UN firmante (incluido el cliente). Es lo que decide su invitación + OTP. */
  setSignerChannel(signerId: string, channel: VerificationChannel): void {
    this.signers.update(list => list.map(s => (s.id === signerId ? { ...s, channel } : s)));
  }

  /** Edita el teléfono de UN firmante (necesario para SMS/WhatsApp). */
  setSignerPhone(signerId: string, phone: string): void {
    this.signers.update(list => list.map(s => (s.id === signerId ? { ...s, phone } : s)));
  }

  /** true si el canal del firmante exige teléfono (SMS/WhatsApp) y no lo tiene: hay que pedirlo. */
  signerNeedsPhone(signer: EditorSigner): boolean {
    return channelRequiresPhone(signer.channel) && signer.phone.trim().length === 0;
  }

  /** Firmantes con canal SMS/WhatsApp pero sin teléfono — bloquean avanzar (no se les puede entregar el OTP). */
  readonly signersMissingPhone = computed(() => this.signers().filter(s => this.signerNeedsPhone(s)));

  /** Resumen de los canales realmente en uso por los firmantes (distintos), para el panel Summary. */
  readonly signerChannelSummary = computed(() => {
    const labels = [...new Set(this.signers().map(s => this.channelMeta[s.channel].label))];
    return labels.length > 0 ? labels.join(', ') : '—';
  });

  /** Intervalo de recordatorio en DÍAS (deriva de las horas del modelo). */
  readonly reminderIntervalDays = computed(() => Math.max(1, Math.round(this.rules().reminderIntervalHours / 24)));

  /** Fija el intervalo desde el input en días (1..30); persiste en horas. */
  setReminderIntervalDays(days: number): void {
    const clamped = Math.min(30, Math.max(1, Math.round(days) || 1));
    this.rules.update(r => ({ ...r, reminderIntervalHours: clamped * 24 }));
  }

  toggleRule(
    key: 'autoReminder' | 'certificate' | 'includePreparerSignature' | 'sendSignedDocument' | 'sendCertificate',
  ): void {
    // Entregar el certificado exige que el certificado se genere: si está apagado, no se puede activar.
    if (key === 'sendCertificate' && !this.rules().certificate) {
      return;
    }
    this.rules.update(r => ({ ...r, [key]: !r[key] }));
  }

  /** Practitioner PIN (Form 8879): solo dígitos, máx 10; vacío = sin PIN (null). El backend exige 4–10. */
  setSigningPin(value: string): void {
    const digits = (value ?? '').replace(/\D/g, '').slice(0, 10);
    this.rules.update(r => ({ ...r, signingPin: digits.length > 0 ? digits : null }));
  }

  /** true si hay un PIN escrito pero con longitud inválida (1–3 dígitos) — bloquea avanzar. */
  readonly signingPinInvalid = computed(() => {
    const pin = this.rules().signingPin ?? '';
    return pin.length > 0 && pin.length < 4;
  });

  getRules(): RequestRules {
    return this.rules();
  }

  removeSigner(id: string): void {
    if (id.startsWith('client:')) {
      return; // el cliente es firmante obligatorio
    }
    this.signers.update(list => list.filter(s => s.id !== id));
    this.fields.update(list => list.filter(f => f.signerId !== id));
    if (this.activeSignerId() === id) {
      this.activeSignerId.set(this.signers()[0]?.id ?? null);
    }
    this.emitCount();
  }

  private syncClientSigner(): void {
    const client = this.client;
    this.signers.update(list => {
      const extras = list.filter(s => !s.id.startsWith('client:'));
      if (!client) {
        return extras;
      }
      const clientSigner: EditorSigner = {
        id: `client:${client.id}`,
        name: client.displayName,
        email: client.email,
        color: SIGNER_PALETTE[0].bg,
        channel: this.defaultSignerChannel(),
        phone: client.phone ?? '',
        language: 'En',
      };
      return [clientSigner, ...extras];
    });
    if (!this.activeSignerId() || !this.signers().some(s => s.id === this.activeSignerId())) {
      this.activeSignerId.set(this.signers()[0]?.id ?? null);
    }
  }

  // ---------- campos ----------

  fieldsForPage(page: number): PlacedField[] {
    return this.fields().filter(f => f.page === page);
  }

  /** Icono/círculo pastel del tipo de documento (summary y toolbar). */
  docIcon(kind: WizardDocKind): string {
    return kindIcon(kind);
  }

  docCircle(kind: WizardDocKind): string {
    return kindCircle(kind);
  }

  /** trackBy por id: el drag reemplaza los objetos del array y sin esto Angular
   * recrearía el nodo en cada pointermove (re-disparando la animación field-in). */
  trackField(_index: number, field: PlacedField): string {
    return field.id;
  }

  addField(type: FieldType): void {
    const signerId = this.activeSignerId();
    const first = this.pages()[0];
    if (!signerId || !first) {
      return;
    }
    const size = DEFAULT_SIZE[type];
    const count = this.fields().length;
    const field: PlacedField = {
      id: `field-${this.seq++}`,
      type,
      page: first.page,
      x: Math.max(8, (first.width - size.w) / 2),
      y: clamp(120 + (count % 6) * 16, 8, first.height - size.h - 8),
      width: size.w,
      height: size.h,
      signerId,
    };
    this.fields.update(list => [...list, field]);
    this.emitCount();
  }

  removeField(id: string): void {
    this.fields.update(list => list.filter(f => f.id !== id));
    this.emitCount();
  }

  /** Fija la etiqueta/instrucción de un campo de texto (P4); la ve el firmante como placeholder. */
  setFieldLabel(id: string, label: string): void {
    this.fields.update(list => list.map(f => (f.id === id ? { ...f, label } : f)));
  }

  borderClass(signerId: string): string {
    return this.paletteFor(signerId).border;
  }

  textClass(signerId: string): string {
    return this.paletteFor(signerId).text;
  }

  private paletteFor(signerId: string): (typeof SIGNER_PALETTE)[number] {
    const color = this.signers().find(s => s.id === signerId)?.color;
    return SIGNER_PALETTE.find(p => p.bg === color) ?? SIGNER_PALETTE[SIGNER_PALETTE.length - 1];
  }

  // ---------- drag & resize ----------

  startMove(event: PointerEvent, field: PlacedField): void {
    event.preventDefault();
    event.stopPropagation();
    const overlay = event.currentTarget as HTMLElement;
    const pageEl = overlay.parentElement;
    if (!pageEl) {
      return;
    }
    const rect = pageEl.getBoundingClientRect();
    this.drag = {
      id: field.id,
      mode: 'move',
      pageLeft: rect.left,
      pageTop: rect.top,
      pageW: pageEl.clientWidth,
      pageH: pageEl.clientHeight,
      offsetX: event.clientX - rect.left - field.x,
      offsetY: event.clientY - rect.top - field.y,
      startX: field.x,
      startY: field.y,
      startW: field.width,
      startH: field.height,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    };
    this.setActiveSigner(field.signerId);
  }

  startResize(event: PointerEvent, field: PlacedField): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const pageEl = handle.parentElement?.parentElement;
    if (!pageEl) {
      return;
    }
    const rect = pageEl.getBoundingClientRect();
    this.drag = {
      id: field.id,
      mode: 'resize',
      pageLeft: rect.left,
      pageTop: rect.top,
      pageW: pageEl.clientWidth,
      pageH: pageEl.clientHeight,
      offsetX: 0,
      offsetY: 0,
      startX: field.x,
      startY: field.y,
      startW: field.width,
      startH: field.height,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    };
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d) {
      return;
    }
    event.preventDefault();
    if (d.mode === 'move') {
      const x = clamp(event.clientX - d.pageLeft - d.offsetX, 0, d.pageW - d.startW);
      const y = clamp(event.clientY - d.pageTop - d.offsetY, 0, d.pageH - d.startH);
      this.fields.update(list => list.map(f => (f.id === d.id ? { ...f, x, y } : f)));
    } else {
      const min = MIN_SIZE_BY_TYPE[this.fields().find(f => f.id === d.id)?.type ?? 'text'];
      const width = clamp(d.startW + (event.clientX - d.startPointerX), min.w, d.pageW - d.startX);
      const height = clamp(d.startH + (event.clientY - d.startPointerY), min.h, d.pageH - d.startY);
      this.fields.update(list => list.map(f => (f.id === d.id ? { ...f, width, height } : f)));
    }
  }

  @HostListener('document:pointerup')
  onPointerUp(): void {
    this.drag = null;
  }

  // ---------- API pública para el wizard ----------

  getFields(): PlacedField[] {
    return this.fields();
  }

  getSigners(): EditorSigner[] {
    return this.signers();
  }

  getPageMetrics(page: number): PageMetrics | null {
    const found = this.pages().find(p => p.page === page);
    return found ? { scale: found.scale, height: found.height } : null;
  }

  /**
   * Campos en coordenadas normalizadas [0..1] (origen arriba-izquierda), la
   * convención que exige FieldPosition en el backend. Se divide por el tamaño en
   * px de la página renderizada actual, así el resultado es independiente del zoom.
   */
  buildNormalizedFields(): NormalizedPlacedField[] {
    const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
    const round = (value: number): number => Math.round(value * 10000) / 10000;
    const out: NormalizedPlacedField[] = [];
    for (const field of this.fields()) {
      const page = this.pages().find(p => p.page === field.page);
      if (!page || page.width <= 0 || page.height <= 0) {
        continue;
      }
      const x = round(clamp01(field.x / page.width));
      const y = round(clamp01(field.y / page.height));
      let width = round(clamp01(field.width / page.width));
      let height = round(clamp01(field.height / page.height));
      // El backend rechaza x+width > 1 (overflow): tras el redondeo se recorta.
      if (x + width > 1) {
        width = round(1 - x);
      }
      if (y + height > 1) {
        height = round(1 - y);
      }
      if (width <= 0 || height <= 0) {
        continue;
      }
      out.push({
        localId: field.id,
        signerLocalId: field.signerId,
        type: field.type,
        page: field.page,
        x,
        y,
        width,
        height,
        label: field.type === 'text' ? field.label?.trim() || undefined : undefined,
      });
    }
    return out;
  }

  /** Payload por firmante con las cajas ya en puntos PDF (lo que iría al backend). */
  buildPdfPayload(): { signerId: string; name: string; email: string; rects: PdfRect[] }[] {
    const bySigner = new Map<string, PdfRect[]>();
    for (const field of this.fields()) {
      const metrics = this.getPageMetrics(field.page);
      if (!metrics) {
        continue;
      }
      const list = bySigner.get(field.signerId) ?? [];
      list.push(screenRectToPdf(field, metrics));
      bySigner.set(field.signerId, list);
    }
    return this.signers().map(s => ({
      signerId: s.id,
      name: s.name,
      email: s.email,
      rects: bySigner.get(s.id) ?? [],
    }));
  }

  // ---------- render ----------

  private emitCount(): void {
    this.fieldCountChange.emit(this.fields().length);
  }

  private effectiveScale(): number {
    return BASE_SCALE * this.zoom();
  }

  // ---------- zoom ----------

  zoomIn(): void {
    this.applyZoom(Math.min(ZOOM_MAX, Math.round((this.zoom() + ZOOM_STEP) * 100) / 100));
  }

  zoomOut(): void {
    this.applyZoom(Math.max(ZOOM_MIN, Math.round((this.zoom() - ZOOM_STEP) * 100) / 100));
  }

  private applyZoom(next: number): void {
    const current = this.zoom();
    if (next === current) {
      return;
    }
    // Los campos viven en px de pantalla de la escala actual: se reescalan por el
    // ratio para que sigan cayendo sobre el mismo punto del PDF (el transform
    // pantalla→PDF usa la escala que viaja en cada RenderedPage).
    const ratio = (BASE_SCALE * next) / (BASE_SCALE * current);
    this.zoom.set(next);
    this.fields.update(list =>
      list.map(f => ({ ...f, x: f.x * ratio, y: f.y * ratio, width: f.width * ratio, height: f.height * ratio })),
    );
    void this.rerenderAtZoom();
  }

  /** Re-render por zoom: sin flag de loading (las páginas actuales quedan hasta ser reemplazadas). */
  private async rerenderAtZoom(): Promise<void> {
    const token = ++this.loadToken;
    const scale = this.effectiveScale();
    try {
      const pages = this.docBytes
        ? // pdf.js transfiere el buffer al worker: se pasa una copia para conservar el cache.
          await renderPdfPages({ data: this.docBytes.slice() }, scale)
        : blankPages(Math.max(1, this.pages().length), scale);
      if (token === this.loadToken) {
        this.pages.set(pages);
      }
    } catch (err) {
      console.error('[signature] zoom re-render failed', err);
    }
  }

  // ---------- carga del documento ----------

  retryLoad(): void {
    void this.loadDocument();
  }

  private async loadDocument(): Promise<void> {
    const token = ++this.loadToken;
    this.fields.set([]);
    this.emitCount();
    this.docBytes = null;
    this.zoom.set(1);

    const doc = this.document;
    if (!doc) {
      this.pages.set([]);
      return;
    }

    this.loading.set(true);
    this.loadError.set('');
    try {
      // Cadena de fuentes: bytes subidos → sample PDF → páginas en blanco.
      if (doc.blob && doc.kind === 'pdf') {
        this.docBytes = new Uint8Array(await doc.blob.arrayBuffer());
      } else if (doc.kind === 'pdf') {
        const res = await fetch('/assets/sample-document.pdf');
        if (!res.ok) {
          throw new Error(`sample PDF fetch failed (${res.status})`);
        }
        this.docBytes = new Uint8Array(await res.arrayBuffer());
      }
      const pages = this.docBytes
        ? await renderPdfPages({ data: this.docBytes.slice() }, this.effectiveScale())
        : blankPages(3, this.effectiveScale());
      if (token !== this.loadToken) {
        return;
      }
      this.pages.set(pages);
    } catch (err) {
      if (token !== this.loadToken) {
        return;
      }
      console.error('[signature] PDF render failed', err);
      this.loadError.set(`Could not render the document (${err instanceof Error ? err.message : String(err)}).`);
      this.docBytes = null;
      this.pages.set(blankPages(3, this.effectiveScale()));
    } finally {
      if (token === this.loadToken) {
        this.loading.set(false);
      }
    }
  }
}
