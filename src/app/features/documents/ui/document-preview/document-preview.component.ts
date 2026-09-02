import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { FileResponse, displayStatus, formatBytes, isFileReady } from '../../data-access/documents.model';

/**
 * Vista rápida de un archivo. La URL de descarga se presigna como "attachment"
 * (no inline), así que no renderizamos el contenido: mostramos la metadata y el
 * estado, con un CTA de descarga cuando está listo. Honesto con lo que el
 * backend permite hoy (nada de previsualización falsa).
 */
@Component({
  selector: 'app-document-preview',
  imports: [ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (file) {
      <app-modal [isOpen]="true" [heading]="file.originalName" [subheading]="subheading()" size="xl" (closed)="closed.emit()">
        <div class="mt-5 grid min-h-56 place-items-center rounded-2xl bg-gray-50 p-8 text-center">
          @if (status() === 'blocked') {
            <div class="flex flex-col items-center gap-2 text-gray-500">
              <span class="grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-500">
                <ion-icon name="shield-outline" class="text-2xl"></ion-icon>
              </span>
              <p class="text-sm font-semibold text-gray-800">This file was blocked</p>
              <p class="max-w-sm text-xs">It may be unsafe, so it can't be opened or downloaded.</p>
            </div>
          } @else if (status() === 'ready') {
            <div class="flex flex-col items-center gap-2 text-gray-500">
              <span class="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
                <ion-icon name="document-text-outline" class="text-2xl"></ion-icon>
              </span>
              <p class="text-sm font-semibold text-gray-800">Ready to download</p>
              <p class="max-w-sm text-xs">Download this file to view it.</p>
            </div>
          } @else {
            <div class="flex flex-col items-center gap-2 text-gray-500">
              <span class="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
                <ion-icon name="hourglass-outline" class="text-2xl"></ion-icon>
              </span>
              <p class="text-sm font-semibold text-gray-800">Still processing</p>
              <p class="max-w-sm text-xs">We're checking this file. It will be ready in a moment.</p>
            </div>
          }
        </div>

        <div class="mt-6 flex items-center justify-end gap-2">
          <button type="button" (click)="closed.emit()"
            class="rounded-full px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
            Close
          </button>
          @if (ready()) {
            <button type="button" (click)="download.emit(file)"
              class="flex items-center gap-2 rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink">
              <ion-icon name="download-outline"></ion-icon>
              Download
            </button>
          }
        </div>
      </app-modal>
    }
  `,
})
export class DocumentPreviewComponent {
  @Input() file: FileResponse | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() download = new EventEmitter<FileResponse>();

  status(): string {
    return this.file ? displayStatus(this.file.status) : 'processing';
  }

  ready(): boolean {
    return !!this.file && isFileReady(this.file.status);
  }

  subheading(): string {
    if (!this.file) {
      return '';
    }
    const ext = this.file.originalName.split('.').pop()?.toUpperCase() ?? 'FILE';
    const year = this.file.taxYear ? ` · Tax year ${this.file.taxYear}` : '';
    return `${ext} · ${formatBytes(this.file.sizeBytes)}${year}`;
  }
}
