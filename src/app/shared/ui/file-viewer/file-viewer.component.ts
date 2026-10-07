import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { firstValueFrom, isObservable } from 'rxjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { formatBytes } from '@shared/utils/format.util';
import { captureActiveElement, setBodyScrollLock, trapTabKey } from '@shared/utils/overlay.util';
import { PDFJS_STANDARD_FONTS_URL, loadPdfjs } from '@shared/utils/pdfjs-loader';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';
import {
  FileViewerDownload,
  FileViewerItem,
  FileViewerKind,
  MAX_CSV_ROWS,
  MAX_TEXT_BYTES,
  MAX_ZOOM,
  MIN_ZOOM,
  ViewerHttpError,
  clampIndex,
  clampZoom,
  detectViewerKind,
  friendlyViewerError,
  kindLabel,
  moveIndex,
  parseCsv,
  parsePageInput,
  stepZoom,
} from './file-viewer.model';

/**
 * Visor GLOBAL de archivos (overlay a pantalla completa). Úsalo en vez de abrir URLs en otra
 * pestaña o de pintar "vistas previas" propias.
 *
 * API:
 *   <app-file-viewer
 *     [isOpen]="viewerOpen()"                 // muestra/oculta el overlay
 *     [files]="viewerFiles()"                 // FileViewerItem[]: { name, contentType?, url? | resolveUrl?, sizeBytes?, ref? }
 *     [startIndex]="viewerIndex()"            // archivo con el que abre (default 0)
 *     [allowDownload]="true"                  // opcional: false oculta todo botón de descarga
 *     (closed)="viewerOpen.set(false)"        // Esc, X o clic en el fondo
 *     (indexChange)="viewerIndex.set($event)" // opcional: el usuario pasó al anterior/siguiente
 *     (download)="onDownload($event)" />      // opcional: { item, index }. Sin listener, el visor
 *                                             // descarga solo (con los bytes ya bajados o la URL).
 *
 * - `resolveUrl` (Observable o Promise<string>) se llama recién al mostrar ese archivo: las URLs
 *   presignadas vencen. Los bytes se bajan con `fetch` SIN credenciales ni cabecera Authorization
 *   (las presignadas llevan la firma en la query), así que la URL debe admitir CORS.
 * - Renderiza PDF con pdf.js (cargado bajo demanda; páginas pintadas al entrar en pantalla, nítidas
 *   en pantallas HiDPI), imágenes (zoom y arrastre), texto (primer 1 MB) y CSV (tabla, 500 filas).
 *   Lo demás muestra una tarjeta con "Download". Los errores son mensajes legibles, nunca los de pdf.js.
 * - Teclado: ←/→ página del PDF (en otros tipos, archivo), Alt+←/→ siempre archivo, +/− zoom,
 *   0 ajustar, Esc cierra. Ctrl/⌘ + rueda = zoom.
 * - Accesible: role="dialog", aria-modal, focus-trap y el foco vuelve al disparador al cerrar.
 *   Comparte el contador de bloqueo de scroll con app-modal/app-drawer (overlay.util).
 * - Va por encima de modales y drawers (z-[68]) y por debajo de los toasts. El overlay se mueve al
 *   <body> al abrirse, así que puede declararse en cualquier plantilla (también dentro de un drawer).
 */

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Hueco de una página del PDF: tamaño CSS (px) a la escala actual. */
export interface PdfPageSlot {
  readonly num: number;
  readonly width: number;
  readonly height: number;
}

/** Escala máxima del modo "ajustar" (en monitores anchos una hoja a todo el ancho es ilegible). */
const MAX_FIT_SCALE = 2;
/** Por encima de esto se liberan los canvas de páginas lejanas para no agotar memoria. */
const RELEASE_PAGES_ABOVE = 8;

