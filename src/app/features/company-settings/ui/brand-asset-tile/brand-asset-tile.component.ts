import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { FileDropDirective } from '@shared/directives/file-drop.directive';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';

/**
 * Recuadro de un asset de marca (logo o favicon): vista previa, estado de escaneo, subir/reemplazar
 * (botón o arrastrando) y quitar. El logo se ve sobre un tablero (para notar la transparencia); el
 * favicon, dentro de una pestaña de navegador de muestra con el nombre de la oficina.
 */
@Component({
  selector: 'app-brand-asset-tile',
  imports: [NgClass, FileDropDirective, InfinityLoaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    <div appFileDrop #drop="appFileDrop" [accept]="accept" [multiple]="false" [fileDropDisabled]="!canManage || busy"
      (appFileDrop)="onFiles($event)" (appFileDropRejected)="rejected.emit()"
      class="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-5 text-center transition-colors"
      [ngClass]="drop.dragging() ? 'border-brand-bold bg-brand-surface' : 'border-brand-border bg-white'">
      @if (kind === 'logo') {
        <div class="bat-checker grid h-28 w-full place-items-center rounded-xl">
          @if (url) {
            <img [src]="url" alt="Office logo" class="bat-img max-h-20 max-w-[85%] object-contain" />
          } @else if (processing) {
            <span class="flex flex-col items-center gap-2 text-xs text-gray-500"><app-infinity-loader size="sm" />Scanning your file…</span>
          } @else {
            <span class="flex flex-col items-center gap-1 text-xs text-gray-400"><ion-icon name="image-outline" class="text-3xl"></ion-icon>No logo yet</span>
          }
        </div>
      } @else {
        <div class="grid h-28 w-full place-items-center rounded-xl bg-gray-50">
          <div class="bat-tab flex w-[13rem] max-w-full items-center gap-2 rounded-t-xl border border-b-0 border-gray-200 bg-white px-3 py-2 shadow-sm">
            @if (url) {
              <img [src]="url" alt="Favicon" class="bat-img h-4 w-4 shrink-0 object-contain" />
            } @else if (processing) {
              <app-infinity-loader size="xs" />
            } @else {
              <ion-icon name="globe-outline" class="shrink-0 text-base text-gray-300"></ion-icon>
            }
            <span class="truncate text-xs text-gray-700">{{ tabTitle }}</span>
            <ion-icon name="close-outline" class="ml-auto shrink-0 text-sm text-gray-300"></ion-icon>
          </div>
        </div>
      }
      <div>
        <p class="text-sm font-semibold text-gray-900">{{ title }}</p>
        <p class="mt-0.5 text-xs text-gray-500">{{ hint }}</p>
      </div>
      @if (canManage) {
        <div class="flex flex-wrap justify-center gap-2">
          <button type="button" (click)="input.click()" [disabled]="busy" class="pf-btn pf-btn--primary pf-btn--sm">
            <ion-icon name="cloud-upload-outline"></ion-icon>
            {{ uploading ? 'Uploading…' : url ? 'Replace' : 'Upload ' + kind }}
          </button>
          @if (url) {
            <button type="button" (click)="remove.emit()" [disabled]="busy" class="pf-btn pf-btn--ghost pf-btn--sm pf-btn--danger">Remove</button>
          }
        </div>
        <p class="text-[0.6875rem] text-gray-400">or drop an image here</p>
        <input #input type="file" class="hidden" [attr.accept]="accept" (change)="onInput($event)" />
      }
    </div>
  `,
  styles: `
    .bat-checker {
      background-color: #fafafa;
      background-image: conic-gradient(#f0f0f0 25%, transparent 0 50%, #f0f0f0 0 75%, transparent 0);
      background-size: 16px 16px;
    }
    .bat-img,
    .bat-tab {
      animation: bat-in 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    @keyframes bat-in {
      from {
        opacity: 0;
        transform: scale(0.9);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bat-img,
      .bat-tab {
        animation: none;
      }
    }
  `,
})
export class BrandAssetTileComponent {
  @Input({ required: true }) kind: 'logo' | 'favicon' = 'logo';
  @Input() title = '';
  @Input() hint = '';
  @Input() accept = '';
  /** URL servible del asset (null mientras no hay o sigue en escaneo). */
  @Input() url: string | null = null;
  @Input() processing = false;
  /** Hay una subida/borrado en curso (de cualquiera de los dos assets). */
  @Input() busy = false;
  /** La subida en curso es la de este asset. */
  @Input() uploading = false;
  @Input() canManage = false;
  /** Texto de la pestaña de muestra del favicon. */
  @Input() tabTitle = '';

  @Output() readonly fileSelected = new EventEmitter<File>();
  @Output() readonly rejected = new EventEmitter<void>();
  @Output() readonly remove = new EventEmitter<void>();

  onFiles(files: File[]): void {
    if (files[0]) this.fileSelected.emit(files[0]);
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite reseleccionar el mismo archivo
    if (file) this.fileSelected.emit(file);
  }
}
