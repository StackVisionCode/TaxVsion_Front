import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropzoneComponent } from '@shared/ui/dropzone/dropzone.component';
import { FileDropDirective } from '@shared/directives/file-drop.directive';
import { formatBytes } from '@shared/utils/format.util';
import { CustomerImportAttempt, DuplicateStrategy } from '../../data-access/client-imports.model';

/** Payload del POST multipart, con la clave de idempotencia que sobrevive a los reintentos. */
export interface ImportStartRequest {
  file: File;
  strategy: DuplicateStrategy;
  idempotencyKey: string;
}

interface StrategyOption {
  value: DuplicateStrategy;
  label: string;
  description: string;
}

/** El controller rechaza cualquier otra extensión con 400 `Import.Format`. */
const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];

/**
 * Paso 1 del wizard: elegir el archivo y la política de duplicados.
 *
 * Sólo hay dos datos que el contrato acepta (`file` + `Strategy`), así que no hay mapeo de
 * columnas ni previsualización: la plantilla de `GET /template` ES el mapeo, con los
 * encabezados exactos que espera el parser del backend.
 */
@Component({
  selector: 'app-client-import-upload-step',
  imports: [CommonModule, DropzoneComponent, FileDropDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-import-upload-step.component.html',
  styleUrl: './client-import-upload-step.component.css',
})
export class ClientImportUploadStepComponent {
  @Input() busy = false;
  @Input() errorMessage: string | null = null;
  @Input() templateBusy = false;
  @Input() templateError: string | null = null;
  /** Importación viva detectada en el historial: el backend sólo admite una por tenant. */
  @Input() runningAttempt: CustomerImportAttempt | null = null;

  @Output() startRequested = new EventEmitter<ImportStartRequest>();
  @Output() templateRequested = new EventEmitter<void>();
  @Output() trackRunningRequested = new EventEmitter<CustomerImportAttempt>();

  readonly file = signal<File | null>(null);
  readonly strategy = signal<DuplicateStrategy>('Skip');
  readonly localError = signal<string | null>(null);

  readonly acceptAttribute = ACCEPTED_EXTENSIONS.join(',');

  /** Textos tomados de los doc-comments de DuplicateStrategy en el backend. */
  readonly strategies: StrategyOption[] = [
    {
      value: 'Skip',
      label: 'Skip',
      description: 'Keep the existing client untouched and report the row as skipped.',
    },
    {
      value: 'Merge',
      label: 'Merge',
      description: 'Fill in empty fields on the existing client. Never overwrites a value that is already there.',
    },
    {
      value: 'Overwrite',
      label: 'Overwrite',
      description: 'Replace the existing client entirely with the data from the file.',
    },
  ];

  /**
   * Se genera una clave por archivo elegido. Reintentar tras un fallo de red reusa la misma
   * y el backend devuelve el intento ya creado (replay) en vez de importar dos veces; en
   * cambio, elegir otro archivo debe ser una importación nueva, así que ahí se regenera.
   */
  private idempotencyKey = newIdempotencyKey();

  /** Extensión fuera de `.csv/.xlsx` (la filtra la dropzone/`appFileDrop` con `accept`). */
  onRejected(): void {
    this.file.set(null);
    this.localError.set('Only .csv and .xlsx files are supported.');
  }

  clearFile(): void {
    this.file.set(null);
    this.localError.set(null);
    this.idempotencyKey = newIdempotencyKey();
  }

  selectStrategy(value: DuplicateStrategy): void {
    this.strategy.set(value);
  }

  submit(): void {
    const file = this.file();
    if (!file || this.busy) {
      return;
    }
    this.startRequested.emit({ file, strategy: this.strategy(), idempotencyKey: this.idempotencyKey });
  }

  /** Tamaño legible del archivo local. El límite real lo fija el backend (CustomerImportOptions,
   *  configurable por despliegue), así que no se muestra ningún máximo inventado: si se pasa,
   *  el 400 `Import.FileTooLarge` trae el valor exacto y se pinta como error. */
  fileSizeLabel(file: File): string {
    return formatBytes(file.size);
  }

  acceptFile(file: File | undefined): void {
    if (!file) {
      return;
    }
    if (file.size === 0) {
      this.file.set(null);
      this.localError.set('The selected file is empty.');
      return;
    }
    this.localError.set(null);
    this.file.set(file);
    this.idempotencyKey = newIdempotencyKey();
  }
}

/** UUID v4 para el header `Idempotency-Key`, con salida alternativa fuera de contexto seguro (http en dev). */
function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const random = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${random()}-${random()}`;
}
