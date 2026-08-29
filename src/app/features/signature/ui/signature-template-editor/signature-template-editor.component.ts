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
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SignatureService } from '../../data-access/signature.service';
import {
  SIGNATURE_CATEGORIES,
  SIGNATURE_CATEGORY_LABEL,
  SignatureCategory,
  SignatureTemplateDetail,
  SignerLanguage,
  SignerVerificationMethod,
  TemplateSlotResponse,
  fieldTypeToKind,
} from '../../data-access/signature.model';
import { FieldType } from '../signature-request-panel/signature-wizard.model';
import { FIELD_TYPE_ICON, FIELD_TYPE_LABEL } from '../signature-request-panel/signature-wizard.presenter';
import { RenderedPage, blankPages, renderPdfPages } from '../../utils/pdf-render.util';

const MIN_W = 48;
const MIN_H = 28;
const BASE_SCALE = 1.2;

/** Paleta por slot (mismo criterio de color estable que el editor de firmas). */
const SLOT_PALETTE = [
  { bg: 'bg-brand-bold', border: 'border-brand-bold', text: 'text-brand-bold' },
  { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-600' },
  { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-600' },
  { bg: 'bg-sky-600', border: 'border-sky-600', text: 'text-sky-700' },
  { bg: 'bg-brand-ink', border: 'border-brand-ink', text: 'text-brand-ink' },
];

const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 200, h: 60 },
  initials: { w: 90, h: 50 },
  date: { w: 130, h: 40 },
  text: { w: 170, h: 40 },
};

/** Campo colocado sobre la superficie de layout (px de pantalla a la escala actual). */
interface TemplateFieldLocal {
  localId: string;
  slotOrder: number;
  type: FieldType;
  /** 1-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

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
 * Editor de autoría de una plantilla de firma (`/signature/templates`). Reutiliza las
 * mismas utilidades de render/coordenadas que el wizard de solicitudes, PERO es un
 * componente aparte: la plantilla trabaja con SLOTS (roles) en vez de firmantes con
 * email, y el layout se coloca sobre una superficie de muestra (PDF subido o páginas en
 * blanco) porque el documento real llega recién al instanciar.
 *
 * Estrategia de persistencia:
 *  - Metadatos/defaults y slots se guardan INCREMENTALMENTE contra el backend (el backend
 *    es la fuente de verdad del `order` de cada slot) y se recarga el detalle.
 *  - Los campos se editan en local (drag/resize) y se persisten con "Save layout" como
 *    reemplazo total (borra los del server y re-postea los locales): no hay endpoint de
 *    update de campo, así que reemplazar es lo único consistente.
 */
@Component({
  selector: 'app-signature-template-editor',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-template-editor.component.html',
  styleUrl: './signature-template-editor.component.css',
})
export class SignatureTemplateEditorComponent implements OnChanges {
  private readonly service = inject(SignatureService);

  @Input() templateId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  /** Se emite cuando cambió algo persistido (para refrescar la lista al volver). */
  @Output() changed = new EventEmitter<void>();

