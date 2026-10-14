import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import {
  AccessCapability,
  AccessPreset,
  AccessResourceType,
  CustomerAccessRuleView,
  PRESET_COPY,
  SELECTABLE_PRESETS,
  capabilitiesFor,
  detectPreset,
  ruleKey,
} from '../../data-access/customer-document-access.model';
import { CustomerDocumentAccessStore } from '../../data-access/customer-document-access.store';
import { CustomerDocumentAccessPermissions } from '../../data-access/customer-document-access.permissions';
import { AuthService } from '@core/auth/auth.service';

/** Target recibido en modo item. */
export interface CustomerAccessDrawerItem {
  resourceType: 'File' | 'Folder';
  resourceId: string;
  name: string;
  // Slug técnico del folder (p.ej. `sys.email`). Diferencia los folders del sistema aunque el
  // display `name` sea un nombre amable como "Email". Null u omitido para files.
  category?: string | null;
}

/** Modo del drawer. */
export type CustomerAccessDrawerMode = 'customer' | 'item';

/** Etiqueta amable por capacidad para el UI. `Visible` se muestra aparte como "Hide from client". */
const CAPABILITY_COPY: Record<AccessCapability, { label: string; description: string }> = {
  Visible: {
    label: 'Hide from client',
    description: 'Remove this item from the client portal entirely.',
  },
  Preview: { label: 'Preview', description: 'Open the document in the viewer.' },
  Download: { label: 'Download', description: "Save a copy to the client's device." },
  Upload: { label: 'Upload', description: 'Add new files inside this folder.' },
  Delete: { label: 'Delete', description: 'Remove items from this folder.' },
  ShareExternal: { label: 'Share external', description: 'Create external share links.' },
};

/** Clave del map de toggles del formulario. `true` = allow (sin deny); `false` = deny. */
type ToggleState = Record<AccessCapability, boolean>;

/**
 * Drawer único de reglas deny per-item. Modo `customer` muestra todas las reglas del cliente
 * agrupadas por recurso; modo `item` enfoca un file/folder concreto con el formulario de
 * toggles Allow/Deny + Reason + "Hide from client".
 *
 * Diff mínimo en save: el formulario arranca con el estado real del store para ese item y solo
 * emite POST/DELETE para las capacidades que cambiaron, incluso cuando la razón cambió sin
 * cambiar de allow/deny (POST idempotente en el backend).
 */
@Component({
  selector: 'app-customer-document-access-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [CommonModule, FormsModule, DrawerComponent, SwitchComponent, ConfirmDialogComponent],
  templateUrl: './customer-document-access-drawer.component.html',
})
export class CustomerDocumentAccessDrawerComponent implements OnChanges {
  @Input({ required: true }) customerId = '';
  @Input({ required: true }) mode: CustomerAccessDrawerMode = 'customer';
  /** Requerido en modo `item`. */
  @Input() item: CustomerAccessDrawerItem | null = null;
  @Input() open = false;

  @Output() readonly closed = new EventEmitter<void>();

  readonly store = inject(CustomerDocumentAccessStore);
  private readonly perms = inject(CustomerDocumentAccessPermissions);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly canManage = this.perms.canManage;

  /** Lista estática de presets seleccionables para pintar el pill group. */
  readonly selectablePresets = SELECTABLE_PRESETS;
  readonly presetCopy = PRESET_COPY;

  /** Flag mientras se aplica un preset — bloquea los botones. */
  readonly applyingPreset = signal(false);

  /** Preset activo (incluye `Custom` cuando las reglas tenant-scope no matchean ninguno). */
  readonly activePreset = computed<AccessPreset>(() =>
    detectPreset(this.store.rulesFor(this.customerId)),
  );

  // ---------- Modo item: formulario ----------
  readonly toggles = signal<ToggleState>({
    Visible: true,
    Preview: true,
    Download: true,
    Upload: true,
    Delete: true,
    ShareExternal: true,
  });
  readonly reason = signal<string>('');
  readonly saving = signal(false);
  readonly pendingHide = signal(false);

  /** Snapshot al abrir, para calcular el diff al guardar. */
  private initialToggles: ToggleState = { ...this.toggles() };
  private initialReason = '';

  /** Capacidades a pintar para el item actual (sin `Visible`, que es el switch Hide). */
  readonly itemCapabilities = computed<readonly AccessCapability[]>(() => {
    const kind = this.item?.resourceType;
    if (!kind) {
      return [];
    }
    return capabilitiesFor(kind);
  });

