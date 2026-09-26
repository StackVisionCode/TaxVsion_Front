import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
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
import { PermissionService } from '../../../../core/auth/permission.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { CreatedSignature, SignatureCreatorComponent } from '../signature-creator/signature-creator.component';

/**
 * Gestión de "My Signatures" (14.5 F4): las firmas reutilizables del preparador. Lista las propias
 * (con default, renombrar, archivar/borrar) y, de solo lectura, las de oficina. "Add" abre el generador
 * (dibujar/escribir/subir) y persiste la firma en CloudStorage vía el backend — se acabó el "solo en
 * pantalla". La gestión de la firma de OFICINA es del admin (F6); aquí solo se muestran.
 */
@Component({
  selector: 'app-signature-profiles-manager',
  imports: [CommonModule, FormsModule, ModalComponent, SignatureCreatorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-profiles-manager.component.html',
})
export class SignatureProfilesManagerComponent {
  private _isOpen = false;
  @Input() set isOpen(value: boolean) {
    this._isOpen = value;
    if (value) {
      this.reset();
      this.store.loadSignatureProfiles(true);
      if (this.isAdmin()) {
        this.store.loadSignatureSettings();
      }
    }
  }
  get isOpen(): boolean {
    return this._isOpen;
  }

  @Output() closed = new EventEmitter<void>();

  readonly store = inject(SignatureStore);
  private readonly perms = inject(PermissionService);
  /** Solo el admin del tenant gestiona la firma de oficina y la gobernanza. */
  readonly isAdmin = this.perms.isAdmin;
  /** El backend decide si este actor puede tener/usar firma personal (empleado con toggle OFF → false). */
  readonly canManageOwn = this.store.canManageOwnSignature;
  /** Ámbito del alta en curso: firma personal o de oficina (solo admin). */
  readonly addScope = signal<SignatureProfileScope>('user');
  readonly togglingGovernance = signal(false);

  /** URL de descarga (presignada) por fileId, para previsualizar la imagen de cada firma. */
  readonly previewUrls = signal<Record<string, string>>({});

  readonly adding = signal(false);
  readonly savingAdd = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editLabel = signal('');
  readonly error = signal('');

  /** Firmas personales (con acciones); default primero, luego por etiqueta, archivadas al final. */
  readonly myProfiles = computed(() =>
    this.store
      .signatureProfiles()
      .filter(p => !p.isOffice)
      .slice()
      .sort(this.sortProfiles),
  );
  /** Firmas de oficina: el admin las gestiona (ve archivadas); el resto solo ve las activas. */
  readonly officeProfiles = computed(() =>
    this.store
      .signatureProfiles()
      .filter(p => p.isOffice && (this.isAdmin() || !p.isArchived))
      .slice()
      .sort(this.sortProfiles),
  );

  constructor() {
    // Al cambiar la lista, baja la URL de preview de las firmas cuyo fileId aún no tenemos.
    effect(() => {
      const profiles = this.store.signatureProfiles();
      const known = this.previewUrls();
      for (const profile of profiles) {
        if (known[profile.fileId]) {
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

  // ---------- Añadir (generador) ----------

  openAdd(scope: SignatureProfileScope = 'user'): void {
    this.error.set('');
    this.addScope.set(scope);
    this.adding.set(true);
  }

  /** Cambia el toggle de gobernanza (permitir firma propia del empleado). */
  toggleAllowOwnSignature(): void {
    const settings = this.store.signatureSettings();
    if (!settings || this.togglingGovernance()) {
      return;
    }
    this.togglingGovernance.set(true);
    this.error.set('');
    this.store.setAllowEmployeeOwnSignature(!settings.allowEmployeeOwnSignature).subscribe({
      next: () => this.togglingGovernance.set(false),
      error: err => {
        this.togglingGovernance.set(false);
        this.error.set(toApiError(err).message);
      },
    });
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
      // El backend solo acepta PNG; re-codificamos cualquier origen (una subida JPEG, p. ej.) a PNG.
      const imageBase64 = await this.toPngBase64(signature.dataUrl);
      this.store.createSignatureProfile({ label: signature.displayName, scope: this.addScope(), imageBase64 }).subscribe({
        next: created => {
          // Preview instantáneo: usa el dataUrl recién dibujado sin esperar la URL presignada del reload.
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

  // ---------- Acciones por firma (propias) ----------

  setDefault(profile: SignatureProfile): void {
    if (profile.isDefault || this.busyId()) {
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

  close(): void {
    this.reset();
    this.closed.emit();
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

  private reset(): void {
    this.adding.set(false);
    this.savingAdd.set(false);
    this.busyId.set(null);
    this.editingId.set(null);
    this.error.set('');
  }

  private readonly sortProfiles = (a: SignatureProfile, b: SignatureProfile): number =>
    Number(a.isArchived) - Number(b.isArchived) ||
    Number(b.isDefault) - Number(a.isDefault) ||
    a.label.localeCompare(b.label);

  /**
   * Redibuja el dataUrl sobre fondo BLANCO y lo exporta como PNG base64 (sin el prefijo data-url).
   * El fondo blanco es clave: un PNG transparente se sella NEGRO en PdfSharp (pinta el alfa como negro).
   * El pad del firmante ya rellena blanco por lo mismo; aquí igualamos ese comportamiento.
   */
  private toPngBase64(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 400;
        canvas.height = img.naturalHeight || 150;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no-2d-context'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png').split(',')[1] ?? '');
      };
      img.onerror = () => reject(new Error('image-load-failed'));
      img.src = dataUrl;
    });
  }
}
