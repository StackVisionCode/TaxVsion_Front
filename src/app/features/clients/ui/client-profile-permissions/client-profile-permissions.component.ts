import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';

interface PermNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  children?: PermNode[];
}

interface ResourcePermission {
  isVisible: boolean;
  isLocked: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canRename: boolean;
}

interface PermissionFlagDef {
  key: keyof ResourcePermission;
  label: string;
  icon: string;
  description: string;
}

const DEFAULT_PERMISSION: ResourcePermission = {
  isVisible: true,
  isLocked: false,
  canUpload: false,
  canDownload: true,
  canDelete: false,
  canCreate: false,
  canRename: false,
};

const FLAG_DEFS: PermissionFlagDef[] = [
  { key: 'isVisible', label: 'Visible', icon: 'eye-outline', description: 'Show this item to the client' },
  { key: 'isLocked', label: 'Locked', icon: 'lock-closed-outline', description: 'Prevent any changes to this item' },
  { key: 'canUpload', label: 'Upload', icon: 'cloud-upload-outline', description: 'Add new files inside this item' },
  { key: 'canDownload', label: 'Download', icon: 'download-outline', description: 'Save a copy of this item' },
  { key: 'canDelete', label: 'Delete', icon: 'trash-outline', description: 'Remove this item permanently' },
  { key: 'canCreate', label: 'Create', icon: 'add-circle-outline', description: 'Create new subfolders here' },
  { key: 'canRename', label: 'Rename', icon: 'create-outline', description: 'Rename this item' },
];

const MOCK_TREE: PermNode[] = [
  {
    id: 'folder-documents',
    name: 'Documents',
    type: 'folder',
    children: [
      {
        id: 'folder-tax-returns',
        name: 'Tax Returns',
        type: 'folder',
        children: [
          { id: 'file-2024-return', name: '2024_Return.pdf', type: 'file' },
          { id: 'file-2023-return', name: '2023_Return.pdf', type: 'file' },
        ],
      },
      {
        id: 'folder-w2',
        name: 'W-2 Forms',
        type: 'folder',
        children: [{ id: 'file-w2-2025', name: 'W2_2025.pdf', type: 'file' }],
      },
    ],
  },
  {
    id: 'folder-signed',
    name: 'Signed Documents',
    type: 'folder',
    children: [{ id: 'file-engagement-letter', name: 'Engagement_Letter.pdf', type: 'file' }],
  },
  { id: 'file-intake-form', name: 'Intake_Form.pdf', type: 'file' },
];

interface NodeIndexEntry {
  node: PermNode;
  parentId: string | null;
}

function buildIndex(nodes: PermNode[], parentId: string | null, index: Map<string, NodeIndexEntry>): void {
  for (const node of nodes) {
    index.set(node.id, { node, parentId });
    if (node.children) {
      buildIndex(node.children, node.id, index);
    }
  }
}

const NODE_INDEX = new Map<string, NodeIndexEntry>();
buildIndex(MOCK_TREE, null, NODE_INDEX);

