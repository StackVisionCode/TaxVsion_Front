import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { DocumentsService } from '@features/documents/data-access/documents.service';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toUserMessage } from '@core/errors/error-messages';

const MANAGE_PERMISSION = 'cloudstorage.settings.manage';

/**
 * Ajuste de la firma para los ENLACES PÚBLICOS de Documents. Están activados por defecto; este
 * interruptor permite desactivarlos (por si la oficina no quiere links sin sesión para datos
 * fiscales). Solo puede cambiarlo quien tenga el permiso de gestión de ajustes de almacenamiento;
 * para el resto se muestra el estado en modo lectura. Estado real desde `GET /storage/usage`,
 * cambio por `PUT /storage/settings/public-sharing`.
 */
@Component({
  selector: 'app-public-sharing-setting',
  standalone: true,
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './public-sharing-setting.component.html',
  styleUrl: './public-sharing-setting.component.css',
})
export class PublicSharingSettingComponent {
  private readonly documents = inject(DocumentsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly allowed = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);

  /** Solo con el permiso de gestión se puede cambiar; el resto lo ve en lectura. */
  readonly canManage = computed(() => this.auth.currentUser()?.permissions?.includes(MANAGE_PERMISSION) ?? false);

  constructor() {
    this.documents.getUsage().subscribe({
      next: usage => {
        this.allowed.set(usage.allowPublicShareLinks);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggle(): void {
    if (!this.canManage() || this.saving()) {
      return;
    }
    const next = !this.allowed();
    this.saving.set(true);
    this.documents.setPublicSharing(next).subscribe({
      next: () => {
        this.allowed.set(next);
        this.saving.set(false);
        this.toast.success(next ? 'Public links are now enabled.' : 'Public links are now disabled.');
      },
      error: err => {
        this.saving.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }
}
