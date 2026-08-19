import {
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
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

export type SignatureMode = 'draw' | 'type' | 'upload';
export type SignatureFormat = 'PNG' | 'JPEG';

/** Firma generada. Incluye el data URL (listo para `<img>`/preview) y el base64 sin prefijo (lo que espera el backend). */
export interface CreatedSignature {
  displayName: string;
  dataUrl: string;
  imageBase64: string;
  format: SignatureFormat;
  width: number;
  height: number;
}

interface FontPreset {
  name: string;
  fontFamily: string;
  fontStyle: string;
  fontWeight: string;
}

/** Presets con stacks de fuentes del sistema — sin cargar fuentes por CDN (regla del proyecto). */
const FONT_PRESETS: FontPreset[] = [
  { name: 'Classic', fontFamily: "'Times New Roman', serif", fontStyle: 'italic', fontWeight: 'normal' },
  { name: 'Elegant', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 'bold' },
  { name: 'Modern', fontFamily: 'Helvetica, Arial, sans-serif', fontStyle: 'normal', fontWeight: 'normal' },
  { name: 'Script', fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontStyle: 'normal', fontWeight: 'normal' },
  { name: 'Formal', fontFamily: "'Palatino Linotype', Palatino, serif", fontStyle: 'italic', fontWeight: 'normal' },
];

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Generador de firmas (Draw / Type / Upload), adaptado del `SignatureCreatorComponent`
 * del CRM legado (CRMTAXPROFRONTEND) a Angular 21 + signals + Tailwind. Dibujo nativo
 * con Canvas 2D (sin la librería `signature_pad`), recorte de márgenes transparentes
 * (`trimCanvas`) para que la firma no quede diminuta, presets de fuente + color + tamaño
 * en modo Type, y validación de subida. Se monta como modal reutilizando `app-modal`
 * (mismo patrón que `signature-request-panel`) y emite `created` con la firma resultante.
 */
@Component({
  selector: 'app-signature-creator',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-creator.component.html',
})
export class SignatureCreatorComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  /** Prellenar el nombre de la firma (opcional). */
  @Input() initialText = '';
  @Output() created = new EventEmitter<CreatedSignature>();
  @Output() closed = new EventEmitter<void>();

  readonly fontPresets = FONT_PRESETS;

  readonly mode = signal<SignatureMode>('draw');
  readonly signatureName = signal('My Signature');

  // Draw
  readonly hasDrawing = signal(false);
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private drawing = false;
  private lastPoint: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Type
  readonly typedText = signal('');
  readonly selectedFont = signal<FontPreset>(FONT_PRESETS[0]);
  readonly fontColor = signal('#111827');
  readonly fontSize = signal(40);

  // Upload
  readonly uploadedDataUrl = signal<string | null>(null);
  readonly uploadedFileName = signal<string | null>(null);
  readonly uploadError = signal('');

  readonly canSave = computed(() => {
    switch (this.mode()) {
      case 'draw':
        return this.hasDrawing();
      case 'type':
        return this.typedText().trim().length > 0;
      case 'upload':
        return this.uploadedDataUrl() !== null;
    }
  });

  /**
   * El canvas solo existe en modo 'draw'. El setter (re)inicia su contexto cada vez que
   * el elemento aparece (cambio de modo / apertura del modal) y lo limpia cuando desaparece,
   * apoyándose en un ResizeObserver que espera a que el canvas tenga tamaño real.
   */
  @ViewChild('drawCanvas')
  set drawCanvas(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.ctx = null;
    this.canvasEl = ref?.nativeElement ?? null;
    if (!this.canvasEl) {
      return;
    }
    const canvas = this.canvasEl;
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !this.ctx) {
          this.initCanvas(canvas, width, height);
        }
      }
    });
    this.resizeObserver.observe(canvas);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.reset();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  setMode(mode: SignatureMode): void {
    this.mode.set(mode);
  }

  selectFont(preset: FontPreset): void {
    this.selectedFont.set(preset);
  }

  getTypedSignatureStyle(): Record<string, string> {
    const font = this.selectedFont();
    return {
      'font-family': font.fontFamily,
      'font-style': font.fontStyle,
      'font-weight': font.fontWeight,
      'font-size': `${this.fontSize()}px`,
      color: this.fontColor(),
    };
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.ctx) {
      return;
    }
    event.preventDefault();
    this.drawing = true;
    this.lastPoint = this.pointFrom(event);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drawing || !this.ctx || !this.lastPoint) {
      return;
    }
    event.preventDefault();
    const point = this.pointFrom(event);
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
    this.ctx.lineTo(point.x, point.y);
    this.ctx.stroke();
    this.lastPoint = point;
    this.hasDrawing.set(true);
  }

  onPointerUp(): void {
    this.drawing = false;
    this.lastPoint = null;
  }

  onFileUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.uploadError.set('La imagen debe pesar menos de 4MB.');
      return;
    }
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      this.uploadError.set('Solo se permiten archivos PNG o JPEG.');
      return;
    }
    this.uploadError.set('');
    this.uploadedFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => this.uploadedDataUrl.set(reader.result as string);
    reader.readAsDataURL(file);
    input.value = '';
  }

  removeUpload(): void {
    this.uploadedDataUrl.set(null);
    this.uploadedFileName.set(null);
    this.uploadError.set('');
  }

  clearCurrent(): void {
    switch (this.mode()) {
      case 'draw':
        this.clearCanvas();
        break;
      case 'type':
        this.typedText.set('');
        break;
      case 'upload':
        this.removeUpload();
        break;
    }
  }

  confirm(): void {
    if (!this.canSave()) {
      return;
    }
    switch (this.mode()) {
      case 'draw':
        this.confirmDraw();
        break;
      case 'type':
        this.confirmType();
        break;
      case 'upload':
        this.confirmUpload();
        break;
    }
  }

  cancel(): void {
    this.closed.emit();
  }

  private initCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    }
    this.ctx = ctx;
    this.hasDrawing.set(false);
  }

  private clearCanvas(): void {
    if (!this.ctx || !this.canvasEl) {
      return;
    }
    this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    this.hasDrawing.set(false);
  }

  private pointFrom(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvasEl!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private confirmDraw(): void {
    if (!this.canvasEl) {
      return;
    }
    const trimmed = this.trimCanvas(this.canvasEl);
    this.emit(trimmed.toDataURL('image/png'), 'PNG', trimmed.width, trimmed.height);
  }

  private confirmType(): void {
    const text = this.typedText().trim();
    if (!text) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(400 * ratio);
    canvas.height = Math.floor(150 * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.scale(ratio, ratio);
    const font = this.selectedFont();
    ctx.font = `${font.fontStyle} ${font.fontWeight} ${this.fontSize()}px ${font.fontFamily}`;
    ctx.fillStyle = this.fontColor();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 200, 75);
    const trimmed = this.trimCanvas(canvas);
    this.emit(trimmed.toDataURL('image/png'), 'PNG', trimmed.width, trimmed.height);
  }

  private confirmUpload(): void {
    const dataUrl = this.uploadedDataUrl();
    if (!dataUrl) {
      return;
    }
    const img = new Image();
    img.onload = () => {
      const format: SignatureFormat = dataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG';
      this.emit(dataUrl, format, img.naturalWidth || 400, img.naturalHeight || 150);
    };
    img.src = dataUrl;
  }

  private emit(dataUrl: string, format: SignatureFormat, width: number, height: number): void {
    this.created.emit({
      displayName: this.signatureName().trim() || 'My Signature',
      dataUrl,
      imageBase64: dataUrl.split(',')[1] ?? '',
      format,
      width,
      height,
    });
  }

  /** Recorta el canvas al recuadro de píxeles no transparentes (+10px de padding). */
  private trimCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return canvas;
    }
    const w = canvas.width;
    const h = canvas.height;
    const pixels = ctx.getImageData(0, 0, w, h).data;

    let top = h;
    let left = w;
    let right = 0;
    let bottom = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[(y * w + x) * 4 + 3] > 0) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }

    if (top >= bottom || left >= right) {
      return canvas;
    }

    const padding = 10;
    top = Math.max(0, top - padding);
    left = Math.max(0, left - padding);
    bottom = Math.min(h - 1, bottom + padding);
    right = Math.min(w - 1, right + padding);

    const trimmedW = right - left + 1;
    const trimmedH = bottom - top + 1;
    const out = document.createElement('canvas');
    out.width = trimmedW;
    out.height = trimmedH;
    out.getContext('2d')?.drawImage(canvas, left, top, trimmedW, trimmedH, 0, 0, trimmedW, trimmedH);
    return out;
  }

  private reset(): void {
    this.mode.set('draw');
    this.signatureName.set(this.initialText.trim() || 'My Signature');
    this.hasDrawing.set(false);
    this.typedText.set('');
    this.selectedFont.set(FONT_PRESETS[0]);
    this.fontColor.set('#111827');
    this.fontSize.set(40);
    this.uploadedDataUrl.set(null);
    this.uploadedFileName.set(null);
    this.uploadError.set('');
    this.clearCanvas();
  }
}
