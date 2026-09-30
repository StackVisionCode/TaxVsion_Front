import { Directive, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';

/**
 * ¿El archivo cumple el `accept` (mismo formato que el atributo HTML: '.csv,.xlsx,image/*,application/pdf')?
 * Vacío = acepta todo. Compara extensión (sin mayúsculas), MIME exacto o comodín `tipo/*`.
 */
export function fileMatchesAccept(file: File, accept: string | null | undefined): boolean {
  const rules = String(accept ?? '')
    .split(',')
    .map(rule => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) {
    return true;
  }
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return rules.some(rule => {
    if (rule.startsWith('.')) {
      return name.endsWith(rule);
    }
    if (rule.endsWith('/*')) {
      return type.startsWith(rule.slice(0, -1));
    }
    return type === rule;
  });
}

/**
 * `[appFileDrop]`: convierte cualquier elemento en zona de soltar archivos.
 *
 * Uso: `<div (appFileDrop)="add($event)" accept=".csv,.xlsx" [multiple]="false" #drop="appFileDrop"
 *        [class.border-brand-bold]="drop.dragging()">`
 *
 * - `(appFileDrop)` emite `File[]` con los archivos aceptados (con `multiple=false`, solo el primero).
 * - `(appFileDropRejected)` emite los que no cumplen `accept`.
 * - `dragging` (signal) vía `exportAs: 'appFileDrop'`, y la clase de host `is-dragging` mientras se
 *   arrastra encima. `fileDropDisabled` lo desactiva.
 * - `dragleave` solo apaga el estado al salir DEL HOST (no al pasar sobre un hijo), a diferencia de las
 *   copias de upload-dialog/client-import que parpadeaban.
 */
@Directive({
  selector: '[appFileDrop]',
  exportAs: 'appFileDrop',
  host: { '[class.is-dragging]': 'dragging()' },
})
export class FileDropDirective {
  @Input() accept = '';
  @Input() multiple = true;
  @Input() fileDropDisabled = false;
  @Output() readonly appFileDrop = new EventEmitter<File[]>();
  @Output() readonly appFileDropRejected = new EventEmitter<File[]>();

  readonly dragging = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  @HostListener('dragenter', ['$event'])
  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (this.fileDropDisabled) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.dragging.set(true);
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    if (related && this.host.contains(related)) {
      return;
    }
    this.dragging.set(false);
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.fileDropDisabled) {
      return;
    }
    this.handle(Array.from(event.dataTransfer?.files ?? []));
  }

  /** Procesa archivos venidos de otra fuente (p. ej. el `<input type=file>` de la dropzone). */
  handle(files: File[]): void {
    if (files.length === 0) {
      return;
    }
    const accepted = files.filter(file => fileMatchesAccept(file, this.accept));
    const rejected = files.filter(file => !accepted.includes(file));
    const picked = this.multiple ? accepted : accepted.slice(0, 1);
    if (rejected.length > 0) {
      this.appFileDropRejected.emit(rejected);
    }
    if (picked.length > 0) {
      this.appFileDrop.emit(picked);
    }
  }
}
