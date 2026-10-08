import { normalizeFieldRect, denormalizeFieldRect } from '../../utils/field-normalize.util';
import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  EditorSeed,
  EditorSeedField,
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
import { SetPreparerBody, SignerLanguage, channelRequiresPhone } from '../../data-access/signature.model';
import { SignatureStore } from '../../data-access/signature.store';
import {
  CHANNEL_META,
  FIELD_TYPE_CIRCLE,
  FIELD_TYPE_ICON,
  FIELD_TYPE_LABEL,
  clientTypeBadge,
  defaultRules,
  kindCircle,
  kindIcon,
} from '../signature-request-panel/signature-wizard.presenter';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';
import {
  PDF_RENDER_FRIENDLY_ERROR,
  RenderedPage,
  blankPages,
  isPdfRenderAborted,
  renderPdfPages,
} from '../../utils/pdf-render.util';
import { nextSeqAfter } from '../../utils/editor-id-seq.util';
import {
  clampToPage,
  copyFieldToAllPages,
  duplicateFieldRect,
  nudgeField,
  reassignSignerFields,
  remapFieldsToPages,
  rescaleFieldsBetweenPages,
  scaleSize,
  signerFieldCount,
  signersMissingSignature,
} from '../../utils/editor-fields.util';
import { ReadinessItem, buildReadinessChecklist } from '../../utils/editor-readiness.util';
import { isSigningPinInvalid, withSequential } from '../../utils/request-rules.util';
import {
  PDF_EDITOR_INSPECTOR_COLLAPSED_KEY,
  readPanelCollapsed,
  writePanelCollapsed,
} from '../../utils/panel-collapse.util';
import { StampFontSizeResult, stampFontSizeForBox } from '../../utils/stamp-font-size.util';
import { startPointerDrag } from '../../utils/pointer-drag.util';
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
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';
import { PermissionService } from '../../../../core/auth/permission.service';
import { AuthService } from '../../../../core/auth/auth.service';

const MIN_W = 48;
const MIN_H = 28;

/**
 * Mínimo de tamaño POR TIPO al redimensionar, en px a zoom 100% (se escala por el zoom actual).
 * Una firma/iniciales se sella como un cuño apilado (firma + fecha, y caption si cabe): por debajo
 * de ~44px de alto la firma queda diminuta y se encarama sobre la fecha en el PDF. Fecha/texto sí
 * pueden ser más bajos. Evita que el preparador achique el campo a algo inusable.
 */
const MIN_SIZE_BY_TYPE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 120, h: 44 },
  // Las iniciales son una marca pequeña: se permite achicarlas bastante (antes 64×40 las dejaba grandes).
  initials: { w: 40, h: 24 },
  date: { w: MIN_W, h: MIN_H },
  text: { w: MIN_W, h: MIN_H },
};

/** Escala base del render (100% de zoom). */
const BASE_SCALE = 1.2;
/** 0.4 permite "Fit width" en móvil (una carta a 1.2 mide ~734px). */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;
/** Por debajo de este ancho de ventana (lg) el documento arranca en "Fit width". */
const FIT_WIDTH_BELOW_PX = 1024;

const SIGNER_PALETTE = [
  { bg: 'bg-indigo-500', border: 'border-indigo-500', text: 'text-indigo-600' },
  { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-600' },
  { bg: 'bg-brand-bold', border: 'border-brand-bold', text: 'text-brand-bold' },
  { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-600' },
  { bg: 'bg-brand-bold', border: 'border-brand-bold', text: 'text-gray-900' },
];

/** Tamaño por defecto de cada tipo, en px a zoom 100% (se escala por el zoom actual al colocar). */
const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 200, h: 60 },
  initials: { w: 90, h: 50 },
  date: { w: 130, h: 40 },
  text: { w: 170, h: 40 },
};

/** Lo que se está colocando con "clic en la página": un tipo de campo del firmante o la firma del preparador. */
export type PlacingKind = FieldType | 'preparer';

/** Fantasma del arrastre desde la paleta: mismo aspecto y tamaño (al zoom actual) que el campo colocado. */
export interface PaletteGhost {
  kind: PlacingKind;
  type: FieldType;
  /** Firmante destino (color del fantasma y de la vista previa); PREPARER_PARTY_ID para el preparador. */
  signerId: string;
  width: number;
  height: number;
  /** true mientras el puntero está sobre una página (si no, estado "no se puede soltar aquí"). */
  overPage: boolean;
  phase: 'drag' | 'settle' | 'return';
}

/** Dónde caerá el campo si se suelta ahora (px de la página). */
export interface DropPreview {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Paneles de pantallas angostas (popover en tablet, hoja inferior en móvil). */
export type NarrowPanel = 'signers' | 'fields' | 'checklist' | 'zoom';

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
  documentLocalId: string;
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
 * Paso 3 del wizard: editor de colocación de campos sobre el PDF.
 *
 * Distribución compacta (ver plan C/E):
 * - riel izquierdo: firmantes (fila compacta + menú "…" de canal/teléfono/quitar) y paleta 2×2
 *   "Fields for <firmante>"; la firma del preparador va plegada debajo;
 * - centro: toolbar (zoom −/+, Fit width, Page X / N) y el documento a alto de viewport;
 * - derecha: inspector del campo seleccionado o, sin selección, la lista "Before you continue".
 * En < xl el inspector flota sobre el documento (lg) o es una hoja inferior (< lg); en < lg los
 * firmantes y la paleta se abren desde la barra superior (tablet) o la barra fija inferior (móvil).
 *
 * Coordenadas: los campos viven en px de la página renderizada; `buildNormalizedFields()` los pasa
 * a [0..1] con `normalizeFieldRect` (misma salida de siempre). Las coordenadas que envía al backend
 * ya salen normalizadas [0..1]. Las REGLAS de la solicitud (orden de firma, etc.) se mueven al
 * editor (F2.5-signing-order) y siguen viviendo aquí (`rules`, `getRules()`, `setRules()`).
 */
@Component({
  selector: 'app-signature-pdf-editor',
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    AvatarComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    ClickOutsideDirective,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-pdf-editor.component.html',
  styleUrl: './signature-pdf-editor.component.css',
})
export class SignaturePdfEditorComponent implements OnChanges, AfterViewInit {
  @Input() client: WizardClient | null = null;
  @Input() document: WizardDocument | null = null;
  /** Siembra al continuar un borrador: firmantes + campos + reglas ya existentes. */
  @Input() seed: EditorSeed | null = null;
  /**
   * true = al cambiar de documento se CONSERVAN los campos (misma posición relativa por página).
   * Lo fija el panel tras confirmar "Keep fields" al re-elegir el documento; por defecto se limpian.
   */
  @Input() keepFieldsOnDocumentChange = false;
  /** Nº de campos colocados (incluye los del preparador). Se emite desde un effect, nunca en ngOnChanges. */
  @Output() fieldCountChange = new EventEmitter<number>();
  /** F2.5: cada vez que el editor consolida un cambio (campo, firmante, regla…). El panel autoguarda. */
  @Output() editorStateChanged = new EventEmitter<void>();

  @ViewChild('surface') private surfaceRef?: ElementRef<HTMLElement>;
  @ViewChild('ghostEl') private ghostRef?: ElementRef<HTMLElement>;

  readonly fieldTypes: FieldType[] = ['signature', 'initials', 'date', 'text'];
  readonly fieldLabel = FIELD_TYPE_LABEL;
  readonly fieldIcon = FIELD_TYPE_ICON;
  readonly fieldCircle = FIELD_TYPE_CIRCLE;

  readonly pages = signal<RenderedPage[]>([]);
  readonly loading = signal(false);
  /** Mensaje amable del último render fallido ('' = sin error). Nunca el err.message de pdf.js. */
  readonly loadError = signal('');
  /** Aviso no bloqueante (p. ej. campos descartados al cambiar a un documento con menos páginas). */
  readonly notice = signal('');

  /** Zoom APLICADO (el de las páginas y campos actuales; 1 = 100%). */
  readonly zoom = signal(1);
  /** Zoom en curso de render (null = ninguno). Hasta que el render termina bien no se toca nada. */
  readonly pendingZoom = signal<number | null>(null);
  readonly zoomError = signal('');
  readonly rerendering = computed(() => this.pendingZoom() !== null);
  readonly zoomPercent = computed(() => Math.round((this.pendingZoom() ?? this.zoom()) * 100));
  readonly canZoomIn = computed(() => this.hasRenderedPages() && (this.pendingZoom() ?? this.zoom()) < ZOOM_MAX);
  readonly canZoomOut = computed(() => this.hasRenderedPages() && (this.pendingZoom() ?? this.zoom()) > ZOOM_MIN);