@Component({
  selector: 'app-file-viewer',
  imports: [StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './file-viewer.component.html',
})
export class FileViewerComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() files: readonly FileViewerItem[] = [];
  @Input() startIndex = 0;
  /** false = solo ver (p. ej. un enlace público de solo lectura): sin botones de descarga. */
  @Input() allowDownload = true;
  @Output() closed = new EventEmitter<void>();
  @Output() indexChange = new EventEmitter<number>();
  @Output() download = new EventEmitter<FileViewerDownload>();

  /**
   * El panel se "porta" al <body> al montarse: así un ancestro con `transform` (drawer, animación de
   * fila) no encierra el `position: fixed`, y el visor cubre la pantalla esté donde esté declarado.
   * Angular lo quita después con `node.remove()`, así que moverlo es seguro.
   */
  @ViewChild('panel')
  private set panelRef(ref: ElementRef<HTMLElement> | undefined) {
    this.panel = ref;
    const el = ref?.nativeElement;
    if (el && typeof document !== 'undefined' && el.parentNode !== document.body) {
      document.body.appendChild(el);
    }
  }
  private panel?: ElementRef<HTMLElement>;
  @ViewChild('stage') private stage?: ElementRef<HTMLElement>;
  @ViewChild('closeButton') private closeButton?: ElementRef<HTMLButtonElement>;

  // Las listas del padre llegan por @Input clásico: se reflejan en señales para los computed.
  private readonly items = signal<readonly FileViewerItem[]>([]);
  readonly index = signal(0);
  readonly state = signal<LoadState>('idle');
  readonly errorMessage = signal('');

  readonly current = computed<FileViewerItem | null>(() => this.items()[this.index()] ?? null);
  readonly kind = computed<FileViewerKind>(() => {
    const item = this.current();
    return item ? detectViewerKind(item.name, item.contentType) : 'unsupported';
  });
  readonly count = computed(() => this.items().length);
  readonly hasPrev = computed(() => moveIndex(this.index(), -1, this.count()) !== null);
  readonly hasNext = computed(() => moveIndex(this.index(), 1, this.count()) !== null);
  readonly typeLabel = computed(() => kindLabel(this.kind(), this.current()?.name ?? ''));
  readonly sizeLabel = computed(() => {
    const size = this.current()?.sizeBytes;
    return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? formatBytes(size, { maxUnit: 'GB' }) : '';
  });
  readonly positionLabel = computed(() => (this.count() > 1 ? `${this.index() + 1} of ${this.count()}` : ''));

  // ---- Contenido cargado ----
  readonly imageUrl = signal<string | null>(null);
  readonly text = signal<string>('');
  readonly csvRows = signal<string[][]>([]);
  readonly truncated = signal(false);
  readonly maxCsvRows = MAX_CSV_ROWS;

  // ---- PDF ----
  readonly pdfPages = signal<PdfPageSlot[]>([]);
  readonly pageCount = computed(() => this.pdfPages().length);
  /** Página visible (1-based), según el scroll. */
  readonly page = signal(1);
  /** null = ajustado al ancho; un número = zoom manual. */
  readonly pdfZoom = signal<number | null>(null);
  /** Escala con la que se maquetan las páginas (también en modo ajustar). */
  readonly pdfScale = signal(1);

  // ---- Imagen ----
  readonly imageZoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly panning = signal(false);

  readonly zoomPercent = computed(() =>
    Math.round((this.kind() === 'pdf' ? this.pdfScale() : this.imageZoom()) * 100),
  );
  readonly canZoom = computed(() => this.state() === 'ready' && (this.kind() === 'pdf' || this.kind() === 'image'));
  private readonly zoomValue = computed(() => (this.kind() === 'pdf' ? this.pdfScale() : this.imageZoom()));
  readonly minZoomReached = computed(() => this.zoomValue() <= MIN_ZOOM);
  readonly maxZoomReached = computed(() => this.zoomValue() >= MAX_ZOOM);

  /** Id para `aria-labelledby`. */
  readonly titleId = `file-viewer-title-${viewerSeq++}`;

  private blob: Blob | null = null;
  private pdfDoc: PDFDocumentProxy | null = null;
  /** Tamaño de cada página a escala 1 (se completa al pintar cada una). */
  private baseSizes: { width: number; height: number }[] = [];
  private readonly renderTasks = new Map<number, RenderTask>();
  /** Página → escala con la que se pintó (para no repintar lo que ya está bien). */
  private readonly renderedAt = new Map<number, number>();
  private readonly nearViewport = new Set<number>();
  /** Renders en preparación ("página@escala") para no pintar dos veces el mismo canvas. */
  private readonly pendingRenders = new Set<string>();
  private observer: IntersectionObserver | null = null;
  /** Descarta resultados de una carga vieja (el usuario ya pasó a otro archivo o cerró). */
  private loadToken = 0;
  private panStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollFrame: number | null = null;
  private hasScrollLock = false;
  private returnFocusTo: HTMLElement | null = null;
  /** Listener de teclado en fase de captura: así Esc/Tab no llegan al modal/drawer de debajo. */
  private readonly keydownListener = (event: KeyboardEvent): void => this.onKeydown(event);
  private listening = false;

  ngOnChanges(changes: SimpleChanges): void {
    const previousItem = this.current();
    if (changes['files']) {
      this.items.set(this.files ?? []);
    }
    if (!this.isOpen) {
      if (changes['isOpen'] && !changes['isOpen'].firstChange) {
        this.teardown();
      }
      return;
    }
    // Un `startIndex` que solo refleja el `indexChange` que emitimos (el padre lo sincroniza) no
    // debe recargar el mismo archivo.
    const startMoved =
      !!changes['startIndex'] && clampIndex(this.startIndex, this.items().length) !== this.index();
    if (changes['isOpen'] || startMoved) {
      if (changes['isOpen']) {
        this.activate();
      }
      this.index.set(clampIndex(this.startIndex, this.items().length));
      void this.load();
      return;
    }
    // La lista cambió con el visor abierto: se recarga solo si cambió el archivo mostrado.
    if (changes['files']) {
      this.index.set(clampIndex(this.index(), this.items().length));
      if (this.current() !== previousItem) {
        void this.load();
      }
    }
  }

  ngOnDestroy(): void {
    this.teardown();
    // Al destruir el componente padre Angular solo quita SU host, no los nodos hijos uno a uno:
    // el panel portado al <body> se quitaría nunca. Se quita a mano.
    this.panel?.nativeElement.remove();
  }

  // ================= Navegación =================

  close(): void {
    this.closed.emit();
  }

  /** Clic en el fondo (fuera del contenido) cierra. */
  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  go(delta: number): void {
    const next = moveIndex(this.index(), delta, this.count());
    if (next === null) {
      return;
    }
    this.index.set(next);
    this.indexChange.emit(next);
    void this.load();
  }

  retry(): void {
    void this.load();
  }

  goToPage(target: number | string): void {
    const page = parsePageInput(target, this.pageCount());
    if (page === null) {
      return;
    }
    this.page.set(page);
    const wrapper = this.pageElement(page);
    wrapper?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    void this.renderPage(page);
  }

  /** Input "página": Enter o blur saltan; un valor inválido se reescribe con la página actual. */
  onPageInput(input: HTMLInputElement): void {
    const page = parsePageInput(input.value, this.pageCount());
    if (page === null) {
      input.value = String(this.page());
      return;
    }
    input.value = String(page);
    this.goToPage(page);
  }

  // ================= Zoom =================

  zoomIn(): void {
    this.zoom('in');
  }

  zoomOut(): void {
    this.zoom('out');
  }

  fit(): void {
    if (this.kind() === 'pdf') {
      this.applyPdfZoom(null);
    } else {
      this.resetImageView();
    }
  }

  private zoom(direction: 'in' | 'out'): void {
    if (!this.canZoom()) {
      return;
    }
    if (this.kind() === 'pdf') {
      this.applyPdfZoom(stepZoom(this.pdfScale(), direction));
      return;
    }
    const next = stepZoom(this.imageZoom(), direction);
    this.imageZoom.set(next);
    if (next <= 1) {
      this.panX.set(0);
      this.panY.set(0);
    }
  }

  // ================= Arrastre de la imagen =================

  onPointerDown(event: PointerEvent): void {
    if (this.imageZoom() <= 1) {
      return;
    }
    this.panStart = { x: event.clientX, y: event.clientY, panX: this.panX(), panY: this.panY() };
    this.panning.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.panStart) {
      return;
    }
    this.panX.set(this.panStart.panX + (event.clientX - this.panStart.x));
    this.panY.set(this.panStart.panY + (event.clientY - this.panStart.y));
  }

  onPointerUp(): void {
    this.panStart = null;
    this.panning.set(false);
  }

  /** Ctrl/⌘ + rueda = zoom (la rueda sola sigue haciendo scroll). */
  onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || !this.canZoom()) {
      return;
    }
    event.preventDefault();
    this.zoom(event.deltaY < 0 ? 'in' : 'out');
  }

  // ================= Teclado =================

  onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) {
      return;
    }
    if (event.key === 'Tab') {
      const panel = this.panel?.nativeElement;
      if (panel) {
        trapTabKey(event, panel);
      }
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    const pdfPaging = this.kind() === 'pdf' && this.pageCount() > 1 && !event.altKey;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        if (pdfPaging) {
          this.goToPage(this.page() - 1);
        } else {
          this.go(-1);
        }
        break;
      case 'ArrowRight':
        if (pdfPaging) {
          this.goToPage(this.page() + 1);
        } else {
          this.go(1);
        }
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
      case '_':
        this.zoomOut();
        break;
      case '0':
        this.fit();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.isOpen || this.kind() !== 'pdf' || this.pdfZoom() !== null) {
      return;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => this.layoutPdf(), 150);
  }

  /** Página visible = la última cuyo borde superior pasó el 30 % del alto del escenario. */
  onStageScroll(): void {
    if (this.kind() !== 'pdf' || this.scrollFrame !== null) {
      return;
    }
    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
    this.scrollFrame = schedule(() => {
      this.scrollFrame = null;
      const stage = this.stage?.nativeElement;
      if (!stage) {
        return;
      }
      const threshold = stage.getBoundingClientRect().top + stage.clientHeight * 0.3;
      let visible = 1;
      for (const el of Array.from(stage.querySelectorAll<HTMLElement>('[data-page-slot]'))) {
        if (el.getBoundingClientRect().top <= threshold) {
          visible = Number(el.dataset['pageSlot']) || visible;
        } else {
          break;
        }
      }
      this.page.set(visible);
    });
  }

  // ================= Descarga =================

  async onDownload(): Promise<void> {
    const item = this.current();
    if (!item || !this.allowDownload) {
      return;
    }
    // Si el padre escucha, él decide (p. ej. pedir una URL presignada nueva con el nombre real).
    if (this.download.observed) {
      this.download.emit({ item, index: this.index() });
      return;
    }
    if (this.blob) {
      const url = URL.createObjectURL(this.blob);
      triggerAnchor(url, item.name);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    try {
      triggerAnchor(await resolveItemUrl(item), item.name);
    } catch (err) {
      this.errorMessage.set(friendlyViewerError(err));
      this.state.set('error');
    }
  }

  // ================= Carga =================

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.clearContent();
    const item = this.current();
    if (!item) {
      this.state.set('idle');
      return;
    }
    const kind = this.kind();
    if (kind === 'unsupported') {
      // Nada que renderizar: tarjeta con Download, sin bajar el archivo.
      this.state.set('ready');
      return;
    }
    this.state.set('loading');
    try {
      const url = await resolveItemUrl(item);
      if (token !== this.loadToken) {
        return;
      }
      // Sin credenciales: las URLs presignadas llevan la firma en la query (una cabecera
      // Authorization las rompería) y blob:/data: no las necesitan.
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) {
        throw new ViewerHttpError(response.status);
      }
      const blob = await response.blob();
      if (token !== this.loadToken) {
        return;
      }
      this.blob = blob;

      if (kind === 'image') {
        this.imageUrl.set(URL.createObjectURL(blob));
      } else if (kind === 'text' || kind === 'csv') {
        const slice = blob.size > MAX_TEXT_BYTES ? blob.slice(0, MAX_TEXT_BYTES) : blob;
        const content = await readBlobText(slice);
        if (token !== this.loadToken) {
          return;
        }
        if (kind === 'csv') {
          const parsed = parseCsv(content);
          this.csvRows.set(parsed.rows);
          this.truncated.set(parsed.truncated || blob.size > MAX_TEXT_BYTES);
        } else {
          this.text.set(content);
          this.truncated.set(blob.size > MAX_TEXT_BYTES);
        }
      } else if (kind === 'pdf') {
        const lib = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        const doc = await lib.getDocument({ data, standardFontDataUrl: PDFJS_STANDARD_FONTS_URL }).promise;
        if (token !== this.loadToken) {
          void doc.loadingTask.destroy();
          return;
        }
        this.pdfDoc = doc;
        // Todas las páginas se maquetan con el tamaño de la 1 hasta que se pinta cada una (así el
        // scroll tiene su alto real sin pedir las N páginas de golpe).
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (token !== this.loadToken) {
          return;
        }
        this.baseSizes = Array.from({ length: doc.numPages }, () => ({ width: first.width, height: first.height }));
        this.page.set(1);
      }
      this.state.set('ready');
      if (kind === 'pdf') {
        // El escenario de páginas aparece con el estado 'ready': se maqueta en el siguiente tick.
        setTimeout(() => {
          if (token === this.loadToken) {
            this.layoutPdf();
          }
        });
      }
    } catch (err) {
      if (token === this.loadToken) {
        this.errorMessage.set(friendlyViewerError(err));
        this.state.set('error');
      }
    }
  }

  // ================= PDF =================

  private fitScale(): number {
    const stage = this.stage?.nativeElement;
    const width = stage?.clientWidth || 800;
    const gutter = width < 640 ? 16 : 48;
    const pageWidth = this.baseSizes[0]?.width || 612;
    return clampZoom(Math.min(MAX_FIT_SCALE, (width - gutter) / pageWidth));
  }

  private applyPdfZoom(zoom: number | null): void {
    const stage = this.stage?.nativeElement;
    const previous = this.pdfScale();
    this.pdfZoom.set(zoom);
    this.layoutPdf();
    // Conserva la posición relativa del scroll (la página que se leía sigue a la vista). Se aplica
    // tras el render, cuando los huecos ya tienen su nuevo alto (antes el navegador lo recortaría).
    if (stage && previous > 0) {
      const target = stage.scrollTop * (this.pdfScale() / previous);
      setTimeout(() => (stage.scrollTop = target));
    }
  }

  /** Recalcula el tamaño de los huecos de página y repinta las que están cerca de la vista. */
  private layoutPdf(): void {
    if (!this.pdfDoc) {
      return;
    }
    const scale = this.pdfZoom() ?? this.fitScale();
    this.pdfScale.set(scale);
    this.pdfPages.set(this.baseSizes.map((size, i) => slotFor(i + 1, size, scale)));
    // Lo pintado a otra escala ya no sirve.
    for (const task of this.renderTasks.values()) {
      task.cancel();
    }
    this.renderTasks.clear();
    this.renderedAt.clear();
    // Los huecos se crean/redimensionan en este ciclo: se observan y pintan en el siguiente.
    const token = this.loadToken;
    setTimeout(() => {
      if (token === this.loadToken) {
        this.observePages();
      }
    });
  }

  private observePages(): void {
    const stage = this.stage?.nativeElement;
    if (!stage) {
      return;
    }
    const slots = Array.from(stage.querySelectorAll<HTMLElement>('[data-page-slot]'));
    if (typeof IntersectionObserver === 'undefined') {
      // Sin IntersectionObserver (navegadores muy viejos, tests): se pintan las primeras páginas.
      slots.slice(0, 3).forEach(el => void this.renderPage(Number(el.dataset['pageSlot'])));
      return;
    }
    this.observer ??= new IntersectionObserver(entries => this.onPagesIntersect(entries), {
      root: stage,
      // Se pinta con una pantalla de antelación para que el scroll no muestre hojas en blanco.
      rootMargin: '100% 0px',
    });
    slots.forEach(el => this.observer?.observe(el));
    // Repinta lo que ya estaba a la vista (un zoom no dispara nuevas intersecciones).
    for (const num of this.nearViewport) {
      void this.renderPage(num);
    }
  }

  private onPagesIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const num = Number((entry.target as HTMLElement).dataset['pageSlot']);
      if (!num) {
        continue;
      }
      if (entry.isIntersecting) {
        this.nearViewport.add(num);
        void this.renderPage(num);
      } else {
        this.nearViewport.delete(num);
        if (this.pageCount() > RELEASE_PAGES_ABOVE) {
          this.releasePage(num);
        }
      }
    }
  }

  private async renderPage(num: number): Promise<void> {
    const doc = this.pdfDoc;
    const scale = this.pdfScale();
    const key = `${num}@${scale}`;
    if (
      !doc ||
      num < 1 ||
      num > doc.numPages ||
      this.renderedAt.get(num) === scale ||
      this.renderTasks.has(num) ||
      this.pendingRenders.has(key)
    ) {
      return;
    }
    const token = this.loadToken;
    this.pendingRenders.add(key);
    try {
      const page = await doc.getPage(num);
      if (token !== this.loadToken || scale !== this.pdfScale()) {
        return;
      }
      const base = page.getViewport({ scale: 1 });
      const known = this.baseSizes[num - 1];
      if (known && (Math.abs(known.width - base.width) > 0.5 || Math.abs(known.height - base.height) > 0.5)) {
        // La página tiene otro tamaño que la 1: se corrige su hueco.
        this.baseSizes[num - 1] = { width: base.width, height: base.height };
        this.pdfPages.update(slots => slots.map(s => (s.num === num ? slotFor(num, base, scale) : s)));
      }
      const canvas = this.stage?.nativeElement.querySelector<HTMLCanvasElement>(`canvas[data-page-canvas="${num}"]`);
      if (!canvas) {
        return;
      }
      // Nítido en HiDPI: el canvas se pinta a escala × devicePixelRatio y se muestra al tamaño CSS.
      const ratio = Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const viewport = page.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = page.render({ canvas, viewport });
      this.renderTasks.set(num, task);
      await task.promise;
      if (this.renderTasks.get(num) === task) {
        this.renderTasks.delete(num);
        this.renderedAt.set(num, scale);
      }
    } catch {
      // Cancelar un render en curso (zoom o cambio de archivo) rechaza la promesa: es esperado.
      this.renderTasks.delete(num);
    } finally {
      this.pendingRenders.delete(key);
    }
  }

  private releasePage(num: number): void {
    this.renderTasks.get(num)?.cancel();
    this.renderTasks.delete(num);
    this.renderedAt.delete(num);
    const canvas = this.stage?.nativeElement.querySelector<HTMLCanvasElement>(`canvas[data-page-canvas="${num}"]`);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  private pageElement(num: number): HTMLElement | null {
    return this.stage?.nativeElement.querySelector<HTMLElement>(`[data-page-slot="${num}"]`) ?? null;
  }

  // ================= Apertura / cierre =================

  private activate(): void {
    if (!this.hasScrollLock) {
      this.hasScrollLock = true;
      setBodyScrollLock(true);
    }
    if (!this.listening && typeof document !== 'undefined') {
      document.addEventListener('keydown', this.keydownListener, true);
      this.listening = true;
    }
    // En este momento el foco sigue en el disparador: se guarda para devolvérselo al cerrar.
    this.returnFocusTo ??= captureActiveElement();
    setTimeout(() => {
      if (this.isOpen) {
        (this.closeButton?.nativeElement ?? this.panel?.nativeElement)?.focus();
      }
    });
  }

  private teardown(): void {
    this.loadToken++;
    this.clearContent();
    this.state.set('idle');
    if (this.hasScrollLock) {
      this.hasScrollLock = false;
      setBodyScrollLock(false);
    }
    if (this.listening) {
      document.removeEventListener('keydown', this.keydownListener, true);
      this.listening = false;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    target?.focus?.();
  }

  private clearContent(): void {
    for (const task of this.renderTasks.values()) {
      task.cancel();
    }
    this.renderTasks.clear();
    this.renderedAt.clear();
    this.pendingRenders.clear();
    this.nearViewport.clear();
    this.observer?.disconnect();
    this.observer = null;
    if (this.pdfDoc) {
      void this.pdfDoc.loadingTask.destroy();
      this.pdfDoc = null;
    }
    this.baseSizes = [];
    const image = this.imageUrl();
    if (image) {
      URL.revokeObjectURL(image);
    }
    this.blob = null;
    this.imageUrl.set(null);
    this.text.set('');
    this.csvRows.set([]);
    this.truncated.set(false);
    this.errorMessage.set('');
    this.pdfPages.set([]);
    this.page.set(1);
    this.pdfZoom.set(null);
    this.pdfScale.set(1);
    this.resetImageView();
  }

  private resetImageView(): void {
    this.imageZoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }
}

let viewerSeq = 0;

function slotFor(num: number, size: { width: number; height: number }, scale: number): PdfPageSlot {
  return { num, width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) };
}

async function resolveItemUrl(item: FileViewerItem): Promise<string> {
  if (item.url) {
    return item.url;
  }
  if (!item.resolveUrl) {
    throw new Error('File has no URL');
  }
  const result = item.resolveUrl();
  return isObservable(result) ? firstValueFrom(result) : result;
}

/** `Blob.text()` con respaldo para entornos sin él (jsdom antiguos). */
function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function triggerAnchor(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
