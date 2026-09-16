import { PermissionInfo, UserAccessModule } from '../../data-access/user-management.model';

/** Outline-icon key for a module header. Falls back to 'default' for unmapped modules. */
export type AccessModuleIcon =
  | 'clients'
  | 'tasks'
  | 'communication'
  | 'billing'
  | 'catalog'
  | 'documents'
  | 'storage'
  | 'notes'
  | 'calendar'
  | 'reminder'
  | 'users'
  | 'mail'
  | 'default';

/** One permission row in the drawer. `locked` = the user's roles don't grant it (shown greyed, not toggleable). */
export interface AccessRow {
  permissionId: string;
  code: string;
  label: string;
  description: string;
  locked: boolean;
}

/** One module accordion: a friendly header + its granted (toggleable) and locked rows. */
export interface AccessModuleView {
  key: string;
  label: string;
  description: string;
  icon: AccessModuleIcon;
  rows: AccessRow[];
}

interface ModuleMeta {
  label: string;
  description: string;
  icon: AccessModuleIcon;
}

/**
 * Friendly English labels/descriptions/icons for the modules a firm's staff sees. Keyed by the backend
 * module key (lower-cased). Unmapped modules fall back to a title-cased key with a neutral icon, so a
 * new backend module still renders sensibly without a code change here.
 */
const MODULE_META: Record<string, ModuleMeta> = {
  customers: { label: 'Clients', description: 'Client directory, records and data', icon: 'clients' },
  clients: { label: 'Clients', description: 'Client directory, records and data', icon: 'clients' },
  tasks: { label: 'Tasks', description: 'Create, assign and close tasks', icon: 'tasks' },
  communication: { label: 'Communication', description: 'Email, chat and client meetings', icon: 'communication' },
  comms: { label: 'Communication', description: 'Email, chat and client meetings', icon: 'communication' },
  email: { label: 'Communication', description: 'Email, chat and client meetings', icon: 'communication' },
  support: { label: 'Support', description: 'Support tickets and agent queue', icon: 'communication' },
  campaigns: { label: 'Campaigns', description: 'Email campaigns and audiences', icon: 'mail' },
  billing: { label: 'Billing', description: 'Invoices, payments and receipts', icon: 'billing' },
  subscription: { label: 'Subscription', description: 'Plan and subscription', icon: 'billing' },
  catalog: { label: 'Products & services', description: "The firm's service catalog", icon: 'catalog' },
  inventory: { label: 'Inventory', description: 'Stock, items and suppliers', icon: 'catalog' },
  codes: { label: 'Activation codes', description: 'Growth and activation codes', icon: 'catalog' },
  documents: { label: 'Documents', description: 'Files, sharing and e-signature', icon: 'documents' },
  storage: { label: 'Files & storage', description: 'Files and folders', icon: 'storage' },
  cloudstorage: { label: 'Files & storage', description: 'Files, folders and secure uploads', icon: 'storage' },
  signature: { label: 'Signatures', description: 'E-signature requests and templates', icon: 'documents' },
  signatures: { label: 'Signatures', description: 'E-signature requests and templates', icon: 'documents' },
  reports: { label: 'Reports', description: 'Reporting and analytics', icon: 'catalog' },
  notes: { label: 'Notes', description: 'Client notes and attachments', icon: 'notes' },
  calendar: { label: 'Calendar', description: 'Appointments and availability', icon: 'calendar' },
  reminder: { label: 'Reminders', description: 'Scheduled reminders', icon: 'reminder' },
  reminders: { label: 'Reminders', description: 'Scheduled reminders', icon: 'reminder' },
  users: { label: 'Team', description: 'Staff, roles and invitations', icon: 'users' },
  roles: { label: 'Roles & access', description: 'Roles and permissions', icon: 'users' },
  settings: { label: 'Settings', description: 'Workspace settings', icon: 'users' },
  tenant: { label: 'Workspace', description: 'Workspace and organization', icon: 'users' },
  audit: { label: 'Audit log', description: 'Security and activity audit', icon: 'notes' },
  onboarding: { label: 'Onboarding', description: 'Sign-up and onboarding', icon: 'users' },
  mail: { label: 'Mail', description: 'Mailboxes and messages', icon: 'mail' },
  connectors: { label: 'Mail', description: 'Connected mailboxes', icon: 'mail' },
  portal: { label: 'Client portal', description: 'What clients see in their portal', icon: 'clients' },
};

