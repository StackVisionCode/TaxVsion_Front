import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY, expand, reduce } from 'rxjs';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { formatBytes } from '@shared/utils/format.util';
import { toApiError } from '@core/models/api-error.model';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { FileResponse } from '@core/cloud-storage/cloud-storage.model';

// Backend acota `take` a 100; paginamos páginas enteras y cortamos cuando una página devuelve
// menos (fin de la lista). El cap es un seguro para no dejar el componente colgado si algo falla.
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** true si el archivo es un PDF (por content-type declarado o por extensión). */
function isPdf(file: FileResponse): boolean {
  return file.declaredContentType === 'application/pdf' || file.originalName.toLowerCase().endsWith('.pdf');
}

/**
 * Selector de un PDF ya existente en la oficina (CloudStorage) para reusarlo en una
 * solicitud de firma o al instanciar una plantilla — sin volver a subirlo. Lista los
 * archivos del tenant (`GET /storage/files`), se queda solo con los PDF `Available`, y
 * opcionalmente filtra por el cliente elegido (`ownerFilterId`). Emite el `FileResponse`;
 * el `id` sirve directo como `originalFileId` (el Create promueve Draft→Ready leyendo la
 * proyección local, porque el archivo ya está disponible).
 */
@Component({
  selector: 'app-signature-document-library',
  imports: [CommonModule, SearchInputComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-document-library.component.html',
  styleUrl: './signature-document-library.component.css',
})
export class SignatureDocumentLibraryComponent implements OnInit {
  private readonly storage = inject(CloudStorageUploadService);

  /** Si viene un customerId, solo se muestran los PDF de ese cliente. */
  @Input() set ownerFilterId(value: string | null | undefined) {
    this.owner.set(value ?? null);
  }
  /** id del archivo ya elegido (para resaltarlo al reabrir). */
  @Input() set selectedFileId(value: string | null | undefined) {
    this.selectedId.set(value ?? null);
  }
  @Output() picked = new EventEmitter<FileResponse>();

  readonly formatBytes = formatBytes;

  private readonly owner = signal<string | null>(null);
  readonly all = signal<FileResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly search = signal('');
  readonly selectedId = signal<string | null>(null);
  /** Cuando hay cliente, filtro opcional (por defecto OFF: se ven todos los PDF de la oficina). */
  readonly onlyThisClient = signal(false);

  readonly hasClientFilter = computed(() => !!this.owner());

  /** Solo PDF disponibles, filtrados por el chip de cliente (si activo) y por el texto. */
  readonly pdfs = computed(() => {
    const term = this.search().trim().toLowerCase();
    const owner = this.owner();
    const clientOnly = this.onlyThisClient() && !!owner;
    return this.all()
      .filter(file => file.status === 'Available' && isPdf(file))
      .filter(file => !clientOnly || file.ownerId === owner)
      .filter(file => !term || file.originalName.toLowerCase().includes(term));
  });

  toggleClientFilter(): void {
    this.onlyThisClient.update(v => !v);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    // expand pide la siguiente página mientras la anterior venga llena; reduce acumula los lotes.
    this.storage
      .listFiles(0, PAGE_SIZE)
      .pipe(
        expand((batch, i) =>
          batch.length === PAGE_SIZE && i + 1 < MAX_PAGES ? this.storage.listFiles((i + 1) * PAGE_SIZE, PAGE_SIZE) : EMPTY
        ),
        reduce((acc, batch) => acc.concat(batch), [] as FileResponse[])
      )
      .subscribe({
        next: files => {
          this.all.set(files);
          this.loading.set(false);
        },
        error: err => {
          this.error.set(toApiError(err).message);
          this.loading.set(false);
        },
      });
  }

  pick(file: FileResponse): void {
    this.selectedId.set(file.id);
    this.picked.emit(file);
  }

  shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