  /** Bytes del PDF cacheados (subido o sample) para re-render por zoom/retry sin re-fetch. */
  private docBytes: Uint8Array | null = null;
  private loadedDocumentId: string | null = null;
  private readonly pageMetricsByDocument = new Map<string, RenderedPage[]>();
  /** Páginas del último render correcto (para conservar campos al cambiar de documento). */
  private lastRenderedPages: RenderedPage[] = [];
  private renderAbort: AbortController | null = null;

  readonly signers = signal<EditorSigner[]>([]);
  readonly activeSignerId = signal<string | null>(null);
  readonly fields = signal<PlacedField[]>([]);

  /** Campo seleccionado (inspector + atajos de teclado). */
  readonly selectedFieldId = signal<string | null>(null);
  readonly selectedField = computed(() => this.fields().find(f => f.id === this.selectedFieldId()) ?? null);
  /** Tipo armado para "clic en la página para colocar" (null = modo normal). */
  readonly placingType = signal<PlacingKind | null>(null);
  /** Página visible (toolbar "Page X / N" y botón "colocar en la página visible"). */
  readonly currentPage = signal(1);

  /** Pantallas angostas: panel abierto (Signers / Fields / Before you continue). */
  readonly narrowPanel = signal<NarrowPanel | null>(null);
  /** lg: lista "Before you continue" flotando sobre el documento (sin campo seleccionado). */
  readonly floatingChecklistOpen = signal(false);
  /** lg: riel plegado a iconos. */
  readonly railCollapsed = signal(false);
  /**
   * xl: columna derecha (inspector / "Before you continue") plegada; el documento ocupa su sitio.
   * Se recuerda en localStorage. Seleccionar un campo NO la reabre: la toolbar muestra un aviso.
   */
  readonly inspectorCollapsed = signal(readPanelCollapsed(PDF_EDITOR_INSPECTOR_COLLAPSED_KEY));
  /** Firmante cuyo teléfono se está editando desde el menú "…". */
  readonly editingPhoneFor = signal<string | null>(null);
  /** Menús "…" abiertos (para que Escape los cierre antes de tocar el wizard). */
  private openMenus = 0;

  /** true tras cualquier cambio del usuario (el panel pregunta antes de descartar). */
  readonly dirty = signal(false);

  /** Reglas de la solicitud: se editan en el paso Review (mismo signal, mismo payload). */
  readonly rules = signal<RequestRules>(defaultRules());
  readonly channelMeta = CHANNEL_META;

  private readonly perms = inject(PermissionService);
  /** P2/P8: los toggles de entrega solo se muestran a quien puede entregar (signature.document.send). */
  readonly canDeliverDocs = computed(() => this.perms.has('signature.document.send'));

  private readonly store = inject(SignatureStore);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  /** Firmas seleccionables para estampar (propias + oficina, no archivadas). */
  readonly signatureOptions = computed(() => this.store.activeSignatureProfiles());
  /** Firma elegida explícitamente en el selector (null = usar la sembrada o la default). */
  readonly selectedSignatureId = signal<string | null>(null);
  /** FileId de la firma del preparador que traía el borrador rehidratado (para preseleccionarla). */
  private readonly seededPreparerFileId = signal<string | null>(null);
  /** Firma reutilizable que se previsualizará/estampará: selección → sembrada → default. */
  readonly previewedSignature = computed(() => {
    const profiles = this.store.signatureProfiles();
    const selected = this.selectedSignatureId();
    if (selected) {
      const found = profiles.find(p => p.id === selected && !p.isArchived);
      if (found) {
        return found;
      }
    }
    const seededFileId = this.seededPreparerFileId();
    if (seededFileId) {
      const seeded = profiles.find(p => p.fileId === seededFileId && !p.isArchived);
      if (seeded) {
        return seeded;
      }
    }
    return this.store.defaultSignatureProfile();
  });
  readonly hasPreparerSignature = computed(() => this.previewedSignature() !== null);
  /** true cuando hay al menos un campo del preparador colocado sobre el PDF. */
  readonly hasPlacedPreparerField = computed(() => this.fields().some(f => this.isPreparerField(f)));
  /** Bloque "Preparer signature" plegable (plegado por defecto: no le come espacio a los firmantes). */
  readonly preparerOpen = signal(false);
  togglePreparerPanel(): void {
    this.preparerOpen.update(v => !v);
  }

  onSelectSignature(id: string): void {
    this.selectedSignatureId.set(id);
    this.markDirty();
  }

