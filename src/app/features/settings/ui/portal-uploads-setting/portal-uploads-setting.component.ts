import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PermissionService } from '@core/auth/permission.service';
import { toUserMessage } from '@core/errors/error-messages';
import { ToastService } from '@shared/ui/toast/toast.service';
import { formatBytes } from '@shared/utils/format.util';
import { PortalUploadSettings, StorageSettingsService } from '../../data-access/storage-settings.service';

const MANAGE_PERMISSION = 'cloudstorage.settings.manage';
const MB = 1024 * 1024;

/**
 * Qué pueden subir los clientes desde el portal. La oficina solo restringe lo que vende su plan:
 * elige grupos de tipos dentro de los del plan y, si quiere, un tamaño menor. Todo marcado y sin
 * tamaño = igual que el plan.
 */
@Component({
  selector: 'app-portal-uploads-setting',
  standalone: true,
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './portal-uploads-setting.component.html',
})
export class PortalUploadsSettingComponent {
  private readonly perms = inject(PermissionService);
  private readonly settings = inject(StorageSettingsService);
  private readonly toast = inject(ToastService);

  readonly canManage = computed(() => this.perms.has(MANAGE_PERMISSION));
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly current = signal<PortalUploadSettings | null>(null);
  readonly selectedGroups = signal<string[]>([]);
  readonly maxMbText = signal('');

  readonly planSizeLabel = computed(() => {
    const current = this.current();
    return current ? formatBytes(current.planMaxFileBytes, { maxUnit: 'GB' }) : '';
  });

  constructor() {
    if (!this.canManage()) {
      this.loading.set(false);
      return;
    }
    this.settings.getPortalUploads().subscribe({
      next: settings => this.reset(settings),
      error: () => this.loading.set(false),
    });
  }

  isSelected(group: string): boolean {
    return this.selectedGroups().includes(group);
  }

  toggle(group: string): void {
    const selected = this.selectedGroups();
    // Al menos un grupo: sin ninguno el portal no podría subir nada.
    if (this.isSelected(group) && selected.length === 1) {
      return;
    }
    this.selectedGroups.set(this.isSelected(group) ? selected.filter(g => g !== group) : [...selected, group]);
  }

  /** Código del catálogo → texto legible ("rich_text" → "Rich text", "xml" → "XML"). */
  groupLabel(group: string): string {
    const words = group.split('_').filter(Boolean);
    if (words.length === 1 && words[0]!.length <= 3) {
      return words[0]!.toUpperCase();
    }
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  save(): void {
    const current = this.current();
    if (!current || this.saving()) {
      return;
    }
    const text = this.maxMbText().trim();
    const megabytes = text ? Number(text) : null;
    if (megabytes !== null && (!Number.isFinite(megabytes) || megabytes <= 0)) {
      this.toast.error('Enter a size in MB, or leave it empty to use your plan limit.');
      return;
    }
    // Todos los grupos del plan = sin restricción (sigue al plan si cambia).
    const allPlanGroups = current.planFileTypeGroups.every(group => this.isSelected(group));
    this.saving.set(true);
    this.settings
      .updatePortalUploads({
        fileTypeGroups: allPlanGroups ? null : this.selectedGroups(),
        maxFileBytes: megabytes === null ? null : Math.round(megabytes * MB),
      })
      .subscribe({
        next: settings => {
          this.saving.set(false);
          this.reset(settings);
          this.toast.success('Client upload rules saved.');
        },
        error: err => {
          this.saving.set(false);
          this.toast.error(toUserMessage(err));
        },
      });
  }

  private reset(settings: PortalUploadSettings): void {
    this.current.set(settings);
    this.selectedGroups.set(settings.portalFileTypeGroups ?? [...settings.planFileTypeGroups]);
    this.maxMbText.set(settings.portalMaxFileBytes === null ? '' : `${Math.round(settings.portalMaxFileBytes / MB)}`);
    this.loading.set(false);
  }
}
