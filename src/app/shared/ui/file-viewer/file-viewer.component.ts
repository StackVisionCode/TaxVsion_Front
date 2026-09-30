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
import { PDFJS_STANDARD_FONTS_URL, loadPdfjs } from '@shared/utils/pdfjs-loader';
import {
  FileViewerDownload,
  FileViewerItem,
  FileViewerKind,
  MAX_ZOOM,
  MIN_ZOOM,
  detectViewerKind,
  formatViewerBytes,
  moveIndex,
  parseCsv,
  stepZoom,
} from './file-viewer.model';

/**
 * Visor de archivos global (overlay a pantalla completa).
 *
 * API:
 *   <app-file-viewer
 *     [isOpen]="viewerOpen()"                 // muestra/oculta el overlay
 *     [files]="viewerFiles()"                 // FileViewerItem[]: { name, contentType?, url? | resolveUrl?, sizeBytes?, ref? }
 *     [startIndex]="viewerIndex()"            // archivo con el que abre
 *     [allowDownload]="true"                  // opcional: false oculta todo botón de descarga
 *     (closed)="viewerOpen.set(false)"        // Esc, X o clic en el fondo
 *     (indexChange)="viewerIndex.set($event)" // opcional: el usuario pasó al anterior/siguiente
 *     (download)="onDownload($event)" />      // opcional: { item, index }. Sin listener, el visor
 *                                             // descarga solo (con los bytes ya bajados o la URL).
 *
 * `resolveUrl` puede devolver Observable o Promise<string> y se llama recién al mostrar ese archivo
 * (las URLs presignadas vencen). La URL tiene que admitir `fetch` (CORS) para PDF y texto.
 *
 * Renderiza: PDF con pdf.js (página por página, zoom +/−/ajustar), imágenes (zoom y arrastre),
 * texto plano y CSV (tabla, primeras 500 filas). Lo demás muestra una tarjeta con "Download".
 * Teclado: ←/→ página del PDF (en otros tipos, archivo), Alt+←/→ siempre archivo, +/− zoom,
 * 0 ajustar, Esc cierra.
 */