function filterTree(nodes: PermNode[], query: string): PermNode[] {
  if (!query) {
    return nodes;
  }
  const result: PermNode[] = [];
  for (const node of nodes) {
    const selfMatches = node.name.toLowerCase().includes(query);
    const filteredChildren = node.children ? filterTree(node.children, query) : undefined;
    if (selfMatches || (filteredChildren && filteredChildren.length > 0)) {
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

function nodePath(nodeId: string): string {
  const parts: string[] = [];
  let current: string | null = nodeId;
  while (current) {
    const entry = NODE_INDEX.get(current);
    if (!entry) {
      break;
    }
    parts.unshift(entry.node.name);
    current = entry.parentId;
  }
  return parts.join(' / ');
}

/**
 * Pestaña "Permissions" del perfil de cliente (puerto visual/estructural de
 * `customer-permissions`): árbol de carpetas/archivos mock autocontenido
 * (NO conectado a la feature real de `documents`, decisión deliberada para
 * no acoplar dos features mock independientes) + panel de flags booleanos
 * por nodo con toggle maestro "Inherit from Parent". `overrides` solo
 * contiene entradas EXPLÍCITAS: presencia = badge "Explicit", ausencia =
 * "Inherited" (el valor efectivo sube por la cadena de padres hasta
 * encontrar un override o llegar a la raíz con `DEFAULT_PERMISSION`).
 */
@Component({
  selector: 'app-client-profile-permissions',
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-permissions.component.html',
})
export class ClientProfilePermissionsComponent {
  @Input() clientId = '';

  readonly flagDefs = FLAG_DEFS;
  readonly searchTerm = signal('');
  readonly expandedFolders = signal<Set<string>>(new Set(['folder-documents']));
  readonly overrides = signal<Record<string, ResourcePermission>>({});
  readonly selectedNodeId = signal<string | null>(null);

  /** Working copy of the panel: only meaningful while a node is selected. */
  readonly draftInherit = signal(true);
  readonly draftPermission = signal<ResourcePermission>({ ...DEFAULT_PERMISSION });
  readonly pendingRemove = signal(false);

  readonly rootNodes = computed<PermNode[]>(() => filterTree(MOCK_TREE, this.searchTerm().trim().toLowerCase()));

  readonly selectedNode = computed<PermNode | null>(() => {
    const id = this.selectedNodeId();
    return id ? (NODE_INDEX.get(id)?.node ?? null) : null;
  });

  readonly selectedPath = computed(() => {
    const id = this.selectedNodeId();
    return id ? nodePath(id) : '';
  });

  readonly hasExplicitOverride = computed(() => {
    const id = this.selectedNodeId();
    return id !== null && id in this.overrides();
  });

  isExpanded(id: string): boolean {
    return this.searchTerm().trim().length > 0 || this.expandedFolders().has(id);
  }

  toggleExpand(id: string): void {
    this.expandedFolders.update(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  effectivePermission(nodeId: string): ResourcePermission {
    const override = this.overrides()[nodeId];
    if (override) {
      return override;
    }
    const parentId = NODE_INDEX.get(nodeId)?.parentId ?? null;
    return parentId ? this.effectivePermission(parentId) : { ...DEFAULT_PERMISSION };
  }

  selectNode(id: string): void {
    this.selectedNodeId.set(id);
    const override = this.overrides()[id];
    if (override) {
      this.draftInherit.set(false);
      this.draftPermission.set({ ...override });
    } else {
      const parentId = NODE_INDEX.get(id)?.parentId ?? null;
      this.draftInherit.set(true);
      this.draftPermission.set(parentId ? this.effectivePermission(parentId) : { ...DEFAULT_PERMISSION });
    }
  }

  setDraftInherit(inherit: boolean): void {
    this.draftInherit.set(inherit);
    if (inherit) {
      const id = this.selectedNodeId();
      const parentId = id ? (NODE_INDEX.get(id)?.parentId ?? null) : null;
      this.draftPermission.set(parentId ? this.effectivePermission(parentId) : { ...DEFAULT_PERMISSION });
    }
  }

  toggleDraftFlag(key: keyof ResourcePermission): void {
    if (this.draftInherit()) {
      return;
    }
    this.draftPermission.update(current => ({ ...current, [key]: !current[key] }));
  }

  savePermission(): void {
    const id = this.selectedNodeId();
    if (!id) {
      return;
    }
    this.overrides.update(current => {
      const next = { ...current };
      if (this.draftInherit()) {
        delete next[id];
      } else {
        next[id] = { ...this.draftPermission() };
      }
      return next;
    });
  }

  requestRemove(): void {
    this.pendingRemove.set(true);
  }

  confirmRemove(): void {
    const id = this.selectedNodeId();
    if (id) {
      this.overrides.update(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      this.setDraftInherit(true);
    }
    this.pendingRemove.set(false);
  }
}
