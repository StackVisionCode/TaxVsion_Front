import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { NgClass } from '@angular/common';
import { FileDropDirective } from '../../directives/file-drop.directive';
import { formatBytes } from '../../utils/format.util';

export interface DropzoneRejection {
  file: File;
  reason: 'type' | 'size';
  /** Texto listo para mostrar (EN), p. ej. "report.exe isn't an accepted file type". */
  message: string;
}

/**
 * Zona de subida (arrastrar y soltar + "Browse files") con `<input type=file>` oculto.
 *
 * Uso: `<app-dropzone accept=".csv,.xlsx" [multiple]="false" [maxBytes]="10 * 1024 * 1024"
 *   label="Drop your client list here" hint="CSV or XLSX" (files)="onFiles($event)" (rejected)="onRejected($event)" />`
 *
 * - Markup de client-import-upload-step (el más "de marca"): `rounded-[24px] border-2 border-dashed p-8
 *   text-center`, arrastrando `border-brand-bold bg-brand-surface`, en reposo `border-brand-border
 *   bg-white`; círculo con `cloud-upload-outline`; botón píldora brand "Browse files".
 * - `(files)`: File[] aceptados (tipo según `accept`, tamaño ≤ `maxBytes`; con `multiple=false` solo 1).
 * - `(rejected)`: DropzoneRejection[] con motivo ('type' | 'size') y mensaje en inglés.
 * - `disabled` apaga arrastre y botón. Contenido proyectado se pinta debajo (p. ej. el archivo elegido).
 * - Inputs: `accept`, `multiple` (true), `maxBytes` (0 = sin límite), `label` ('Drag files here'),
 *   `hint`, `browseLabel` ('Browse files'), `icon` ('cloud-upload-outline'), `disabled`.
 *
 * Normalizado: upload-dialog usaba `rounded-2xl` + `border-indigo-500 bg-indigo-50` y toda la zona como
 * `<label>`; aquí solo el botón abre el selector (como client-import) para no abrirlo al soltar.
 */
@Component({
  selector: 'app-dropzone',
  imports: [NgClass, FileDropDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    <div appFileDrop #drop="appFileDrop" [accept]="accept" [multiple]="multiple" [fileDropDisabled]="disabled"
      (appFileDrop)="onAccepted($event)" (appFileDropRejected)="onTypeRejected($event)"
      class="rounded-[24px] border-2 border-dashed p-8 text-center transition-colors"
      [ngClass]="drop.dragging() ? 'border-brand-bold bg-brand-surface' : 'border-brand-border bg-white'"
      [class.opacity-60]="disabled">
      <span class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-surface-strong">
        <ion-icon [name]="icon" class="text-2xl text-brand-bold"></ion-icon>
      </span>
      <p class="mt-4 text-sm font-semibold text-gray-900">{{ label }}</p>
      @if (hint) {
        <p class="mt-1 text-sm text-gray-500">{{ hint }}</p>
      }
      <label
        class="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink"
        [ngClass]="disabled ? 'pointer-events-none opacity-60' : 'cursor-pointer'">
        <ion-icon name="folder-open-outline" class="text-base"></ion-icon>
        {{ browseLabel }}
        <input type="file" class="hidden" [attr.accept]="accept || null" [multiple]="multiple" [disabled]="disabled"
          (change)="onInputChange($event)" />
      </label>
      <ng-content></ng-content>
    </div>
  `,
})
export class DropzoneComponent {
  @Input() accept = '';
  @Input() multiple = true;
  /** Tamaño máximo por archivo en bytes; 0 = sin límite. */
  @Input() maxBytes = 0;
  @Input() label = 'Drag files here';
  @Input() hint = '';
  @Input() browseLabel = 'Browse files';
  @Input() icon = 'cloud-upload-outline';
  @Input() disabled = false;
  @Output() readonly files = new EventEmitter<File[]>();
  @Output() readonly rejected = new EventEmitter<DropzoneRejection[]>();

  @ViewChild('drop', { static: true }) private drop!: FileDropDirective;

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const list = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir el mismo archivo
    this.drop.handle(list);
  }

  onTypeRejected(files: File[]): void {
    this.rejected.emit(
      files.map(file => ({ file, reason: 'type' as const, message: `${file.name} isn't an accepted file type` })),
    );
  }

  onAccepted(files: File[]): void {
    const tooBig = this.maxBytes > 0 ? files.filter(file => file.size > this.maxBytes) : [];
    const ok = files.filter(file => !tooBig.includes(file));
    if (tooBig.length > 0) {
      this.rejected.emit(
        tooBig.map(file => ({
          file,
          reason: 'size' as const,
          message: `${file.name} is larger than ${formatBytes(this.maxBytes, { maxUnit: 'GB' })}`,
        })),
      );
    }
    if (ok.length > 0) {
      this.files.emit(ok);
    }
  }
}