/** Texto más grande que esto se corta (el <pre> con megas de texto congela la pestaña). */
const MAX_TEXT_BYTES = 1024 * 1024;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-file-viewer',
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

  @ViewChild('pdfCanvas') private pdfCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('stage') private stage?: ElementRef<HTMLElement>;

  // Las listas del padre llegan por @Input clásico: se reflejan en señales para los computed.
  private readonly items = signal<readonly FileViewerItem[]>([]);
  readonly index = signal(0);
  readonly state = signal<LoadState>('idle');

  readonly current = computed<FileViewerItem | null>(() => this.items()[this.index()] ?? null);
  readonly kind = computed<FileViewerKind>(() => {
    const item = this.current();
    return item ? detectViewerKind(item.name, item.contentType) : 'unsupported';
  });
  readonly count = computed(() => this.items().length);
  readonly hasPrev = computed(() => moveIndex(this.index(), -1, this.count()) !== null);
  readonly hasNext = computed(() => moveIndex(this.index(), 1, this.count()) !== null);
  readonly subtitle = computed(() => {
    const item = this.current();
    if (!item) {
      return '';
    }
    const parts = [kindLabel(this.kind()), formatViewerBytes(item.sizeBytes)].filter(Boolean);
    if (this.count() > 1) {
      parts.push(`${this.index() + 1} of ${this.count()}`);
    }
    return parts.join(' · ');
  });

  // ---- Contenido cargado ----
  readonly imageUrl = signal<string | null>(null);
  readonly text = signal<string>('');
  readonly csvRows = signal<string[][]>([]);
  readonly truncated = signal(false);

  // ---- PDF ----
  readonly pageCount = signal(0);
  readonly page = signal(1);
  /** null = ajustado al ancho; un número = zoom manual. */
  readonly pdfZoom = signal<number | null>(null);
  /** Escala con la que se pintó la página (para mostrar el % también en modo ajustar). */
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

  private blob: Blob | null = null;
  private pdfDoc: PDFDocumentProxy | null = null;
  private renderTask: RenderTask | null = null;
  /** Descarta resultados de una carga vieja (el usuario ya pasó a otro archivo). */
  private loadToken = 0;
  private panStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private previousBodyOverflow: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const previousItem = this.current();
    if (changes['files']) {
      this.items.set(this.files ?? []);
    }
    if (!this.isOpen) {
      if (changes['isOpen']) {
        this.reset();
        this.unlockScroll();
      }
      return;
    }
    // Un `startIndex` que solo refleja el `indexChange` que emitimos (el padre lo sincroniza) no
    // debe recargar el mismo archivo.
    const startMoved =
      !!changes['startIndex'] && clampIndex(this.startIndex, this.items().length) !== this.index();
    if (changes['isOpen'] || startMoved) {
      this.lockScroll();
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
    this.reset();
    this.unlockScroll();
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
  }

  // ================= Navegación =================

  close(): void {
    this.closed.emit();
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

  goToPage(page: number): void {
    if (page < 1 || page > this.pageCount() || page === this.page()) {
      return;
    }
    this.page.set(page);
    void this.renderPdfPage();
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
      this.pdfZoom.set(null);
      void this.renderPdfPage();
    } else {
      this.resetImageView();
    }
  }

  private zoom(direction: 'in' | 'out'): void {
    if (!this.canZoom()) {
      return;
    }
    if (this.kind() === 'pdf') {
      this.pdfZoom.set(stepZoom(this.pdfZoom() ?? this.pdfScale(), direction));
      void this.renderPdfPage();
      return;
    }
    const next = stepZoom(this.imageZoom(), direction);
    this.imageZoom.set(next);
    if (next <= 1) {
      this.panX.set(0);
      this.panY.set(0);
    }
  }

  readonly minZoomReached = computed(() =>
    (this.kind() === 'pdf' ? (this.pdfZoom() ?? this.pdfScale()) : this.imageZoom()) <= MIN_ZOOM,
  );
  readonly maxZoomReached = computed(() =>
    (this.kind() === 'pdf' ? (this.pdfZoom() ?? this.pdfScale()) : this.imageZoom()) >= MAX_ZOOM,
  );

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

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const pdfPaging = this.kind() === 'pdf' && this.pageCount() > 1 && !event.altKey;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (pdfPaging) {
          this.goToPage(this.page() - 1);
        } else {
          this.go(-1);
        }
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (pdfPaging) {
          this.goToPage(this.page() + 1);
        } else {
          this.go(1);
        }
        break;
      case '+':
      case '=':
        event.preventDefault();
        this.zoomIn();
        break;
      case '-':
        event.preventDefault();
        this.zoomOut();
        break;
      case '0':
        event.preventDefault();
        this.fit();
        break;
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
    this.resizeTimer = setTimeout(() => void this.renderPdfPage(), 150);
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
      triggerAnchor(await resolveUrl(item), item.name);
    } catch {
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
      const url = await resolveUrl(item);
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
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
        const content = await slice.text();
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
        this.pageCount.set(doc.numPages);
        this.page.set(1);
      }
      this.state.set('ready');
      if (kind === 'pdf') {
        // El <canvas> aparece con el estado 'ready': se pinta en el siguiente tick.
        setTimeout(() => void this.renderPdfPage());
      }
    } catch {
      if (token === this.loadToken) {
        this.state.set('error');
      }
    }
  }

  private async renderPdfPage(): Promise<void> {
    const doc = this.pdfDoc;
    const canvas = this.pdfCanvas?.nativeElement;
    if (!doc || !canvas) {
      return;
    }
    this.renderTask?.cancel();
    this.renderTask = null;
    try {
      const page = await doc.getPage(this.page());
      const base = page.getViewport({ scale: 1 });
      const available = (this.stage?.nativeElement.clientWidth ?? 800) - 48;
      const fitScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, available / base.width));
      const scale = this.pdfZoom() ?? fitScale;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
      this.pdfScale.set(scale);
      const task = page.render({ canvas, viewport });
      this.renderTask = task;
      await task.promise;
    } catch {
      // Cancelar un render en curso (cambio de página/zoom rápido) rechaza la promesa: es esperado.
    }
  }

  // ================= Limpieza =================

  private clearContent(): void {
    this.renderTask?.cancel();
    this.renderTask = null;
    if (this.pdfDoc) {
      void this.pdfDoc.loadingTask.destroy();
      this.pdfDoc = null;
    }
    const image = this.imageUrl();
    if (image) {
      URL.revokeObjectURL(image);
    }
    this.blob = null;
    this.imageUrl.set(null);
    this.text.set('');
    this.csvRows.set([]);
    this.truncated.set(false);
    this.pageCount.set(0);
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

  private reset(): void {
    this.loadToken++;
    this.clearContent();
    this.state.set('idle');
  }

  private lockScroll(): void {
    if (this.previousBodyOverflow === null && typeof document !== 'undefined') {
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }

  private unlockScroll(): void {
    if (this.previousBodyOverflow !== null && typeof document !== 'undefined') {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(index) || 0), length - 1);
}

async function resolveUrl(item: FileViewerItem): Promise<string> {
  if (item.url) {
    return item.url;
  }
  if (!item.resolveUrl) {
    throw new Error('File has no URL');
  }
  const result = item.resolveUrl();
  return isObservable(result) ? firstValueFrom(result) : result;
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

function kindLabel(kind: FileViewerKind): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return 'Image';
    case 'csv':
      return 'CSV';
    case 'text':
      return 'Text';
    default:
      return 'File';
  }
}