  readonly categories = SIGNATURE_CATEGORIES;
  readonly categoryLabel = SIGNATURE_CATEGORY_LABEL;
  readonly fieldTypes: FieldType[] = ['signature', 'initials', 'date', 'text'];
  readonly fieldLabel = FIELD_TYPE_LABEL;
  readonly fieldIcon = FIELD_TYPE_ICON;
  readonly languageOptions: ReadonlyArray<{ value: SignerLanguage; label: string }> = [
    { value: 'En', label: 'English' },
    { value: 'Es', label: 'Español' },
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

  // ---------- Metadatos / defaults (form) ----------
  readonly title = signal('');
  readonly description = signal('');
  readonly category = signal<SignatureCategory>('Fiscal');
  readonly expirationHours = signal(168);
  readonly sequential = signal(false);
  readonly consent = signal(true);
  readonly certificate = signal(true);

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

  private drag: DragState | null = null;
  private seq = 0;

  // ---------- Derivados ----------

  readonly slots = computed(() => [...(this.detail()?.slots ?? [])].sort((a, b) => a.order - b.order));
  readonly isDraft = computed(() => this.detail()?.status === 'Draft');
  readonly isPublished = computed(() => this.detail()?.status === 'Published');

  readonly hasSignatureField = computed(() =>
    this.fields().some(f => f.type === 'signature' || f.type === 'initials'),
  );
  readonly canPublish = computed(
    () => this.isDraft() && this.slots().length > 0 && this.hasSignatureField() && !this.layoutDirty(),
  );

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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['templateId']) {
      void this.load();
    }
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
    try {
      const detail = await firstValueFrom(this.service.getTemplate(id));
      this.applyDetail(detail);
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  private applyDetail(detail: SignatureTemplateDetail): void {
    this.detail.set(detail);
    this.title.set(detail.title);
    this.description.set(detail.description ?? '');
    this.category.set(detail.category);
    this.expirationHours.set(detail.defaultTokenExpirationHours);
    this.sequential.set(detail.requiresSequentialSigning);
    this.consent.set(detail.requiresConsent);
    this.certificate.set(detail.generateCertificate);
    if (this.activeSlotOrder() === null || !detail.slots.some(s => s.order === this.activeSlotOrder())) {
      this.activeSlotOrder.set([...detail.slots].sort((a, b) => a.order - b.order)[0]?.order ?? null);
    }
    void this.rebuildSurface(detail);
  }

  /** Superficie de layout: páginas en blanco tamaño carta + campos del server → px de pantalla. */
  private async rebuildSurface(detail: SignatureTemplateDetail): Promise<void> {
    const pageCount = Math.max(1, ...detail.fields.map(f => f.page));
    const pages = this.pages().length > 0 && this.pages()[0].src ? this.pages() : blankPages(pageCount, BASE_SCALE);
    this.pages.set(pages);
    this.fields.set(
      detail.fields.map(f => {
        const page = pages.find(p => p.page === f.page) ?? pages[0];
        return {
          localId: `srv-${f.id}`,
          slotOrder: f.slotOrder,
          type: kindToType(f.kind),
          page: page.page,
          x: f.x * page.width,
          y: f.y * page.height,
          width: f.width * page.width,
          height: f.height * page.height,
        };
      }),
    );
    this.layoutDirty.set(false);
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
          generateCertificate: this.certificate(),
        }),
      );
      await this.reload();
      this.changed.emit();
    });
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
      // El backend puede renumerar: se recarga y se reconstruyen los campos desde el server.
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
    if (!file) {
      return;
    }
    if (file.type !== 'application/pdf') {
      this.pdfError.set('Only a PDF can be used as the layout sample.');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pages = await renderPdfPages({ data: bytes }, BASE_SCALE);
      this.remapFieldsToPages(pages);
      this.pages.set(pages);
    } catch (err) {
      this.pdfError.set(`Could not render that PDF (${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  clearSample(): void {
    const pages = blankPages(Math.max(1, ...this.fields().map(f => f.page)), BASE_SCALE);
    this.remapFieldsToPages(pages);
    this.pages.set(pages);
  }

  /** Reubica los campos existentes proporcionalmente al cambiar la superficie (px cambian de tamaño). */
  private remapFieldsToPages(next: RenderedPage[]): void {
    const prev = this.pages();
    this.fields.update(list =>
      list.map(f => {
        const from = prev.find(p => p.page === f.page);
        const to = next.find(p => p.page === f.page) ?? next[0];
        if (!from || !to) {
          return f;
        }
        const rx = to.width / from.width;
        const ry = to.height / from.height;
        return { ...f, page: to.page, x: f.x * rx, y: f.y * ry, width: f.width * rx, height: f.height * ry };
      }),
    );
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

  addField(type: FieldType): void {
    const slotOrder = this.activeSlotOrder();
    const first = this.pages()[0];
    if (slotOrder === null || !first) {
      return;
    }
    const size = DEFAULT_SIZE[type];
    const count = this.fields().length;
    this.fields.update(list => [
      ...list,
      {
        localId: `f-${this.seq++}`,
        slotOrder,
        type,
        page: first.page,
        x: Math.max(8, (first.width - size.w) / 2),
        y: clamp(120 + (count % 6) * 16, 8, first.height - size.h - 8),
        width: size.w,
        height: size.h,
      },
    ]);
    this.layoutDirty.set(true);
  }

  removeField(localId: string): void {
    this.fields.update(list => list.filter(f => f.localId !== localId));
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

  // ---------- drag & resize (mismo patrón que el editor de firmas) ----------

  startMove(event: PointerEvent, field: TemplateFieldLocal): void {
    event.preventDefault();
    event.stopPropagation();
    const overlay = event.currentTarget as HTMLElement;
    const pageEl = overlay.parentElement;
    if (!pageEl) {
      return;
    }
    const rect = pageEl.getBoundingClientRect();
    this.drag = {
      id: field.localId,
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
    this.setActiveSlot(field.slotOrder);
  }

  startResize(event: PointerEvent, field: TemplateFieldLocal): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const pageEl = handle.parentElement?.parentElement;
    if (!pageEl) {
      return;
    }
    const rect = pageEl.getBoundingClientRect();
    this.drag = {
      id: field.localId,
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
      this.fields.update(list => list.map(f => (f.localId === d.id ? { ...f, x, y } : f)));
    } else {
      const width = clamp(d.startW + (event.clientX - d.startPointerX), MIN_W, d.pageW - d.startX);
      const height = clamp(d.startH + (event.clientY - d.startPointerY), MIN_H, d.pageH - d.startY);
      this.fields.update(list => list.map(f => (f.localId === d.id ? { ...f, width, height } : f)));
    }
    this.layoutDirty.set(true);
  }

  @HostListener('document:pointerup')
  onPointerUp(): void {
    this.drag = null;
  }

  // ------------------------------------------------------------------
  // Guardar layout (reemplazo total) + publicar
  // ------------------------------------------------------------------

  async saveLayout(): Promise<void> {
    const id = this.templateId;
    const detail = this.detail();
    if (!id || !detail || this.busy()) {
      return;
    }
    await this.run('Saving layout…', async () => {
      // Reemplazo total: borra los campos del server y re-postea los locales normalizados.
      for (const existing of detail.fields) {
        await firstValueFrom(this.service.removeTemplateField(id, existing.id));
      }
      for (const field of this.buildNormalizedFields()) {
        await firstValueFrom(
          this.service.placeTemplateField(id, {
            slotOrder: field.slotOrder,
            kind: fieldTypeToKind(field.type),
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            label: null,
            isRequired: true,
          }),
        );
      }
      await this.reload();
      this.changed.emit();
    });
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

  close(): void {
    if (this.busy()) {
      return;
    }
    this.closed.emit();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Campos en coordenadas normalizadas [0..1] (origen arriba-izquierda) para el backend. */
  private buildNormalizedFields(): { slotOrder: number; type: FieldType; page: number; x: number; y: number; width: number; height: number }[] {
    const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
    const round = (v: number): number => Math.round(v * 10000) / 10000;
    const out: { slotOrder: number; type: FieldType; page: number; x: number; y: number; width: number; height: number }[] = [];
    for (const field of this.fields()) {
      const page = this.pages().find(p => p.page === field.page);
      if (!page || page.width <= 0 || page.height <= 0) {
        continue;
      }
      const x = round(clamp01(field.x / page.width));
      const y = round(clamp01(field.y / page.height));
      let width = round(clamp01(field.width / page.width));
      let height = round(clamp01(field.height / page.height));
      if (x + width > 1) {
        width = round(1 - x);
      }
      if (y + height > 1) {
        height = round(1 - y);
      }
      if (width <= 0 || height <= 0) {
        continue;
      }
      out.push({ slotOrder: field.slotOrder, type: field.type, page: field.page, x, y, width, height });
    }
    return out;
  }

  private async reload(): Promise<void> {
    const id = this.templateId;
    if (!id) {
      return;
    }
    const detail = await firstValueFrom(this.service.getTemplate(id));
    this.applyDetail(detail);
  }

  private async run(label: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.busyLabel.set(label);
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
      this.busyLabel.set('');
    }
  }
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