  /** Folder del sistema (prefijo `sys.` en category, con fallback a name): pinta un aviso en modo item. */
  readonly isSystemFolder = computed(() => {
    const it = this.item;
    if (!it || it.resourceType !== 'Folder') return false;
    return (it.category ?? '').startsWith('sys.') || it.name.startsWith('sys.');
  });

  /**
   * Agrupa reglas per-item (File/Folder) del modo `customer` para la lista. Solo entran reglas con
   * un recurso real: TenantScope lo pinta la sección de preset arriba, y cualquier valor fuera del
   * contrato (enum sin normalizar, resourceId vacío) se descarta para no mostrar chips rotos.
   */
  readonly groupedRules = computed(() => {
    const rules = this.store.rulesFor(this.customerId);
    const groups = new Map<
      string,
      { resourceType: AccessResourceType; resourceId: string; rules: CustomerAccessRuleView[] }
    >();
    for (const rule of rules) {
      const isPerItem = rule.resourceType === 'File' || rule.resourceType === 'Folder';
      if (!isPerItem || !rule.resourceId) {
        continue;
      }
      const key = `${rule.resourceType}|${rule.resourceId}`;
      let group = groups.get(key);
      if (!group) {
        group = { resourceType: rule.resourceType, resourceId: rule.resourceId, rules: [] };
        groups.set(key, group);
      }
      group.rules.push(rule);
    }
    return Array.from(groups.values());
  });

  ngOnChanges(changes: SimpleChanges): void {
    const openChange = changes['open'];
    const itemChange = changes['item'];
    const customerChange = changes['customerId'];
    const shouldOpenLoad =
      (openChange?.currentValue || customerChange) && this.customerId && this.canManage();
    const shouldHydrate =
      (openChange?.currentValue || itemChange) && this.mode === 'item' && this.item && this.open;

    if (shouldOpenLoad) {
      this.store
        .load(this.customerId)
        .then(() => {
          if (shouldHydrate && this.item) {
            this.hydrateFromStore();
          }
        })
        .catch(() => {
          // El error ya está en el signal `error` del store; el template lo pinta.
        });
    } else if (shouldHydrate) {
      this.hydrateFromStore();
    }
  }

  /** Reconstruye el formulario a partir de las reglas del store para el item actual. */
  private hydrateFromStore(): void {
    const item = this.item;
    if (!item) {
      return;
    }
    const rules = this.store.rulesFor(this.customerId);
    const state: ToggleState = {
      Visible: true,
      Preview: true,
      Download: true,
      Upload: true,
      Delete: true,
      ShareExternal: true,
    };
    let reason = '';
    for (const rule of rules) {
      if (rule.resourceType === item.resourceType && rule.resourceId === item.resourceId) {
        state[rule.capability] = false; // hay deny → "allow" OFF
        if (rule.reason && !reason) {
          reason = rule.reason;
        }
      }
    }
    this.toggles.set(state);
    this.reason.set(reason);
    this.initialToggles = { ...state };
    this.initialReason = reason;
  }

  // ---------- UI ----------

  heading(): string {
    if (this.mode === 'item' && this.item) {
      return `Access overrides · ${this.item.name}`;
    }
    return 'Document access overrides';
  }

  subheading(): string {
    if (this.mode === 'item') {
      return 'Allow by default. Switch off any action the client should not perform on this item.';
    }
    return 'Hide or restrict actions per file and folder for this client.';
  }

  onClose(): void {
    this.closed.emit();
  }

  setToggle(capability: AccessCapability, allowed: boolean): void {
    this.toggles.update((state) => ({ ...state, [capability]: allowed }));
  }

  /** `nextVisible=false` abre el confirm; `true` restaura la visibilidad sin preguntar. */
  requestHideToggle(nextVisible: boolean): void {
    if (!nextVisible) {
      this.pendingHide.set(true);
    } else {
      this.setToggle('Visible', true);
    }
  }

  confirmHide(): void {
    this.pendingHide.set(false);
    this.setToggle('Visible', false);
  }

  cancelHide(): void {
    this.pendingHide.set(false);
  }

  hideConfirmMessage(): string {
    const kind = this.item?.resourceType === 'Folder' ? 'folder' : 'file';
    return `Hiding this ${kind} removes it from the client portal entirely. They won't see it or know it exists. Continue?`;
  }