/** Nicer English verbs for the action segment of a permission code (the last segment). */
const ACTION_VERBS: Record<string, string> = {
  view: 'View',
  read: 'View',
  list: 'View',
  create: 'Create',
  add: 'Add',
  edit: 'Edit',
  update: 'Update',
  delete: 'Delete',
  remove: 'Remove',
  manage: 'Manage',
  send: 'Send',
  export: 'Export',
  import: 'Import',
  assign: 'Assign',
  start: 'Start',
  join: 'Join',
  download: 'Download',
  upload: 'Upload',
  share: 'Share',
  void: 'Void',
  cancel: 'Cancel',
  activate: 'Activate',
  deactivate: 'Deactivate',
  invite: 'Invite',
  approve: 'Approve',
  reject: 'Reject',
  archive: 'Archive',
  restore: 'Restore',
  reopen: 'Reopen',
  close: 'Close',
  pay: 'Pay',
  refund: 'Refund',
};

function metaFor(key: string): ModuleMeta {
  return MODULE_META[key.toLowerCase()] ?? { label: titleCase(key), description: '', icon: 'default' };
}

function titleCase(key: string): string {
  const words = key.replace(/[._-]+/g, ' ').trim();
  return words.replace(/\b\w/g, character => character.toUpperCase()) || key;
}

/**
 * A human, English label derived from the permission CODE (e.g. `cloudstorage.file.download` →
 * "Download file", `customers.view` → "View customers"). The backend `description` is not used here
 * because it is authored in Spanish; the code is the stable, language-neutral source. The last segment
 * is the action (verb), the segments before it are the object (the module prefix is dropped when there
 * is a more specific object).
 */
function labelFromCode(code: string): string {
  const parts = code.split('.').filter(Boolean);
  if (parts.length === 0) {
    return code;
  }
  const action = parts[parts.length - 1];
  const objectParts = parts.slice(0, -1);
  const objectWords = objectParts.length >= 2 ? objectParts.slice(1) : objectParts;
  const object = objectWords.join(' ').replace(/_/g, ' ').trim();
  const verb = ACTION_VERBS[action] ?? titleCase(action);
  return object ? `${verb} ${object}` : verb;
}

/**
 * Builds the drawer's module views by merging the user's role-GRANTED permissions (toggleable) with the
 * catalog permissions no role grants (shown locked, "not in her roles"), within the same module. Only
 * modules where the user already has at least one granted permission appear; only catalog permissions
 * valid for the seat's actor type become locked rows (staff seats see staff permissions, portal seats
 * see portal permissions). Rows are ordered granted-first then by code; modules keep the server's order.
 */
export function buildAccessView(
  grantedModules: readonly UserAccessModule[],
  catalog: readonly PermissionInfo[],
  actorType: string,
): AccessModuleView[] {
  const isPortalSeat = actorType === 'CustomerPortal';

  const grantedIds = new Set<string>();
  for (const module of grantedModules) {
    for (const permission of module.permissions) {
      grantedIds.add(permission.permissionId);
    }
  }

  const lockedByModule = new Map<string, PermissionInfo[]>();
  for (const permission of catalog) {
    if (permission.isCustomerPortal !== isPortalSeat || grantedIds.has(permission.id)) {
      continue;
    }
    const list = lockedByModule.get(permission.module) ?? [];
    list.push(permission);
    lockedByModule.set(permission.module, list);
  }

  return grantedModules.map(module => {
    const granted: AccessRow[] = module.permissions
      .map(permission => ({
        permissionId: permission.permissionId,
        code: permission.code,
        label: labelFromCode(permission.code),
        description: permission.description,
        locked: false,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const locked: AccessRow[] = (lockedByModule.get(module.module) ?? [])
      .map(permission => ({
        permissionId: permission.id,
        code: permission.code,
        label: labelFromCode(permission.code),
        description: permission.description,
        locked: true,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const meta = metaFor(module.module);
    return { key: module.module, label: meta.label, description: meta.description, icon: meta.icon, rows: [...granted, ...locked] };
  });
}
