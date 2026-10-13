import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { SignatureProfile, SignatureProfileScope } from '../../data-access/signature.model';
import { SignatureStore } from '../../data-access/signature.store';
import { CreatedSignature, SignatureCreatorComponent } from '../signature-creator/signature-creator.component';
import { toPngOnWhiteBase64 } from '../../utils/signature-png.util';

/**
 * Lista + CRUD INLINE de perfiles de firma de UN ámbito (personal o de oficina). Reemplaza el modal
 * `signature-profiles-manager`, que mezclaba ambos: aquí el padre elige el ámbito con `scope`.
 *
 * - `scope="office"` → firma(s) compartidas del despacho (Settings → Signature, B3).
 * - `scope="user"`   → "My Signature" del empleado (página /settings/my-signature, C1).
 *
 * Acciones instantáneas vía el store de perfiles (no pasan por ningún "Save"). El gate de acceso lo
 * pone el padre (sección de settings o guard de ruta); este componente solo lista su ámbito.
 */
@Component({
  selector: 'app-signature-profile-list',
  imports: [CommonModule, FormsModule, SignatureCreatorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-profile-list.component.html',
})
export class SignatureProfileListComponent {
  private readonly store = inject(SignatureStore);

  /** Ámbito que gestiona esta lista. */
  @Input() scope: SignatureProfileScope = 'user';

  private readonly isOffice = computed(() => this.scope === 'office');

  /** URL de descarga (presignada) por fileId, para previsualizar cada firma. */
  private readonly previewUrls = signal<Record<string, string>>({});

  readonly adding = signal(false);
  readonly savingAdd = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editLabel = signal('');
  readonly error = signal('');

  /** Perfiles del ámbito: por defecto primero, luego por etiqueta, archivadas al final. */
  readonly profiles = computed(() =>
    this.store
      .signatureProfiles()
      .filter(p => p.isOffice === this.isOffice())
      .slice()
      .sort(
        (a, b) =>
          Number(a.isArchived) - Number(b.isArchived) ||
          Number(b.isDefault) - Number(a.isDefault) ||
          a.label.localeCompare(b.label),
      ),
  );

  readonly addLabel = computed(() => (this.isOffice() ? 'Add office signature' : 'Add signature'));
  readonly emptyText = computed(() =>
    this.isOffice()
      ? 'No office signature yet. Add one for the whole office to use.'
      : 'No signatures yet. Add one — draw, type or upload — and it will be saved for reuse.',
  );
  readonly introText = computed(() =>
    this.isOffice()
      ? 'Shared signatures the whole office can stamp on prepared documents.'
      : 'Reusable signatures stamped on documents you prepare.',
  );

  constructor() {
    // Carga no-forzada: la página que hospeda esta lista ya refresca al abrir; aquí solo garantizamos
    // que haya datos si se montó en frío. Evita el doble fetch página + hija.
    this.store.loadSignatureProfiles();
    // Al cambiar la lista, baja la URL de preview de las firmas del ámbito cuyo fileId aún no tenemos.
    effect(() => {
      const profiles = this.store.signatureProfiles();
      const known = this.previewUrls();
      const office = this.isOffice();
      for (const profile of profiles) {
        if (profile.isOffice !== office || known[profile.fileId]) {
          continue;
        }
        this.store.getDownloadUrl(profile.fileId).subscribe({
          next: url => this.previewUrls.update(map => ({ ...map, [profile.fileId]: url })),
          error: () => {
            // Sin preview no se rompe la fila; se muestra el placeholder.
          },
        });
      }
    });
  }

  previewFor(profile: SignatureProfile): string | null {
    return this.previewUrls()[profile.fileId] ?? null;
  }

  openAdd(): void {
    this.error.set('');
    this.adding.set(true);
  }

  closeAdd(): void {
    if (this.savingAdd()) {
      return;
    }
    this.adding.set(false);
  }

  async onSignatureCreated(signature: CreatedSignature): Promise<void> {
    if (this.savingAdd()) {
      return;
    }
    this.savingAdd.set(true);
    this.error.set('');
    try {
      const imageBase64 = await toPngOnWhiteBase64(signature.dataUrl);
      this.store.createSignatureProfile({ label: signature.displayName, scope: this.scope, imageBase64 }).subscribe({
        next: created => {
          // Preview instantáneo con el dataUrl recién dibujado, sin esperar la URL presignada del reload.
          this.previewUrls.update(map => ({ ...map, [created.fileId]: signature.dataUrl }));
          this.savingAdd.set(false);
          this.adding.set(false);
        },
        error: err => {
          this.savingAdd.set(false);
          this.error.set(toApiError(err).message);
        },
      });
    } catch {
      this.savingAdd.set(false);
      this.error.set('That image could not be processed. Try a PNG.');
    }
  }

  setDefault(profile: SignatureProfile): void {
    if (profile.isDefault || profile.isArchived || this.busyId()) {
      return;
    }
    this.run(profile.id, this.store.setDefaultSignatureProfile(profile.id));
  }

  startRename(profile: SignatureProfile): void {
    this.error.set('');
    this.editLabel.set(profile.label);
    this.editingId.set(profile.id);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  confirmRename(profile: SignatureProfile): void {
    const label = this.editLabel().trim();
    if (this.busyId()) {
      return;
    }
    if (label.length < 1) {
      this.error.set('Enter a name for the signature.');
      return;
    }
    this.busyId.set(profile.id);
    this.error.set('');
    this.store.renameSignatureProfile(profile.id, label).subscribe({
      next: () => {
        this.busyId.set(null);
        this.editingId.set(null);
      },
      error: err => {
        this.busyId.set(null);
        this.error.set(toApiError(err).message);
      },
    });
  }

  toggleArchive(profile: SignatureProfile): void {
    if (this.busyId()) {
      return;
    }
    this.run(
      profile.id,
      profile.isArchived
        ? this.store.unarchiveSignatureProfile(profile.id)
        : this.store.archiveSignatureProfile(profile.id),
    );
  }

  remove(profile: SignatureProfile): void {
    if (this.busyId()) {
      return;
    }
    this.run(profile.id, this.store.deleteSignatureProfile(profile.id));
  }

  private run(id: string, action: ReturnType<SignatureStore['setDefaultSignatureProfile']>): void {
    this.busyId.set(id);
    this.error.set('');
    action.subscribe({
      next: () => this.busyId.set(null),
      error: err => {
        this.busyId.set(null);
        this.error.set(toApiError(err).message);
      },
    });
  }
}
