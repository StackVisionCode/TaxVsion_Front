import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type SignatureMethod = 'draw' | 'type' | 'upload';

interface SignatureFontOption {
  id: string;
  label: string;
  fontFamily: string;
}

/** System-safe cursive/handwriting stacks only — no external font loading (proyecto sin dependencias CDN). */
const FONT_OPTIONS: SignatureFontOption[] = [
  { id: 'flowing', label: 'Flowing', fontFamily: "'Brush Script MT', 'Segoe Script', cursive" },
  { id: 'handwritten', label: 'Handwritten', fontFamily: "'Lucida Handwriting', 'Apple Chancery', 'Comic Sans MS', cursive" },
  { id: 'formal', label: 'Formal', fontFamily: "Georgia, 'Times New Roman', serif" },
];

/**
 * Widget compartido de captura de firma (Draw / Type / Upload), puerto
 * visual/estructural de los `text-signature-creator` + canvas draw-pad del
 * CRM original, sin la librería `signature_pad` (dibujo nativo con Pointer
 * Events) ni fuentes cargadas por CDN (solo stacks cursive/serif del
 * sistema). Es puramente presentacional: no emite nada por su cuenta, el
 * padre lee la firma resultante bajo demanda vía `getDataUrl()` (con
 * `#pad` como referencia de plantilla) al hacer click en su propio botón
 * "Save", igual que cualquier `<ng-content>` proyectado dentro de
 * `app-modal`. Se resetea solo porque el padre lo monta con `*ngIf` dentro
 * del modal (se destruye y recrea en cada apertura).
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

  readonly method = signal<SignatureMethod>('draw');
  readonly hasDrawing = signal(false);
  readonly typedText = signal('');
  readonly selectedFontId = signal(FONT_OPTIONS[0].id);
  readonly uploadedDataUrl = signal<string | null>(null);
  readonly uploadError = signal('');

  private ctx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private lastPoint: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;

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
    // El canvas vive dentro de un app-modal recién insertado: en el primer
    // ngAfterViewInit su layout puede seguir en 0x0 (getBoundingClientRect
    // sin asentar todavía), lo que dejaría el buffer de dibujo con área cero
    // y cualquier trazo sería invisible. ResizeObserver dispara en cuanto el
    // canvas obtiene su tamaño real, sin depender de timing del modal.
    const canvas = this.canvasRef.nativeElement;
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !this.ctx) {
          this.initCanvas(width, height);
          this.resizeObserver?.disconnect();
        }
      }
    });
    this.resizeObserver.observe(canvas);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private initCanvas(width: number, height: number): void {
    const canvas = this.canvasRef.nativeElement;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    }
    this.ctx = ctx;
  }

  setMethod(method: SignatureMethod): void {
    this.method.set(method);
  }

  selectedFontFamily(): string {
    return this.fontOptions.find(option => option.id === this.selectedFontId())?.fontFamily ?? 'cursive';
  }

  selectFont(id: string): void {
    this.selectedFontId.set(id);
  }

  onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.isDrawing = true;
    this.lastPoint = this.pointFromEvent(event);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.isDrawing || !this.ctx || !this.lastPoint) {
      return;
    }
    event.preventDefault();
    const point = this.pointFromEvent(event);
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
    this.ctx.lineTo(point.x, point.y);
    this.ctx.stroke();
    this.lastPoint = point;
    this.hasDrawing.set(true);
  }

  onPointerUp(): void {
    this.isDrawing = false;
    this.lastPoint = null;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.uploadError.set('Please choose an image file.');
      return;
    }
    this.uploadError.set('');
    const reader = new FileReader();
    reader.onload = () => this.uploadedDataUrl.set(reader.result as string);
    reader.readAsDataURL(file);
    input.value = '';
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
        return this.hasDrawing() ? this.canvasRef.nativeElement.toDataURL('image/png') : null;
      case 'upload':
        return this.uploadedDataUrl();
      case 'type':
        return this.typedText().trim() ? this.renderTypedSignature() : null;
    }
  }

  private pointFromEvent(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private clearCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.hasDrawing.set(false);
  }

  private renderTypedSignature(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `italic 52px ${this.selectedFontFamily()}`;
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.typedText().trim(), 16, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }
}
