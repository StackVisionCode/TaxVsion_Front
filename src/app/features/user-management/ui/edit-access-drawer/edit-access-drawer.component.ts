import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TeamMember } from '../user-table/user-table.component';
import { EditAccessStore } from '../../data-access/edit-access.store';
import { PermissionInfo, actorTypeLabel } from '../../data-access/user-management.model';
import { AccessModuleView, buildAccessView } from './access-view';

/**
 * The "Edit access" drawer: a right-side panel (full-screen on mobile) where an admin restricts, for one
 * user only, permissions their roles grant. Deny-only — turning a toggle OFF blocks that capability for
 * this user without touching anyone else; granting is still a role action, so permissions no role grants
 * show locked. Provides its own {@link EditAccessStore}, so each open starts from a clean baseline.
 * Role management is delegated to the existing panel via the `manageRoles` output (kept "quick").
 */
@Component({
  selector: 'app-edit-access-drawer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [EditAccessStore],
  templateUrl: './edit-access-drawer.component.html',
  styleUrl: './edit-access-drawer.component.css',
})
export class EditAccessDrawerComponent implements OnInit {
  private readonly store = inject(EditAccessStore);

  @Input({ required: true }) member!: TeamMember;
  /** Full permission catalog (GET /auth/permissions) — used to render the locked "not in her roles" rows. */
  @Input() catalog: PermissionInfo[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() manageRoles = new EventEmitter<TeamMember>();

  readonly loading = this.store.loading;
  readonly saving = this.store.saving;
  readonly error = this.store.error;
  readonly roles = this.store.roles;
  readonly deniedCount = this.store.deniedCount;
  readonly dirty = this.store.dirty;

  readonly search = signal('');
  private readonly openKeys = signal<ReadonlySet<string>>(new Set());
  private accordionInitialized = false;

  readonly seatLabel = computed(() => actorTypeLabel(this.store.actorType() || this.member.actorType));

  /** All module views for the loaded user (granted + locked), before the text filter. */
  private readonly allModules = computed<AccessModuleView[]>(() =>
    buildAccessView(this.store.modules(), this.catalog, this.store.actorType() || this.member.actorType),
  );

  /** Module views after applying the search box (matches module label/key or any row label/code). */
  readonly modules = computed<AccessModuleView[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.allModules();
    }
    return this.allModules()
      .map(module => {
        const moduleMatches = module.label.toLowerCase().includes(query) || module.key.toLowerCase().includes(query);
        if (moduleMatches) {
          return module;
        }
        const rows = module.rows.filter(
          row => row.label.toLowerCase().includes(query) || row.code.toLowerCase().includes(query),
        );
        return rows.length > 0 ? { ...module, rows } : null;
      })
      .filter((module): module is AccessModuleView => module !== null);
  });

  readonly summary = computed(() => {
    const count = this.deniedCount();
    if (count === 0) {
      return `No restrictions · ${this.firstName()} keeps everything their roles grant`;
    }
    const noun = count === 1 ? 'permission' : 'permissions';
    return `${count} ${noun} restricted · applies only to ${this.firstName()}`;
  });

  constructor() {
    // Open, on first load, the modules that already carry a restriction so the admin sees them at a
    // glance; if there are none, open the first module. Runs once, then the user's toggles win.
    effect(() => {
      const modules = this.store.modules();
      if (this.accordionInitialized || modules.length === 0) {
        return;
      }
      this.accordionInitialized = true;
      const open = new Set<string>();
      for (const module of modules) {
        if (module.permissions.some(permission => this.store.isDenied(permission.permissionId))) {
          open.add(module.module);
        }
      }
      if (open.size === 0) {
        open.add(modules[0].module);
      }
      this.openKeys.set(open);
    });
  }

  ngOnInit(): void {
    this.store.load(this.member.id);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.onCancel();
  }

  // ---- Accordion ----

  isOpen(key: string): boolean {
    return this.openKeys().has(key);
  }

  toggleAccordion(key: string): void {
    this.openKeys.update(current => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // ---- Per-permission + per-module state ----

  isDenied(permissionId: string): boolean {
    return this.store.isDenied(permissionId);
  }

  setAllowed(permissionId: string, allowed: boolean): void {
    this.store.setAllowed(permissionId, allowed);
  }

  /** Granted permissions in the module that are currently denied. */
  moduleDeniedCount(module: AccessModuleView): number {
    return module.rows.filter(row => !row.locked && this.store.isDenied(row.permissionId)).length;
  }

  /** Granted (toggleable) permissions in the module. */
  moduleGrantedCount(module: AccessModuleView): number {
    return module.rows.filter(row => !row.locked).length;
  }

  /** Master-toggle state: true when nothing in the module is restricted. */
  moduleAllowed(module: AccessModuleView): boolean {
    return this.moduleDeniedCount(module) === 0;
  }

  setModuleAllowed(module: AccessModuleView, allowed: boolean): void {
    this.store.setModuleAllowed(module.key, allowed);
  }

  private firstName(): string {
    return this.member.name.trim().split(/\s+/)[0] || this.member.name;
  }

  // ---- Actions ----

  onManageRoles(): void {
    this.manageRoles.emit(this.member);
  }

  onCancel(): void {
    this.closed.emit();
  }

  onSave(): void {
    if (!this.dirty() || this.saving()) {
      return;
    }
    this.store.save().subscribe({
      next: () => this.saved.emit(),
      error: () => {
        // The store already surfaced the message on error(); keep the drawer open so the admin can retry.
      },
    });
  }
}