  /** Nombre del usuario logueado (perfil /auth/me) para autollenar la identidad 8879. */
  private currentUserFullName(): string {
    const me = this.auth.currentUser();
    if (!me) {
      return '';
    }
    return `${me.name ?? ''} ${me.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
  }

  // ---------- Identidad 8879 del preparador (inline, opcional) ----------
  readonly preparerPtin = signal('');
  readonly preparerName = signal('');
  readonly preparerTitle = signal('');

  setPreparerPtin(value: string): void {
    this.preparerPtin.set(value);
    this.markDirty();
  }
  setPreparerName(value: string): void {
    this.preparerName.set(value);
    this.markDirty();
  }
  setPreparerTitle(value: string): void {
    this.preparerTitle.set(value);
    this.markDirty();
  }

  /** true si la identidad 8879 está a medias/mal (uno de PTIN/nombre sin el otro, o formato inválido). */
  readonly preparerInfoInvalid = computed(() => {
    // La identidad solo cuenta si hay una firma del preparador colocada (si no, ni se muestra ni se envía).
    if (!this.hasPlacedPreparerField()) {
      return false;
    }
    const ptin = this.preparerPtin().trim();
    const name = this.preparerName().trim();
    if (!ptin && !name) {
      return false; // ambos vacíos = ok (es opcional)
    }
    if (!ptin || !name) {
      return true; // uno sin el otro
    }
    return !/^[A-Za-z0-9]{6,20}$/.test(ptin) || name.length < 3;
  });

  /** Identidad 8879 lista para enviar, o null si no se completó (no se toca el preparador en el backend). */
  getPreparerInfo(): SetPreparerBody | null {
    // Sin firma del preparador colocada no hay a quién referenciar: no se envía identidad.
    if (!this.hasPlacedPreparerField()) {
      return null;
    }
    const ptinOrEfin = this.preparerPtin().trim();
    const displayName = this.preparerName().trim();
    if (!ptinOrEfin || !displayName) {
      return null;
    }
    return { ptinOrEfin, displayName, titleLabel: this.preparerTitle().trim() || null };
  }
  /** URL presignada de la firma del preparador, para pintarla dentro del campo (WYSIWYG). */
  readonly preparerSignatureUrl = signal<string | null>(null);

  constructor() {
    // El editor puede montarse sin que la página haya cargado las firmas todavía.
    this.store.loadSignatureProfiles();
    // Typeahead server-side del buscador de clientes del "Add signer" (mismo patrón que el picker del paso 1).
    toObservable(this.signerClientSearch)
      .pipe(
        map(term => term.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(term => {
        if (this.isAddSignerOpen()) {
          this.store.queryCustomers(term);
        }
      });
    // Autollenado REACTIVO del nombre 8879: el fill al colocar la firma es one-shot y se pierde si
    // /auth/me aún no resolvió (cold start). Se rastrean solo "hay firma colocada" y el perfil; la
    // lectura/escritura del nombre va en untracked para no re-ejecutarse con cada tecla del usuario.
    effect(() => {
      const placed = this.hasPlacedPreparerField();
      const full = this.currentUserFullName();
      if (!placed || !full) {
        return;
      }
      untracked(() => {
        if (!this.preparerName().trim()) {
          this.preparerName.set(full);
        }
      });
    });
    // Previsualización de la firma del preparador: switchMap descarta la respuesta de una firma
    // anterior si el usuario cambia de firma antes de que llegue (antes podía pintar la vieja).
    toObservable(this.previewedSignature)
      .pipe(
        map(profile => profile?.fileId ?? null),
        distinctUntilChanged(),
        switchMap(fileId => (fileId ? this.store.getDownloadUrl(fileId).pipe(catchError(() => of(null))) : of(null))),
        takeUntilDestroyed(),
      )
      .subscribe(url => this.preparerSignatureUrl.set(url));
    // Conteo hacia el panel: fuera de ngOnChanges (antes se emitía en medio del ciclo de cambios).
    effect(() => {
      const count = this.fields().length + (this.pendingSeedFields()?.length ?? 0);
      untracked(() => this.fieldCountChange.emit(count));
    });
    this.destroyRef.onDestroy(() => {
      this.renderAbort?.abort();
      this.stopDrag?.();
      this.stopPaletteDrag?.();
      if (this.ghostTimer) {
        clearTimeout(this.ghostTimer);
      }
    });
  }

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

  // ---------- Buscador de cliente registrado (combobox del modal "Add signer") ----------
  /** Término del typeahead server-side (mismo patrón que el picker del paso 1). */
  readonly signerClientSearch = signal('');
  /** Lista de resultados desplegada. */
  readonly clientListOpen = signal(false);
  /** Badge de tipo de cliente (para el template). */
  readonly typeBadge = clientTypeBadge;
  /** Estado del directorio compartido para el buscador (store es privado; se exponen wrappers). */
  readonly customersLoading = this.store.customersLoading;
  readonly customersError = this.store.customersError;

  /** Reintenta cargar el directorio de clientes tras un error. */
  retryLoadClients(): void {
    this.store.loadCustomers(true);
  }
  /** Resultados: los clientes del directorio compartido, ocultando los que ya son firmantes (por email). */
  readonly signerClientResults = computed(() => {
    const taken = new Set(this.signers().map(s => s.email.trim().toLowerCase()));
    return this.store.customers().filter(c => !taken.has(c.email.trim().toLowerCase()));
  });

  /** Elegir un cliente del buscador: autollena nombre/email/teléfono (editables) y cierra la lista. */
  pickRegisteredClient(client: WizardClient): void {
    this.draftClientId.set(client.id);
    this.draftName.set(client.displayName);
    this.draftEmail.set(client.email);
    this.draftPhone.set(client.phone ?? '');
    this.clientListOpen.set(false);
    this.signerClientSearch.set('');
  }

  /** Volver a captura manual: limpia la selección y deja escribir a mano. */
  clearRegisteredClient(): void {
    this.draftClientId.set('');
    this.clientListOpen.set(false);
    this.signerClientSearch.set('');
  }

  /** Firmante real activo (nunca el preparador): a quién van los campos que se colocan. */
  readonly activeSigner = computed(() => {
    const id = this.activeSignerId();
    return this.signers().find(s => s.id === id) ?? null;
  });
  readonly activeSignerName = computed(() => this.activeSigner()?.name ?? '—');

  /** Nº de campos colocados por firmante (badge del riel). */
  readonly fieldCountBySigner = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const field of this.fields()) {
      counts[field.signerId] = (counts[field.signerId] ?? 0) + 1;
    }
    return counts;
  });

  // ---------- estado del documento / validación ----------

  /** Hay páginas reales para colocar (render OK). */
  readonly hasRenderedPages = computed(() => this.pages().length > 0 && !this.loadError());
  /** Interacción bloqueada mientras se renderiza (carga o zoom): drag, colocar y editar. */
  readonly interactionLocked = computed(() => this.loading() || this.rerendering());
  /** Se puede colocar campos ahora mismo. */
  readonly canPlace = computed(() => this.hasRenderedPages() && !this.interactionLocked());
  /** Hay un documento elegido (espejo en signal del @Input, para los computed). */
  private readonly hasDocument = signal(false);
  /** Campos sembrados que esperan al render (mientras existan, exportar daría un set vacío). */
  private readonly pendingSeedFields = signal<EditorSeedField[] | null>(null);

  /** Firmantes con canal SMS/WhatsApp pero sin teléfono — bloquean avanzar (no se les puede entregar el OTP). */
  readonly signersMissingPhone = computed(() => this.signers().filter(s => this.signerNeedsPhone(s)));
  /** Firmantes sin campo de Firma/Iniciales (los del preparador no cuentan). */
  readonly signersMissingSignature = computed(() => signersMissingSignature(this.signers(), this.fields()));
  readonly signerFieldTotal = computed(() => signerFieldCount(this.fields()));

  /** Lista "Before you continue": todo lo que bloquea Next/Send, con su motivo. */
  readonly readinessItems = computed<ReadinessItem[]>(() =>
    buildReadinessChecklist({
      hasDocument: this.hasDocument(),
      renderFailed: !!this.loadError(),
      rendering: this.loading() || this.rerendering() || this.hasPendingSeedFieldsForActiveDocument(),
      signers: this.signers(),
      fields: this.fields(),
      signersMissingPhone: this.signersMissingPhone(),
      preparerInfoInvalid: this.preparerInfoInvalid(),
    }),
  );
  /** "Next" del paso Fields: sin pendientes y con al menos un firmante. */
  readonly canContinue = computed(() => this.readinessItems().length === 0 && this.signers().length > 0);
  /**
   * Es seguro exportar los campos (guardar borrador / snapshot): no hay render fallido ni en curso ni
   * campos sembrados sin colocar. Si no, el set exportado saldría vacío y el diff del borrador
   * borraría los campos del servidor.
   */
  readonly safeToExport = computed(
    () => !this.loadError() && !this.loading() && !this.rerendering() && !this.hasPendingSeedFieldsForActiveDocument(),
  );
  /** Motivo legible cuando no es seguro exportar (para el botón "Save as draft"). */
  readonly exportBlockedReason = computed(() => {
    if (this.loadError()) {
      return "The document couldn't be displayed. Retry before saving.";
    }
    if (!this.safeToExport()) {
      return 'Wait for the document to finish loading.';
    }
    return '';
  });

  /** Por qué no se puede colocar ahora mismo (texto bajo la paleta; '' = se puede). */
  readonly placeDisabledReason = computed(() => {
    if (this.loadError()) {
      return "Fields can't be placed until the document loads.";
    }
    if (this.loading()) {
      return 'Loading the document…';
    }
    if (this.rerendering()) {
      return 'Applying zoom…';
    }
    if (!this.hasRenderedPages()) {
      return 'Choose a document first.';
    }
    if (this.signers().length === 0) {
      return 'Add a signer first.';
    }
    return '';
  });

  /** Texto del aviso "Click on the page to place …" mientras hay un tipo armado. */
  readonly placingLabel = computed(() => {
    const kind = this.placingType();
    if (!kind) {
      return '';
    }
    if (kind === 'preparer') {
      return 'your signature';
    }
    const signer = this.signers().find(s => s.id === this.targetSignerId());
    return `a ${FIELD_TYPE_LABEL[kind]} field for ${signer?.name ?? 'the signer'}`;
  });

  /** PIN de firma escrito pero incompleto (se valida al enviar, en Review). */
  readonly signingPinInvalid = computed(() => isSigningPinInvalid(this.rules()));

  private seq = 0;
  private loadToken = 0;
  /** Tras cargar un documento, ajustar al ancho la primera vez que el área sea visible si la página no cabe. */
  private autoFitPending = false;
  private stopDrag: (() => void) | null = null;
  readonly dragging = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['seed']) {
      this.applySeed();
    }
    // También en modo sembrado: si el cliente cambió (id distinto), su firmante y sus campos pasan al nuevo.
    if (changes['client']) {
      this.syncClientSigner();
    }
    if (changes['document']) {
      this.hasDocument.set(this.document !== null);
      void this.loadDocument();
    }
  }

  ngAfterViewInit(): void {
    // El fantasma es position: fixed; si algún ancestro (wizard/drawer) tiene transform, fixed dejaría
    // de ser relativo al viewport. Se cuelga de <body> y se quita al destruir.
    const ghost = this.ghostRef?.nativeElement;
    if (ghost && typeof document !== 'undefined') {
      document.body.appendChild(ghost);
      this.destroyRef.onDestroy(() => ghost.remove());
    }
    const surface = this.surfaceRef?.nativeElement;
    if (!surface || typeof ResizeObserver === 'undefined') {
      return;
    }
    // El editor se monta oculto (paso 2): su ancho real se conoce al mostrarse el paso 3.
    const observer = new ResizeObserver(() => this.maybeAutoFit());
    observer.observe(surface);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /** "Fit width" automático una sola vez por documento, si la página es más ancha que el área visible. */
  private maybeAutoFit(): void {
    const surface = this.surfaceRef?.nativeElement;
    const first = this.pages()[0];
    if (!this.autoFitPending || !surface || surface.clientWidth === 0 || !first || this.interactionLocked()) {
      return;
    }
    this.autoFitPending = false;
    if (first.width > surface.clientWidth - 32) {
      this.fitWidth();
    }
  }

  /** Rehidrata firmantes y reglas al instante; los campos esperan al render (ver loadDocument). */
  private applySeed(): void {
    const seed = this.seed;
    if (!seed) {
      return;
    }
    this.signers.set(seed.signers);
    this.rules.set(seed.rules);
    this.activeSignerId.set(seed.signers.find(s => s.id !== PREPARER_PARTY_ID)?.id ?? null);
    this.pendingSeedFields.set(seed.fields);
    // Los ids restaurados ya traen sufijo (signer-N/field-N/prep-N): la secuencia sigue por encima.
    this.seq = Math.max(this.seq, nextSeqAfter([...seed.signers.map(s => s.id), ...seed.fields.map(f => f.localId)]));
    this.seededPreparerFileId.set(seed.preparerSignatureFileId ?? null);
    // Identidad 8879 sembrada (recuperación local); el detalle del backend no la devuelve.
    this.preparerPtin.set(seed.preparerInfo?.ptinOrEfin ?? '');
    this.preparerName.set(seed.preparerInfo?.displayName ?? '');
    this.preparerTitle.set(seed.preparerInfo?.titleLabel ?? '');
    this.dirty.set(false);
  }

  /** Coloca los campos sembrados una vez conocidas las dimensiones px de cada página. */
  private applyPendingSeedFields(): void {
    const pending = this.pendingSeedFields();
    const activeDocumentId = this.document?.id;
    if (!pending || !activeDocumentId) {
      return;
    }
    const placed: PlacedField[] = [];
    const remaining: EditorSeedField[] = [];
    for (const field of pending) {
      if (field.documentLocalId !== activeDocumentId) {
        remaining.push(field);
        continue;
      }
      const page = this.pages().find(p => p.page === field.page);
      if (!page) {
        remaining.push(field);
        continue;
      }
      placed.push({
        id: field.localId,
        documentLocalId: field.documentLocalId,
        type: field.type,
        page: field.page,
        ...denormalizeFieldRect({ x: field.nx, y: field.ny, width: field.nw, height: field.nh }, page),
        signerId: field.signerLocalId,
        label: field.label,
      });
    }
    this.pendingSeedFields.set(remaining.length > 0 ? remaining : null);
    this.fields.update(existing => [...existing.filter(field => field.documentLocalId !== activeDocumentId), ...placed]);
  }

  private hasPendingSeedFieldsForActiveDocument(): boolean {
    const activeDocumentId = this.document?.id;
    return !!activeDocumentId && !!this.pendingSeedFields()?.some(field => field.documentLocalId === activeDocumentId);
  }

  private markDirty(): void {
    this.dirty.set(true);
    // F2.5: notifica al panel para que arme el UpsertDraftBody y dispare el autosave debounced.
    this.editorStateChanged.emit();
  }

  private nextId(prefix: 'signer' | 'field' | 'prep'): string {
    return `${prefix}-${this.seq++}`;
  }

  // ---------- firmantes ----------

  isClientSigner(signer: EditorSigner): boolean {
    return signer.id.startsWith('client:');
  }

  setActiveSigner(id: string): void {
    if (id === PREPARER_PARTY_ID) {
      return; // el preparador no es un firmante: nunca es el destino de "Add field"
    }
    this.activeSignerId.set(id);
  }

  /** Desde la lista "Before you continue": activa el firmante y abre donde se ve (riel o panel angosto). */
  focusSigner(id: string, editPhone = false): void {
    this.setActiveSigner(id);
    this.railCollapsed.set(false);
    this.selectedFieldId.set(null);
    if (editPhone) {
      this.editingPhoneFor.set(id);
    }
    if (this.isNarrow()) {
      this.narrowPanel.set('signers');
    }
  }

  /** Canal por defecto para un firmante nuevo = el default de la request (Review). */
  private defaultSignerChannel(): VerificationChannel {
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
    this.signerClientSearch.set('');
    this.clientListOpen.set(true);
    this.narrowPanel.set(null);
    // Refresca el lote de navegación del directorio compartido para el buscador.
    this.store.queryCustomers('');
    this.isAddSignerOpen.set(true);
  }

  closeAddSigner(): void {
    this.isAddSignerOpen.set(false);
    this.clientListOpen.set(false);
    // Restaura el lote completo del directorio compartido (el buscador lo dejó reducido a la última búsqueda).
    this.store.queryCustomers('');
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
    const id = this.nextId('signer');
    this.signers.update(list => {
      const color = SIGNER_PALETTE[list.length % SIGNER_PALETTE.length].bg;
      return [
        ...list,
        { id, name, email, color, channel: this.draftChannel(), phone, language: this.draftLanguage() },
      ];
    });
    this.activeSignerId.set(id);
    this.markDirty();
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
    this.markDirty();
  }

  /** Alternativa accesible/táctil al arrastre: subir/bajar un firmante en el orden. */
  moveSigner(id: string, delta: -1 | 1): void {
    const list = this.signers();
    const from = list.findIndex(s => s.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) {
      return;
    }
    const next = [...list];
    moveItemInArray(next, from, to);
    this.signers.set(next);
    this.markDirty();
  }

  // ---------- reglas (se editan en Review; aquí solo viven) ----------

  /** Canales de ENTREGA reales (por firmante). 'app' no entrega a firmantes externos, se excluye. */
  readonly deliveryChannels: VerificationChannel[] = ['email', 'sms', 'whatsapp', 'none'];

  /** Canales a ofrecer para un firmante: los de entrega + el suyo si vino sembrado con otro (p. ej. 'app'). */
  channelOptionsFor(signer: EditorSigner): VerificationChannel[] {
    return this.deliveryChannels.includes(signer.channel)
      ? this.deliveryChannels
      : [...this.deliveryChannels, signer.channel];
  }

  /** Fija el canal de UN firmante (incluido el cliente). Es lo que decide su invitación + OTP. */
  setSignerChannel(signerId: string, channel: VerificationChannel): void {
    this.signers.update(list => list.map(s => (s.id === signerId ? { ...s, channel } : s)));
    if (channelRequiresPhone(channel) && !this.signers().find(s => s.id === signerId)?.phone.trim()) {
      this.editingPhoneFor.set(signerId);
    }
    this.markDirty();
  }

  /** Edita el teléfono de UN firmante (necesario para SMS/WhatsApp). */
  setSignerPhone(signerId: string, phone: string): void {
    this.signers.update(list => list.map(s => (s.id === signerId ? { ...s, phone } : s)));
    this.markDirty();
  }

  /** true si el canal del firmante exige teléfono (SMS/WhatsApp) y no lo tiene: hay que pedirlo. */
  signerNeedsPhone(signer: EditorSigner): boolean {
    return channelRequiresPhone(signer.channel) && signer.phone.trim().length === 0;
  }

  /** La fila muestra el input de teléfono si falta o si se pidió editarlo desde el menú. */
  showPhoneInput(signer: EditorSigner): boolean {
    return this.signerNeedsPhone(signer) || this.editingPhoneFor() === signer.id;
  }

  getRules(): RequestRules {
    return this.rules();
  }

  /** Pliega/despliega la columna derecha (xl) y recuerda la preferencia. */
  setInspectorCollapsed(collapsed: boolean): void {
    this.inspectorCollapsed.set(collapsed);
    writePanelCollapsed(PDF_EDITOR_INSPECTOR_COLLAPSED_KEY, collapsed);
  }

  /** Lo usa el paso Review: reemplaza las reglas (las transformaciones viven en request-rules.util). */
  setRules(rules: RequestRules): void {
    this.rules.set(rules);
    this.markDirty();
  }

  /** Toggle Sequential/Any order dentro del editor (antes vivía solo en Review). */
  setSigningOrder(sequential: boolean): void {
    this.rules.update(r => withSequential(r, sequential));
    this.markDirty();
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
    if (this.selectedField() === null) {
      this.selectedFieldId.set(null);
    }
    this.markDirty();
  }

  /**
   * Firmante cliente = `client:<id>`. Si el cliente cambia, se reemplaza EN SU SITIO (conserva color
   * y posición en el orden) y sus campos pasan al nuevo con ids nuevos — antes quedaban huérfanos y
   * el envío los descartaba en silencio. Mismo id = nada que hacer (respeta canal/teléfono sembrados).
   */
  private syncClientSigner(): void {
    const client = this.client;
    const list = this.signers();
    const current = list.find(s => this.isClientSigner(s)) ?? null;
    if (!client) {
      if (current) {
        this.signers.set(list.filter(s => s !== current));
        this.fields.update(fields => fields.filter(f => f.signerId !== current.id));
      }
      return;
    }
    const nextId = `client:${client.id}`;
    if (current?.id === nextId) {
      return;
    }
    const clientSigner: EditorSigner = {
      id: nextId,
      name: client.displayName,
      email: client.email,
      color: current?.color ?? SIGNER_PALETTE[0].bg,
      channel: this.defaultSignerChannel(),
      phone: client.phone ?? '',
      language: 'En',
    };
    if (current) {
      this.signers.set(list.map(s => (s === current ? clientSigner : s)));
      this.fields.update(fields => reassignSignerFields(fields, current.id, nextId, () => this.nextId('field')));
      if (this.activeSignerId() === current.id) {
        this.activeSignerId.set(nextId);
      }
      this.markDirty();
    } else {
      this.signers.set([clientSigner, ...list]);
    }
    if (!this.activeSignerId() || !this.signers().some(s => s.id === this.activeSignerId())) {
      this.activeSignerId.set(this.signers()[0]?.id ?? null);
    }
  }

  // ---------- campos ----------

  fieldsForPage(page: number): PlacedField[] {
    const activeDocumentId = this.document?.id;
    return this.fields().filter(f => f.documentLocalId === activeDocumentId && f.page === page);
  }

  /** Icono/círculo pastel del tipo de documento (toolbar). */
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

  /** Firmante real destino de un campo nuevo: el activo, o el primero si el activo no es válido. */
  private targetSignerId(): string | null {
    const active = this.activeSignerId();
    if (active && active !== PREPARER_PARTY_ID && this.signers().some(s => s.id === active)) {
      return active;
    }
    return this.signers()[0]?.id ?? null;
  }

  private pageBox(page: number): RenderedPage | undefined {
    return this.pages().find(p => p.page === page);
  }

  /** Arma "clic en la página" para un tipo (volver a pulsar el mismo lo desarma). */
  armPlacement(kind: PlacingKind): void {
    if (!this.canPlace()) {
      return;
    }
    if (kind === 'preparer' && !this.hasPreparerSignature()) {
      return;
    }
    this.placingType.update(current => (current === kind ? null : kind));
    this.selectedFieldId.set(null);
    // En pantallas angostas se cierra el panel para dejar ver la página.
    this.narrowPanel.set(null);
  }

  cancelPlacement(): void {
    this.placingType.set(null);
  }

  /** Botón de la paleta (sin clic en la página): coloca el campo armado en la página visible. */
  placeOnCurrentPage(): void {
    const kind = this.placingType();
    if (!kind) {
      return;
    }
    const page = this.pageBox(this.currentPage()) ?? this.pages()[0];
    if (!page) {
      return;
    }
    this.placeAt(kind, page.page, null);
  }

  /** Clic/toque en la página con un tipo armado: centra el campo en el punto. */
  onPagePointerDown(event: PointerEvent, page: RenderedPage): void {
    const kind = this.placingType();
    if (!kind) {
      // Clic en zona vacía: deselecciona.
      this.selectedFieldId.set(null);
      return;
    }
    if (!this.canPlace()) {
      return;
    }
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.placeAt(kind, page.page, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  private placeAt(kind: PlacingKind, pageNumber: number, point: { x: number; y: number } | null): void {
    const page = this.pageBox(pageNumber);
    if (!page || !this.canPlace()) {
      return;
    }
    const type: FieldType = kind === 'preparer' ? 'signature' : kind;
    const size = scaleSize(DEFAULT_SIZE[type], this.zoom());
    const count = this.fields().length;
    let signerId: string;
    let id: string;
    if (kind === 'preparer') {
      if (!this.hasPreparerSignature()) {
        return;
      }
      signerId = PREPARER_PARTY_ID;
      id = this.nextId('prep');
    } else {
      const target = this.targetSignerId();
      if (!target) {
        return;
      }
      signerId = target;
      id = this.nextId('field');
      // Reencauza el activo a un firmante real para la etiqueta "Fields for" y los siguientes campos.
      this.activeSignerId.set(target);
    }
    const x = point ? point.x - size.w / 2 : (page.width - size.w) / 2;
    const y = point ? point.y - size.h / 2 : 120 * this.zoom() + (count % 6) * 16;
    const documentLocalId = this.document?.id;
    if (!documentLocalId) {
      return;
    }
    const field = clampToPage<PlacedField>({ id, documentLocalId, type, page: page.page, x, y, width: size.w, height: size.h, signerId }, page);
    this.fields.update(list => [...list, field]);
    this.placingType.set(null);
    this.selectedFieldId.set(field.id);
    if (kind === 'preparer') {
      this.autofillPreparerName();
    }
    this.liveMessage.set(`${kind === 'preparer' ? 'Your signature' : FIELD_TYPE_LABEL[type] + ' field'} placed on page ${page.page}`);
    this.markDirty();
  }

  // ---------- arrastrar desde la paleta (mantener pulsado y soltar sobre la página) ----------

  /** Fantasma visible (null = no hay arrastre desde la paleta). */
  readonly paletteGhost = signal<PaletteGhost | null>(null);
  /** Contorno de dónde caerá el campo (solo sobre una página). */
  readonly dropPreview = signal<DropPreview | null>(null);
  /** Táctil: botón que se está manteniendo pulsado (animación de "carga" antes de levantar). */
  readonly paletteArming = signal<PlacingKind | null>(null);
  /** Mensaje para lectores de pantalla (aria-live) al colocar un campo. */
  readonly liveMessage = signal('');
  /** La hoja inferior (móvil) se minimiza mientras se arrastra para que se vea la página. */
  readonly sheetMinimized = computed(() => this.paletteGhost() !== null);
  private stopPaletteDrag: (() => void) | null = null;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rect del botón de origen (la cancelación anima la vuelta hasta él). */
  private paletteOrigin: { left: number; top: number; width: number; height: number } | null = null;

  /** ¿Se puede arrastrar este tipo ahora? Mismas reglas que el botón (deshabilitado = sin arrastre). */
  private canDragKind(kind: PlacingKind): boolean {
    if (!this.canPlace()) {
      return false;
    }
    return kind === 'preparer' ? this.hasPreparerSignature() : this.signers().length > 0 && this.targetSignerId() !== null;
  }

  /** pointerdown en un botón de la paleta: el clic sigue igual; mover (ratón) o mantener (táctil) arrastra. */
  onPalettePointerDown(event: PointerEvent, kind: PlacingKind): void {
    if (event.button > 0 || !this.canDragKind(kind) || this.paletteGhost()?.phase === 'drag') {
      return;
    }
    this.stopPaletteDrag?.();
    const button = event.currentTarget as HTMLElement | null;
    const rect = button?.getBoundingClientRect();
    this.paletteOrigin = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    this.stopPaletteDrag = startPaletteDrag(event, {
      getScrollContainer: () => this.surfaceRef?.nativeElement ?? null,
      onArming: armed => this.paletteArming.set(armed ? kind : null),
      onStart: point => this.beginPaletteDrag(kind, point),
      onFrame: point => this.onPaletteFrame(point),
      onDrop: point => this.dropFromPalette(point),
      onCancel: () => this.cancelPaletteDrag(),
    });
  }

  private beginPaletteDrag(kind: PlacingKind, point: { clientX: number; clientY: number }): void {
    if (!this.canDragKind(kind)) {
      this.stopPaletteDrag?.();
      return;
    }
    if (this.ghostTimer) {
      clearTimeout(this.ghostTimer);
      this.ghostTimer = null;
    }
    const type: FieldType = kind === 'preparer' ? 'signature' : kind;
    const size = scaleSize(DEFAULT_SIZE[type], this.zoom());
    // El arrastre sustituye al modo "clic para colocar" y a la selección.
    this.placingType.set(null);
    this.selectedFieldId.set(null);
    this.floatingChecklistOpen.set(false);
    const ghost = this.ghostRef?.nativeElement;
    resetGhost(ghost);
    setGhostPosition(ghost, point.clientX - size.w / 2, point.clientY - size.h / 2);
    const signerId = kind === 'preparer' ? PREPARER_PARTY_ID : (this.targetSignerId() ?? '');
    this.paletteGhost.set({ kind, type, signerId, width: size.w, height: size.h, overPage: false, phase: 'drag' });
  }

  private onPaletteFrame(point: { clientX: number; clientY: number }): void {
    const ghost = this.paletteGhost();
    if (!ghost || ghost.phase !== 'drag') {
      return;
    }
    setGhostPosition(this.ghostRef?.nativeElement, point.clientX - ghost.width / 2, point.clientY - ghost.height / 2);
    const hit = hitTestPages(point, measurePages(this.surfaceRef?.nativeElement));
    const page = hit ? this.pageBox(hit.page) : undefined;
    const next = hit && page ? { page: hit.page, ...dropRectOnPage(hit, { w: ghost.width, h: ghost.height }, page) } : null;
    const prev = this.dropPreview();
    // Solo se tocan los signals si algo cambió (con el puntero quieto no hay detección de cambios).
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
    const pageRects = measurePages(this.surfaceRef?.nativeElement);
    const hit = hitTestPages(point, pageRects);
    if (!hit || !this.canDragKind(ghost.kind)) {
      this.cancelPaletteDrag();
      return;
    }
    // Misma ruta que "clic en la página": mismo modelo, normalización, firmante y validación.
    this.placeAt(ghost.kind, hit.page, { x: hit.x, y: hit.y });
    this.narrowPanel.set(null);
    const field = this.selectedField();
    const pageRect = pageRects.find(r => r.page === hit.page);
    if (!field || !pageRect || prefersReducedMotion()) {
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

  /** Escape, pointercancel o soltar fuera de una página: vuelve a la paleta sin crear nada. */
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

  /** API previa (botones): coloca un campo del tipo en la página visible para el firmante activo. */
  addField(type: FieldType): void {
    const page = this.pageBox(this.currentPage()) ?? this.pages()[0];
    if (page) {
      this.placeAt(type, page.page, null);
    }
  }

  /** Coloca un campo de firma del PREPARADOR (parte sintética, no un firmante). Requiere firma default. */
  addPreparerField(): void {
    const page = this.pageBox(this.currentPage()) ?? this.pages()[0];
    if (page) {
      this.placeAt('preparer', page.page, null);
    }
  }

  /** Autollena el nombre 8879 con el del usuario (perfil), editable, solo si está vacío. */
  private autofillPreparerName(): void {
    if (!this.preparerName().trim()) {
      const name = this.currentUserFullName();
      if (name) {
        this.preparerName.set(name);
      }
    }
  }

  /** Tipado del contexto de las ng-template del inspector (let-f llega como any). */
  asField(field: unknown): PlacedField {
    return field as PlacedField;
  }

  isPreparerField(field: PlacedField): boolean {
    return field.signerId === PREPARER_PARTY_ID;
  }

  /**
   * F6 — Tamaño de letra que estampará el sellador para el campo seleccionado, en pt del PDF.
   *
   * **Debe ser `computed`, NO método**: llamarlo como método (`fontBadgeFor(f)`) desde el template
   * devuelve un objeto `{pt, mayShrink}` nuevo en cada ciclo → Angular lo ve como "cambió", vuelve
   * a correr change detection, y entra en loop infinito (NG0103). El `computed` memoiza por
   * referencia mientras sus inputs (selectedField + pages) no cambien.
   *
   * Las dimensiones del field están en PX de pantalla a la escala del render; las fórmulas del
   * sealing engine son en PT del PDF. Dividir por `page.scale` convierte. Sin esto el número se
   * clava en el máximo porque px ≈ 1.33× pt y la fórmula satura.
   */
  readonly selectedFieldFontBadge = computed<StampFontSizeResult | null>(() => {
    const field = this.selectedField();
    if (!field || this.isPreparerField(field)) return null;
    const page = this.pageBox(field.page);
    if (!page || page.scale <= 0) return null;
    return stampFontSizeForBox(field.type, field.height / page.scale, field.width / page.scale);
  });

  removeField(id: string): void {
    if (this.interactionLocked()) {
      return;
    }
    this.fields.update(list => list.filter(f => f.id !== id));
    if (this.selectedFieldId() === id) {
      this.selectedFieldId.set(null);
    }
    this.markDirty();
  }

  /** Fija la etiqueta/instrucción de un campo de texto (P4); la ve el firmante como placeholder. */
  setFieldLabel(id: string, label: string): void {
    this.fields.update(list => list.map(f => (f.id === id ? { ...f, label } : f)));
    this.markDirty();
  }

  selectField(id: string): void {
    if (this.placingType()) {
      return;
    }
    this.selectedFieldId.set(id);
    const field = this.fields().find(f => f.id === id);
    if (field && !this.isPreparerField(field)) {
      this.activeSignerId.set(field.signerId);
    }
  }

  clearSelection(): void {
    this.selectedFieldId.set(null);
  }

  /** Inspector: pasa el campo a otro firmante (id nuevo, ver reassignSignerFields). */
  reassignField(id: string, signerId: string): void {
    const field = this.fields().find(f => f.id === id);
    if (!field || this.isPreparerField(field) || field.signerId === signerId || this.interactionLocked()) {
      return;
    }
    const newId = this.nextId('field');
    this.fields.update(list => list.map(f => (f.id === id ? { ...f, id: newId, signerId } : f)));
    this.selectedFieldId.set(newId);
    this.activeSignerId.set(signerId);
    this.markDirty();
  }

  /** Duplica el campo en la misma página (desplazado). */
  duplicateField(id: string): void {
    const field = this.fields().find(f => f.id === id);
    const page = field ? this.pageBox(field.page) : undefined;
    if (!field || !page || this.interactionLocked()) {
      return;
    }
    const copy = duplicateFieldRect(field, page, this.nextId(this.isPreparerField(field) ? 'prep' : 'field'));
    this.fields.update(list => [...list, copy]);
    this.selectedFieldId.set(copy.id);
    this.markDirty();
  }

  /** Copia el campo a todas las demás páginas (campos normales, misma posición relativa). */
  duplicateFieldToAllPages(id: string): void {
    const field = this.fields().find(f => f.id === id);
    if (!field || this.interactionLocked() || this.pages().length < 2) {
      return;
    }
    const prefix = this.isPreparerField(field) ? 'prep' : 'field';
    const copies = copyFieldToAllPages(field, this.pages(), () => this.nextId(prefix));
    this.fields.update(list => [...list, ...copies]);
    this.markDirty();
  }

  /** Teclado sobre un campo enfocado: Supr/Backspace, flechas (Shift = 10px), Ctrl/Cmd+D, Esc. */
  onFieldKeydown(event: KeyboardEvent, field: PlacedField): void {
    if (this.interactionLocked()) {
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const page = this.pageBox(field.page);
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.removeField(field.id);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.clearSelection();
        (event.target as HTMLElement | null)?.blur?.();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!page) {
          return;
        }
        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        this.fields.update(list => list.map(f => (f.id === field.id ? nudgeField(f, dx, dy, page) : f)));
        this.markDirty();
        return;
      }
      default:
        if ((event.key === 'd' || event.key === 'D') && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          this.duplicateField(field.id);
        }
    }
  }

  borderClass(signerId: string): string {
    return this.paletteFor(signerId).border;
  }

  textClass(signerId: string): string {
    return this.paletteFor(signerId).text;
  }

  signerNameOf(signerId: string): string {
    return this.signers().find(s => s.id === signerId)?.name ?? '—';
  }

  private paletteFor(signerId: string): (typeof SIGNER_PALETTE)[number] {
    const list = this.signers();
    const index = list.findIndex(s => s.id === signerId);
    const color = list[index]?.color;
    // Firmantes sembrados traen color de AVATAR_PALETTE: se cae a la posición para que cada uno tenga el suyo.
    return (
      SIGNER_PALETTE.find(p => p.bg === color) ??
      (index >= 0 ? SIGNER_PALETTE[index % SIGNER_PALETTE.length] : SIGNER_PALETTE[SIGNER_PALETTE.length - 1])
    );
  }

  // ---------- drag & resize ----------

  startMove(event: PointerEvent, field: PlacedField): void {
    if (this.placingType()) {
      return; // con un tipo armado, el clic va a la página (colocar), no a mover
    }
    event.stopPropagation();
    this.selectField(field.id);
    const overlay = event.currentTarget as HTMLElement;
    // preventDefault en pointerdown evita el foco nativo: se enfoca a mano para que funcionen los atajos.
    overlay.focus?.({ preventScroll: true });
    if (this.interactionLocked() || event.button > 0) {
      return;
    }
    event.preventDefault();
    const pageEl = overlay.closest('[data-page]') as HTMLElement | null;
    const page = this.pageBox(field.page);
    if (!pageEl || !page) {
      return;
    }
    const rect = pageEl.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - field.x;
    const offsetY = event.clientY - rect.top - field.y;
    this.beginDrag(event, pageEl, ({ x, y }) => {
      this.fields.update(list =>
        list.map(f =>
          f.id === field.id
            ? { ...f, x: clamp(x - offsetX, 0, page.width - f.width), y: clamp(y - offsetY, 0, page.height - f.height) }
            : f,
        ),
      );
    });
  }

  startResize(event: PointerEvent, field: PlacedField): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.interactionLocked()) {
      return;
    }
    this.selectField(field.id);
    const pageEl = (event.currentTarget as HTMLElement).closest('[data-page]') as HTMLElement | null;
    const page = this.pageBox(field.page);
    if (!pageEl || !page) {
      return;
    }
    const min = scaleSize(MIN_SIZE_BY_TYPE[field.type], this.zoom());
    const startW = field.width;
    const startH = field.height;
    this.beginDrag(event, pageEl, ({ dx, dy }) => {
      const width = clamp(startW + dx, Math.min(min.w, page.width - field.x), page.width - field.x);
      const height = clamp(startH + dy, Math.min(min.h, page.height - field.y), page.height - field.y);
      this.fields.update(list => list.map(f => (f.id === field.id ? { ...f, width, height } : f)));
    });
  }

  private beginDrag(
    event: PointerEvent,
    pageEl: HTMLElement,
    onMove: (p: { x: number; y: number; dx: number; dy: number }) => void,
  ): void {
    this.stopDrag?.();
    this.dragging.set(true);
    let moved = false;
    this.stopDrag = startPointerDrag(event, {
      getPageRect: () => pageEl.getBoundingClientRect(),
      onMove: point => {
        moved = true;
        onMove(point);
      },
      onEnd: () => {
        this.stopDrag = null;
        this.dragging.set(false);
        if (moved) {
          this.markDirty();
        }
      },
    });
  }

  private cancelDrag(): void {
    this.stopDrag?.();
    this.stopDrag = null;
    // Un re-render (zoom/documento) también corta el arrastre desde la paleta.
    this.stopPaletteDrag?.();
    this.stopPaletteDrag = null;
  }

  // ---------- teclado global / escape ----------

  /**
   * Escape a nivel del wizard: si el editor tiene algo "abierto" (menú, panel angosto, colocación
   * armada o un campo seleccionado) lo cierra y devuelve true para que el panel NO cierre el wizard.
   */
  handleEscape(): boolean {
    if (this.isAddSignerOpen()) {
      return true;
    }
    if (this.openMenus > 0) {
      return true; // el propio app-dropdown-menu se cierra con su Escape
    }
    if (this.narrowPanel()) {
      this.narrowPanel.set(null);
      return true;
    }
    if (this.floatingChecklistOpen()) {
      this.floatingChecklistOpen.set(false);
      return true;
    }
    if (this.placingType()) {
      this.placingType.set(null);
      return true;
    }
    if (this.selectedFieldId()) {
      this.selectedFieldId.set(null);
      return true;
    }
    if (this.editingPhoneFor()) {
      this.editingPhoneFor.set(null);
      return true;
    }
    return false;
  }

  onMenuOpenChange(open: boolean): void {
    this.openMenus = Math.max(0, this.openMenus + (open ? 1 : -1));
  }

  /** "Fix" de la lista: abre el bloque del preparador (riel o panel "Fields" en pantallas angostas). */
  openPreparerDetails(): void {
    this.preparerOpen.set(true);
    this.railCollapsed.set(false);
    this.selectedFieldId.set(null);
    if (this.isNarrow()) {
      this.narrowPanel.set('fields');
    }
  }

  toggleNarrowPanel(panel: NarrowPanel): void {
    this.narrowPanel.update(current => (current === panel ? null : panel));
  }

  closeNarrowPanel(): void {
    this.narrowPanel.set(null);
  }

  private isNarrow(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < FIT_WIDTH_BELOW_PX;
  }

  // ---------- API pública para el wizard ----------

  getFields(): PlacedField[] {
    const pending = (this.pendingSeedFields() ?? []).map(field => ({
      id: field.localId,
      documentLocalId: field.documentLocalId,
      type: field.type,
      page: field.page,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      signerId: field.signerLocalId,
      label: field.label,
    }));
    return [...this.fields(), ...pending];
  }

  removeDocumentFields(documentLocalId: string): void {
    this.fields.update(fields => fields.filter(field => field.documentLocalId !== documentLocalId));
    const pending = this.pendingSeedFields()?.filter(field => field.documentLocalId !== documentLocalId) ?? [];
    this.pendingSeedFields.set(pending.length > 0 ? pending : null);
    this.pageMetricsByDocument.delete(documentLocalId);
    this.markDirty();
  }

  getSigners(): EditorSigner[] {
    return this.signers();
  }

  /**
   * Campos en coordenadas normalizadas [0..1] (origen arriba-izquierda), la
   * convención que exige FieldPosition en el backend. Se divide por el tamaño en
   * px de la página renderizada actual, así el resultado es independiente del zoom.
   */
  buildNormalizedFields(): NormalizedPlacedField[] {
    const out: NormalizedPlacedField[] = [];
    for (const field of this.fields()) {
      if (this.isPreparerField(field)) {
        continue; // los del preparador se exportan aparte (buildPreparerFields)
      }
      const pages =
        field.documentLocalId === this.document?.id
          ? this.pages()
          : this.pageMetricsByDocument.get(field.documentLocalId) ?? [];
      const rect = normalizeFieldRect(field, pages.find(p => p.page === field.page));
      if (!rect) {
        continue;
      }
      out.push({
        localId: field.id,
        documentLocalId: field.documentLocalId,
        signerLocalId: field.signerId,
        type: field.type,
        page: field.page,
        ...rect,
        label: field.type === 'text' ? field.label?.trim() || undefined : undefined,
      });
    }
    for (const field of this.pendingSeedFields() ?? []) {
      if (field.signerLocalId === PREPARER_PARTY_ID) {
        continue;
      }
      out.push({
        localId: field.localId,
        documentLocalId: field.documentLocalId,
        signerLocalId: field.signerLocalId,
        type: field.type,
        page: field.page,
        x: field.nx,
        y: field.ny,
        width: field.nw,
        height: field.nh,
        label: field.label,
      });
    }
    return out;
  }

  /** Campos del PREPARADOR en coordenadas normalizadas [0..1] (mismo cálculo, filtrando por parte). */
  buildPreparerFields(): NormalizedPlacedField[] {
    const out: NormalizedPlacedField[] = [];
    for (const field of this.fields()) {
      if (!this.isPreparerField(field)) {
        continue;
      }
      const pages =
        field.documentLocalId === this.document?.id
          ? this.pages()
          : this.pageMetricsByDocument.get(field.documentLocalId) ?? [];
      const rect = normalizeFieldRect(field, pages.find(p => p.page === field.page));
      if (!rect) {
        continue;
      }
      out.push({ localId: field.id, documentLocalId: field.documentLocalId, signerLocalId: PREPARER_PARTY_ID, type: field.type, page: field.page, ...rect });
    }
    for (const field of this.pendingSeedFields() ?? []) {
      if (field.signerLocalId !== PREPARER_PARTY_ID) {
        continue;
      }
      out.push({
        localId: field.localId,
        documentLocalId: field.documentLocalId,
        signerLocalId: PREPARER_PARTY_ID,
        type: field.type,
        page: field.page,
        x: field.nx,
        y: field.ny,
        width: field.nw,
        height: field.nh,
        label: field.label,
      });
    }
    return out;
  }

  /** FileId de la firma reutilizable que se estampará (la previsualizada); null si no hay ninguna. */
  getPreparerSignatureFileId(): string | null {
    return this.previewedSignature()?.fileId ?? null;
  }

  // ---------- render ----------

  /** Actualiza "Page X / N" según el scroll del área del documento. */
  onSurfaceScroll(): void {
    const surface = this.surfaceRef?.nativeElement;
    if (!surface) {
      return;
    }
    const top = surface.getBoundingClientRect().top + surface.clientHeight / 3;
    let visible = 1;
    for (const el of Array.from(surface.querySelectorAll<HTMLElement>('[data-page]'))) {
      if (el.getBoundingClientRect().top <= top) {
        visible = Number(el.dataset['page']) || visible;
      }
    }
    if (visible !== this.currentPage()) {
      this.currentPage.set(visible);
    }
  }

  goToPage(value: number | string): void {
    const total = this.pages().length;
    const page = clamp(Math.round(Number(value)) || 1, 1, Math.max(1, total));
    this.currentPage.set(page);
    const surface = this.surfaceRef?.nativeElement;
    const el = surface?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (surface && el) {
      surface.scrollTop = el.offsetTop - 16;
    }
  }

  // ---------- zoom ----------

  zoomIn(): void {
    const base = this.pendingZoom() ?? this.zoom();
    void this.applyZoom(Math.min(ZOOM_MAX, Math.round((base + ZOOM_STEP) * 100) / 100));
  }

  zoomOut(): void {
    const base = this.pendingZoom() ?? this.zoom();
    void this.applyZoom(Math.max(ZOOM_MIN, Math.round((base - ZOOM_STEP) * 100) / 100));
  }

  /** Ajusta el zoom para que la página ocupe el ancho disponible del área del documento. */
  fitWidth(): void {
    const first = this.pages()[0];
    if (!first) {
      return;
    }
    const pointsWidth = first.width / first.scale;
    void this.applyZoom(this.fitZoomFor(pointsWidth));
  }

  private availableWidth(): number {
    const surface = this.surfaceRef?.nativeElement;
    const width = surface?.clientWidth ?? 0;
    // Oculto (paso 2) mide 0: se estima con la ventana menos márgenes.
    return width > 0 ? width - 32 : Math.max(240, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 64);
  }

  private fitZoomFor(pointsWidth: number): number {
    const zoom = this.availableWidth() / (pointsWidth * BASE_SCALE);
    return clamp(Math.floor(zoom * 100) / 100, ZOOM_MIN, ZOOM_MAX);
  }

  /**
   * Re-render por zoom. Los campos y el zoom aplicado NO cambian hasta que el render termina
   * bien; si falla, se queda el zoom anterior y se avisa. Mientras dura, el drag y la edición
   * están bloqueados (interactionLocked) y un zoom nuevo cancela el render anterior.
   */
  private async applyZoom(next: number): Promise<void> {
    if (!this.hasRenderedPages() || this.loading()) {
      return;
    }
    if (next === (this.pendingZoom() ?? this.zoom())) {
      return;
    }
    this.cancelDrag();
    this.renderAbort?.abort();
    const abort = new AbortController();
    this.renderAbort = abort;
    const token = ++this.loadToken;
    this.pendingZoom.set(next);
    this.zoomError.set('');
    try {
      const scale = BASE_SCALE * next;
      const pages = this.docBytes
        ? // pdf.js transfiere el buffer al worker: se pasa una copia para conservar el cache.
          await renderPdfPages({ data: this.docBytes.slice() }, scale, { signal: abort.signal })
        : blankPages(Math.max(1, this.pages().length), scale);
      if (token !== this.loadToken) {
        return;
      }
      const previousPages = this.pages();
      this.fields.update(list => rescaleFieldsBetweenPages(list, previousPages, pages));
      this.pages.set(pages);
      this.lastRenderedPages = pages;
      this.zoom.set(next);
    } catch (err) {
      if (token !== this.loadToken || isPdfRenderAborted(err)) {
        return;
      }
      console.error('[signature] zoom re-render failed', err);
      this.zoomError.set("We couldn't change the zoom. Try again.");
    } finally {
      if (token === this.loadToken) {
        this.pendingZoom.set(null);
        this.renderAbort = null;
      }
    }
  }

  // ---------- carga del documento ----------

  retryLoad(): void {
    void this.loadDocument();
  }

  private async loadDocument(): Promise<void> {
    const token = ++this.loadToken;
    const nextDocumentId = this.document?.id ?? null;
    const previousDocumentId = this.loadedDocumentId;
    if (previousDocumentId && this.lastRenderedPages.length > 0) {
      this.pageMetricsByDocument.set(previousDocumentId, this.lastRenderedPages);
    }
    this.renderAbort?.abort();
    const abort = new AbortController();
    this.renderAbort = abort;
    this.cancelDrag();
    this.pendingZoom.set(null);
    this.zoomError.set('');
    this.notice.set('');
    this.selectedFieldId.set(null);
    this.placingType.set(null);

    // Conservar campos solo si el panel lo confirmó, hay campos y no estamos sembrando un borrador.
    const isSwitchingDocuments =
      previousDocumentId !== null && nextDocumentId !== null && previousDocumentId !== nextDocumentId;
    const keep =
      (isSwitchingDocuments || this.keepFieldsOnDocumentChange) &&
      this.fields().length > 0 &&
      !this.hasPendingSeedFieldsForActiveDocument();
    const previousPages = this.lastRenderedPages;
    if (!keep && nextDocumentId) {
      this.fields.update(fields => fields.filter(field => field.documentLocalId !== nextDocumentId));
    }
    this.docBytes = null;

    const doc = this.document;
    if (!doc) {
      this.loadedDocumentId = null;
      this.pages.set([]);
      this.loading.set(false);
      this.loadError.set('');
      return;
    }

    this.loading.set(true);
    this.loadError.set('');
    try {
      // Cadena de fuentes: bytes subidos → sample PDF (documentos sin bytes) → páginas en blanco (no PDF).
      let bytes: Uint8Array | null = null;
      if (doc.blob && doc.kind === 'pdf') {
        bytes = new Uint8Array(await doc.blob.arrayBuffer());
      } else if (doc.kind === 'pdf') {
        const res = await fetch('/assets/sample-document.pdf');
        if (!res.ok) {
          throw new Error(`sample PDF fetch failed (${res.status})`);
        }
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      const scaleFor = (pointsWidth: number): number =>
        BASE_SCALE * (this.isNarrow() ? this.fitZoomFor(pointsWidth) : 1);
      const pages = bytes
        ? await renderPdfPages({ data: bytes.slice() }, scaleFor, { signal: abort.signal })
        : blankPages(3, scaleFor(612));
      if (token !== this.loadToken) {
        return;
      }
      if (pages.length === 0) {
        throw new Error('PDF has no pages');
      }
      this.docBytes = bytes;
      this.zoom.set(pages[0].scale / BASE_SCALE);
      if (keep) {
        const activeFields = this.fields().filter(field => field.documentLocalId === doc.id);
        const inactiveFields = this.fields().filter(field => field.documentLocalId !== doc.id);
        const { kept, dropped } = remapFieldsToPages(activeFields, previousPages, pages);
        this.fields.set([...inactiveFields, ...kept]);
        if (dropped.length > 0) {
          this.notice.set(
            `${dropped.length} ${dropped.length === 1 ? 'field was' : 'fields were'} on pages the new document doesn't have and ${dropped.length === 1 ? 'was' : 'were'} removed.`,
          );
        }
      }
      this.pages.set(pages);
      this.lastRenderedPages = pages;
      this.loadedDocumentId = doc.id;
      this.pageMetricsByDocument.set(doc.id, pages);
      this.currentPage.set(1);
      this.autoFitPending = true;
      // Continuar un borrador: ahora que hay dimensiones de página, colocamos los campos sembrados.
      this.applyPendingSeedFields();
    } catch (err) {
      if (token !== this.loadToken || isPdfRenderAborted(err)) {
        return;
      }
      console.error('[signature] PDF render failed', err);
      // Nada de páginas en blanco falsas: sin páginas no se puede colocar ni exportar (ver safeToExport).
      this.loadError.set(PDF_RENDER_FRIENDLY_ERROR);
      this.pages.set([]);
    } finally {
      if (token === this.loadToken) {
        this.loading.set(false);
        this.renderAbort = null;
        // Si el área ya es visible (p. ej. Retry en el paso 3), se ajusta ahora; si no, al mostrarse.
        queueMicrotask(() => this.maybeAutoFit());
      }
    }
  }
}