  reasonTooLong(): boolean {
    return this.reason().length > 500;
  }

  // ---------- Save ----------

  async save(): Promise<void> {
    const item = this.item;
    if (!item || this.saving() || this.reasonTooLong()) {
      return;
    }
    this.saving.set(true);
    const current = this.toggles();
    const reason = this.reason().trim() || null;
    const reasonChanged = reason !== (this.initialReason || null);
    const caps: AccessCapability[] = [...capabilitiesFor(item.resourceType), 'Visible'];

    try {
      for (const cap of caps) {
        const nowAllowed = current[cap];
        const wasAllowed = this.initialToggles[cap];
        if (nowAllowed === wasAllowed) {
          // Mismo estado — solo re-envía POST si cambió la razón y seguía en deny.
          if (!nowAllowed && reasonChanged) {
            await this.store.setDeny(this.customerId, {
              resourceType: item.resourceType,
              resourceId: item.resourceId,
              capability: cap,
              reason,
            });
          }
          continue;
        }
        if (nowAllowed) {
          // Pasó de deny a allow → DELETE.
          await this.store.clearDeny(this.customerId, item.resourceType, item.resourceId, cap);
        } else {
          // Pasó de allow a deny → POST.
          await this.store.setDeny(this.customerId, {
            resourceType: item.resourceType,
            resourceId: item.resourceId,
            capability: cap,
            reason,
          });
        }
      }
      this.toast.success('Access overrides saved');
      this.initialToggles = { ...current };
      this.initialReason = reason ?? '';
      this.closed.emit();
    } catch (err) {
      this.toast.error(toApiError(err).message);
    } finally {
      this.saving.set(false);
    }
  }

  async selectPreset(preset: Exclude<AccessPreset, 'Custom'>): Promise<void> {
    if (this.applyingPreset() || preset === this.activePreset()) {
      return;
    }
    const tenantId = this.auth.currentUser()?.tenant.id ?? '';
    if (!tenantId) {
      this.toast.error('No tenant context available');
      return;
    }
    this.applyingPreset.set(true);
    try {
      await this.store.applyPreset(this.customerId, preset, tenantId);
      this.toast.success(`Preset applied · ${PRESET_COPY[preset].label}`);
    } catch (err) {
      this.toast.error(toApiError(err).message);
    } finally {
      this.applyingPreset.set(false);
    }
  }

  async clearOne(rule: CustomerAccessRuleView): Promise<void> {
    try {
      await this.store.clearDeny(
        this.customerId,
        rule.resourceType,
        rule.resourceId,
        rule.capability,
      );
      this.toast.success('Override removed');
    } catch (err) {
      this.toast.error(toApiError(err).message);
    }
  }

  // ---------- Helpers de UI ----------

  copyFor(capability: AccessCapability): { label: string; description: string } {
    return CAPABILITY_COPY[capability];
  }

  resourceIcon(resourceType: AccessResourceType): string {
    if (resourceType === 'Folder') {
      return 'folder-outline';
    }
    if (resourceType === 'File') {
      return 'document-outline';
    }
    return 'business-outline';
  }

  /** Chip label for a rule row. */
  chipLabel(capability: AccessCapability): string {
    return capability === 'Visible' ? 'Hidden' : CAPABILITY_COPY[capability].label;
  }

  trackByRuleKey(_index: number, rule: CustomerAccessRuleView): string {
    return ruleKey(rule.resourceType, rule.resourceId, rule.capability);
  }

  trackByGroup(
    _index: number,
    group: { resourceType: AccessResourceType; resourceId: string },
  ): string {
    return `${group.resourceType}|${group.resourceId}`;
  }

  /**
   * Nombre visible del grupo. El backend hidrata `resourceName` por regla; alcanza con tomar el
   * primero no-null del grupo (todas las reglas apuntan al mismo recurso). Si ninguna lo trae
   * (recurso borrado tras crearse la regla), caemos a un copy fail-closed por tipo.
   */
  displayNameFor(group: {
    resourceType: AccessResourceType;
    resourceId: string;
    rules: CustomerAccessRuleView[];
  }): string {
    const named = group.rules.find((r) => r.resourceName);
    if (named?.resourceName) {
      return named.resourceName;
    }
    return group.resourceType === 'Folder' ? 'Deleted folder' : 'Deleted file';
  }
}
