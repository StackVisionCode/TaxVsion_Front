import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IDENTITY_TRANSFORM,
  PadPoint,
  PadStroke,
  PadTransform,
  fitFontSize,
  fitTransform,
  scaleToMax,
  strokesBounds,
  toModel,
} from './signature-pad.geometry';

export type SignatureMethod = 'draw' | 'type' | 'upload';

interface SignatureFontOption {
  id: string;
  label: string;
  fontFamily: string;
  fontStyle: 'italic' | 'normal';
  fontWeight: 'normal' | 'bold';
}

interface InkOption {
  id: string;
  label: string;
  color: string;
}

interface StrokeOption {
  id: string;
  label: string;
  width: number;
}

/** System-safe cursive/serif stacks only — no external font loading (proyecto sin dependencias CDN). */
const FONT_OPTIONS: SignatureFontOption[] = [
  { id: 'flowing', label: 'Flowing', fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontStyle: 'italic', fontWeight: 'normal' },
  { id: 'handwritten', label: 'Handwritten', fontFamily: "'Lucida Handwriting', 'Apple Chancery', 'Comic Sans MS', cursive", fontStyle: 'italic', fontWeight: 'normal' },
  { id: 'classic', label: 'Classic', fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', fontWeight: 'normal' },
  { id: 'elegant', label: 'Elegant', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 'bold' },
  { id: 'formal', label: 'Formal', fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", fontStyle: 'italic', fontWeight: 'normal' },
  { id: 'modern', label: 'Modern', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontStyle: 'normal', fontWeight: 'normal' },
];

const INK_OPTIONS: InkOption[] = [
  { id: 'black', label: 'Black', color: '#111827' },
  { id: 'blue', label: 'Blue', color: '#1d4ed8' },
];

const STROKE_OPTIONS: StrokeOption[] = [
  { id: 'thin', label: 'Thin', width: 1.8 },
  { id: 'medium', label: 'Medium', width: 2.6 },
  { id: 'thick', label: 'Thick', width: 3.8 },
];

/** Subidas: mismo tope y formatos que el creador de firmas del staff. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg'];
/** Lado mayor de una imagen subida: el backend acepta PNG de hasta 1,5 MB, una foto grande no cabría. */
const MAX_UPLOAD_SIDE = 800;

/** Lienzo de la firma tecleada y rango de tamaños de fuente (se achica para que el nombre quepa). */
const TYPED_WIDTH = 480;
const TYPED_HEIGHT = 160;
const TYPED_PADDING = 16;
const TYPED_FONT_START = 56;
const TYPED_FONT_MIN = 22;

/** Resolución de la exportación del dibujo (2× los píxeles CSS en que se trazó). */
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 10;

/**
 * Widget compartido de captura de firma (Draw / Type / Upload), puerto
 * visual/estructural de los `text-signature-creator` + canvas draw-pad del
 * CRM original, sin la librería `signature_pad` (dibujo nativo con Pointer
 * Events) ni fuentes cargadas por CDN (solo stacks cursive/serif del
 * sistema). Es puramente presentacional: no emite nada por su cuenta, el
 * padre lee la firma resultante bajo demanda vía `getDataUrl()`.
 *
 * Pensado para el teléfono:
 *   - Los trazos se guardan (no solo se pintan): al rotar o abrir la pantalla
 *     completa el canvas cambia de tamaño y la firma se redibuja sin perderse.
 *   - `setPointerCapture`: el trazo no se corta si el dedo sale del canvas, y
 *     `pointercancel` lo cierra limpio. `getCoalescedEvents` suaviza los trazos rápidos.
 *   - "Expand" abre el área de dibujo a pantalla completa (position: fixed; ningún
 *     ancestro debe conservar un `transform`, o el fixed quedaría relativo a él).
 *
 * Estilo: color de tinta y grosor para el dibujo, y fuentes para la firma tecleada.
 */
@Component({
  selector: 'app-signature-pad',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-pad.component.html',
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly fontOptions = FONT_OPTIONS;
  readonly inkOptions = INK_OPTIONS;
  readonly strokeOptions = STROKE_OPTIONS;

  readonly method = signal<SignatureMethod>('draw');
  readonly hasDrawing = signal(false);
  readonly typedText = signal('');
  readonly selectedFontId = signal(FONT_OPTIONS[0].id);
  readonly inkId = signal(INK_OPTIONS[0].id);
  readonly strokeId = signal(STROKE_OPTIONS[1].id);
  readonly uploadedDataUrl = signal<string | null>(null);
  readonly uploadError = signal('');

  /** Área de dibujo a pantalla completa (teléfono). */
  readonly expanded = signal(false);
  readonly isPortrait = signal(false);

  readonly inkColor = computed(() => INK_OPTIONS.find(o => o.id === this.inkId())?.color ?? INK_OPTIONS[0].color);
  private readonly strokeWidth = computed(
    () => STROKE_OPTIONS.find(o => o.id === this.strokeId())?.width ?? STROKE_OPTIONS[1].width,
  );
  readonly selectedFont = computed(() => FONT_OPTIONS.find(o => o.id === this.selectedFontId()) ?? FONT_OPTIONS[0]);

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private orientationQuery: MediaQueryList | null = null;
  private readonly onOrientationChange = (event: MediaQueryListEvent): void => this.isPortrait.set(event.matches);

  /** Trazos en coordenadas del modelo (px CSS del espacio en que se dibujaron). */
  private strokes: PadStroke[] = [];
  private current: PadStroke | null = null;
  private activePointerId: number | null = null;
  private transform: PadTransform = IDENTITY_TRANSFORM;
  private cssWidth = 0;
  private cssHeight = 0;

  readonly canSave = computed(() => {
    switch (this.method()) {
      case 'draw':
        return this.hasDrawing();
      case 'type':
        return this.typedText().trim().length > 0;
      case 'upload':
        return this.uploadedDataUrl() !== null;
    }
  });

  ngAfterViewInit(): void {
    // El canvas puede nacer oculto o dentro de un modal recién insertado (0×0). El
    // observer queda vivo: inicializa en cuanto hay tamaño real y vuelve a ajustar el
    // buffer cada vez que cambia (rotación, pantalla completa, ancho de la tarjeta).
    const canvas = this.canvasRef.nativeElement;
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && (width !== this.cssWidth || height !== this.cssHeight)) {
          this.resize(width, height);
        }
      }
    });
    this.resizeObserver.observe(canvas);

    if (typeof window.matchMedia === 'function') {
      this.orientationQuery = window.matchMedia('(orientation: portrait)');
      this.isPortrait.set(this.orientationQuery.matches);
      this.orientationQuery.addEventListener?.('change', this.onOrientationChange);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.orientationQuery?.removeEventListener?.('change', this.onOrientationChange);
    this.lockPageScroll(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.expanded()) {
      this.collapse();
    }
  }

  private resize(width: number, height: number): void {
    const canvas = this.canvasRef.nativeElement;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    this.cssWidth = width;
    this.cssHeight = height;
    this.ctx = canvas.getContext('2d');
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.transform = fitTransform(strokesBounds(this.strokes), width, height);
    this.redraw();
  }

  setMethod(method: SignatureMethod): void {
    this.method.set(method);
  }

  selectedFontFamily(): string {
    return this.selectedFont().fontFamily;
  }

  selectFont(id: string): void {
    this.selectedFontId.set(id);
  }

  setInk(id: string): void {
    this.inkId.set(id);
    this.redraw();
  }

  setStroke(id: string): void {
    this.strokeId.set(id);
    this.redraw();
  }

  // ---------- Pantalla completa ----------

  expand(): void {
    this.expanded.set(true);
    this.lockPageScroll(true);
  }

  collapse(): void {
    this.expanded.set(false);
    this.lockPageScroll(false);
  }

  private lockPageScroll(lock: boolean): void {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = lock ? 'hidden' : '';
    }
  }

  // ---------- Dibujo ----------

  onPointerDown(event: PointerEvent): void {
    // Un solo dedo a la vez; el botón derecho del mouse no dibuja.
    if (this.activePointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    try {
      this.canvasRef.nativeElement.setPointerCapture(event.pointerId);
    } catch {
      // jsdom / navegadores viejos: sin captura el trazo igual funciona dentro del canvas.
    }
    this.activePointerId = event.pointerId;
    this.current = [toModel(this.pointFromEvent(event), this.transform)];
    this.strokes.push(this.current);
    this.drawDot(this.current[0]);
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId || !this.current || !this.ctx) {
      return;
    }
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const e of events.length > 0 ? events : [event]) {
      const point = toModel(this.pointFromEvent(e), this.transform);
      const previous = this.current[this.current.length - 1];
      this.current.push(point);
      this.drawSegment(previous, point);
    }
    this.hasDrawing.set(true);
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.activePointerId = null;
    this.current = null;
  }

  undo(): void {
    this.strokes.pop();
    this.hasDrawing.set(this.strokes.some(stroke => stroke.length > 1));
    this.redraw();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
      this.uploadError.set('Please choose a PNG or JPEG image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.uploadError.set('That image is larger than 4 MB. Please choose a smaller one.');
      return;
    }
    this.uploadError.set('');
    const reader = new FileReader();
    reader.onload = () => {
      // Aplana sobre blanco (quita alfa) para que un PNG transparente subido no salga con
      // recuadro negro al sellar, y reduce las fotos grandes para no pasar el tope del backend.
      const img = new Image();
      img.onload = () => this.uploadedDataUrl.set(this.flattenToWhite(img, MAX_UPLOAD_SIDE));
      img.onerror = () => this.uploadError.set('That image could not be read. Please try another file.');
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  clearCurrent(): void {
    switch (this.method()) {
      case 'draw':
        this.clearCanvas();
        break;
      case 'type':
        this.typedText.set('');
        break;
      case 'upload':
        this.uploadedDataUrl.set(null);
        this.uploadError.set('');
        break;
    }
  }

  /** Lee la firma actual bajo demanda; null si el método activo no tiene contenido guardable. */
  getDataUrl(): string | null {
    switch (this.method()) {
      case 'draw':
        return this.hasDrawing() ? this.exportDrawing() : null;
      case 'upload':
        return this.uploadedDataUrl();
      case 'type':
        return this.typedText().trim() ? this.renderTypedSignature() : null;
    }
  }

  private applyInk(ctx: CanvasRenderingContext2D, width: number): void {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.inkColor();
    ctx.fillStyle = this.inkColor();
  }

  private toScreen(point: PadPoint): PadPoint {
    const t = this.transform;
    return { x: point.x * t.scale + t.offsetX, y: point.y * t.scale + t.offsetY };
  }

  private drawSegment(from: PadPoint, to: PadPoint): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    this.applyInk(ctx, this.strokeWidth() * this.transform.scale);
    const a = this.toScreen(from);
    const b = this.toScreen(to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  private drawDot(point: PadPoint): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    this.applyInk(ctx, this.strokeWidth() * this.transform.scale);
    const p = this.toScreen(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (this.strokeWidth() * this.transform.scale) / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private redraw(): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    for (const stroke of this.strokes) {
      if (stroke.length === 1) {
        this.drawDot(stroke[0]);
      }
      for (let i = 1; i < stroke.length; i++) {
        this.drawSegment(stroke[i - 1], stroke[i]);
      }
    }
  }

  /**
   * Exporta los trazos del modelo (no el canvas visible): así no se recorta nada que
   * se haya dibujado en pantalla completa y ya no quepa en el canvas en línea. Sale
   * ajustado a la firma, a 2× y sobre fondo BLANCO opaco (ver `flattenToWhite`).
   */
  private exportDrawing(): string | null {
    const bounds = strokesBounds(this.strokes);
    if (!bounds) {
      return null;
    }
    const pad = EXPORT_PADDING + this.strokeWidth();
    const width = Math.ceil((bounds.maxX - bounds.minX + pad * 2) * EXPORT_SCALE);
    const height = Math.ceil((bounds.maxY - bounds.minY + pad * 2) * EXPORT_SCALE);
    const out = document.createElement('canvas');
    out.width = Math.max(width, 1);
    out.height = Math.max(height, 1);
    const ctx = out.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, (pad - bounds.minX) * EXPORT_SCALE, (pad - bounds.minY) * EXPORT_SCALE);
    this.applyInk(ctx, this.strokeWidth());
    for (const stroke of this.strokes) {
      ctx.beginPath();
      if (stroke.length === 1) {
        ctx.arc(stroke[0].x, stroke[0].y, this.strokeWidth() / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      ctx.stroke();
    }
    return out.toDataURL('image/png');
  }

  /**
   * Compone `source` sobre un fondo BLANCO opaco y devuelve un PNG sin canal alfa.
   * El motor de sellado (PdfSharp 6.x) pinta los píxeles transparentes de un PNG como
   * NEGRO opaco, así que un trazo sobre canvas transparente salía rodeado de un recuadro
   * negro en el PDF. El box del sello ya es blanco, por lo que el fondo blanco encaja sin
   * costura y elimina el artefacto para dibujo, texto e imagen subida por igual.
   */
  private flattenToWhite(source: HTMLImageElement, maxSide: number): string {
    const { width, height } = scaleToMax(source.naturalWidth, source.naturalHeight, maxSide);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return out.toDataURL('image/png');
  }

  private pointFromEvent(event: PointerEvent): PadPoint {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private clearCanvas(): void {
    this.strokes = [];
    this.current = null;
    this.activePointerId = null;
    this.transform = IDENTITY_TRANSFORM;
    this.hasDrawing.set(false);
    this.redraw();
  }

  /** Nombre tecleado en la fuente elegida; la fuente se achica hasta que el nombre quepa entero. */
  private renderTypedSignature(): string {
    const canvas = document.createElement('canvas');
    canvas.width = TYPED_WIDTH;
    canvas.height = TYPED_HEIGHT;
    const ctx = canvas.getContext('2d')!;
    // Fondo blanco opaco: mismo motivo que flattenToWhite — PdfSharp pinta el alfa como negro.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const text = this.typedText().trim();
    const font = this.selectedFont();
    const fontAt = (size: number): string => `${font.fontStyle} ${font.fontWeight} ${size}px ${font.fontFamily}`;
    const size = fitFontSize(
      s => {
        ctx.font = fontAt(s);
        return ctx.measureText(text).width;
      },
      TYPED_WIDTH - TYPED_PADDING * 2,
      TYPED_FONT_START,
      TYPED_FONT_MIN,
    );
    ctx.font = fontAt(size);
    ctx.fillStyle = this.inkColor();
    ctx.textBaseline = 'middle';
    ctx.fillText(text, TYPED_PADDING, canvas.height / 2, TYPED_WIDTH - TYPED_PADDING * 2);
    return canvas.toDataURL('image/png');
  }
}
