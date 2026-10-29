import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { FileDropDirective } from '@shared/directives/file-drop.directive';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AvatarUrlService } from '@core/profile-photo/avatar-url';
import { PROFILE_PHOTO_ACCEPT } from '@core/profile-photo/profile-photo-image.util';
import { PhotoStatus } from '@core/profile-photo/profile-photo-upload';
import {
  CLIENT_PHOTO_FAILED_MESSAGE,
  CLIENT_PHOTO_STILL_PROCESSING_MESSAGE,
  ClientPhotoStore,
} from '../../data-access/client-photo.store';
import { ClientProfile } from '../../models/client-profile.model';

const STATUS_LABELS: Record<PhotoStatus, string> = {
  idle: '',
  preparing: 'Preparing photo…',
  uploading: 'Uploading photo…',
  processing: 'Checking the photo…',
  removing: 'Removing photo…',
};

/**
 * Cabecera de Client 360: avatar del cliente (con su foto) + el contenido proyectado (nombre y chips).
 * Con `canEdit` (customers.manage y cliente no archivado) agrega la cámara sobre el avatar, soltar una
 * imagen encima, Upload/Change/Remove photo, estado "Checking…" con región en vivo y errores en línea.
 * Mismo UX que la foto del perfil propio. Emite `changed` cuando el detalle debe recargarse.
 */
@Component({
  selector: 'app-client-photo-editor',
  imports: [AvatarComponent, ConfirmDialogComponent, FileDropDirective],
  providers: [ClientPhotoStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-photo-editor.component.html',
  styles: `
    .cpe-photo {
      border-radius: 9999px;
      transition: box-shadow 160ms ease;
    }
    .cpe-photo--dragging {
      box-shadow:
        0 0 0 3px #fff,
        0 0 0 5px rgb(var(--color-indigo-600-rgb, 30 70 107));
    }
    .cpe-spinner {
      animation: cpe-spin 1s linear infinite;
    }
    @keyframes cpe-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .cpe-spinner {
        animation: none;
      }
    }
  `,
})
export class ClientPhotoEditorComponent {
  private readonly store = inject(ClientPhotoStore);
  private readonly toast = inject(ToastService);
  private readonly avatarUrls = inject(AvatarUrlService);

  readonly client = input.required<ClientProfile>();
  /** customers.manage y cliente no archivado (lo decide la página). */
  readonly canEdit = input(false);
  /** La foto cambió (o terminó una revisión): la página recarga el detalle. */
  readonly changed = output<void>();

  readonly accept = PROFILE_PHOTO_ACCEPT;
  readonly status = this.store.status;
  readonly busy = this.store.busy;
  readonly error = this.store.error;
  readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);
  readonly imageUrl = computed(() => this.avatarUrls.url(this.client().avatarFileId));
  readonly hasPhoto = computed(() => !!this.client().avatarFileId);
  readonly removeOpen = signal(false);

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('photoInput');
  private readonly cameraButton = viewChild<ElementRef<HTMLButtonElement>>('photoButton');
  /** Cliente cuyo estado tiene el store (al cambiar de ficha se resetea). */
  private currentId: string | null = null;

  constructor() {
    // Cambio de cliente: se olvida el estado anterior y, si la ficha llega con una foto en revisión
    // (otra pestaña o recarga), se espera el veredicto para mostrarla sin recargar a mano.
    effect(() => {
      const c = this.client();
      const editable = this.canEdit();
      untracked(() => {
        if (c.id !== this.currentId) {
          this.currentId = c.id;
          this.store.reset();
          this.removeOpen.set(false);
        }
        if (editable && c.avatarUploadStatus === 'processing' && c.pendingAvatarFileId && !this.store.busy()) {
          this.store.resume(c.id, c.pendingAvatarFileId).subscribe({
            next: outcome => outcome !== 'timeout' && this.changed.emit(),
            error: () => {},
          });
        }
      });
    });
  }

  openPicker(): void {
    if (this.canEdit() && !this.busy()) {
      this.fileInput()?.nativeElement.click();
    }
  }

  onSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia para que elegir otra vez el mismo archivo vuelva a disparar `change`.
    input.value = '';
    if (file) {
      this.upload(file);
    }
  }

  onDropped(files: File[]): void {
    if (files[0] && this.canEdit()) {
      this.upload(files[0]);
    }
  }

  private upload(file: File): void {
    const id = this.client().id;
    this.store.upload(id, file).subscribe({
      next: outcome => {
        if (outcome === 'updated') {
          this.toast.success('Client photo updated');
          this.changed.emit();
        } else if (outcome === 'failed') {
          this.toast.error(CLIENT_PHOTO_FAILED_MESSAGE);
        } else {
          this.toast.info(CLIENT_PHOTO_STILL_PROCESSING_MESSAGE);
        }
      },
      // El motivo (400/404/413, preparación) ya queda en línea bajo la cabecera.
      error: () => this.focusCamera(),
    });
  }

  confirmRemove(): void {
    this.store.remove(this.client().id).subscribe({
      next: () => {
        this.closeRemove();
        this.toast.success('Client photo removed');
        this.changed.emit();
      },
      error: () => this.closeRemove(),
    });
  }

  closeRemove(): void {
    this.removeOpen.set(false);
    this.focusCamera();
  }

  /** Devuelve el foco a la cámara (tras el diálogo o un error), después del re-render. */
  private focusCamera(): void {
    setTimeout(() => this.cameraButton()?.nativeElement.focus());
  }
}
