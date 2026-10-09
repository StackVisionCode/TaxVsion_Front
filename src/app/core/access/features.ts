/**
 * B0 — el mapa ruta → feature → módulo → permissions, congelado como dato.
 *
 * Es SOLO una tabla: no decide nada todavía. B2 le pone encima el `AccessStore`, B3 deriva el menú
 * de acá y B4 el guard. Se separa a propósito — mientras el mapa vive disperso entre el sidebar, el
 * router y cada componente, cada pantalla contesta distinto a la misma pregunta.
 *
 * Reglas del contrato (ver `docs/claude/CONTRATOS_ENTRE_REPOS.md`):
 * - Se pregunta por el CÓDIGO del permission, que es estable. Nunca por nombre de rol.
 * - `anyOf` es un O: con UNO alcanza. Vacío = basta con estar autenticado.
 * - `module` es el del plan de la oficina; `null` = transversal, no depende del plan.
 * - El frontend NO es la barrera: esto oculta y adapta la UI, quien autoriza es el backend.
 */
export interface FeatureDefinition {
  /** Identificador estable de la feature. No es la ruta: el menú y los tests se refieren a este. */
  readonly id: string;
  /**
   * El nombre que ve el usuario, en inglés. Vive acá y no en cada pantalla porque lo usan el menú,
   * la página de "no disponible" y los avisos de plan: con tres copias, dos quedan viejas.
   */
  readonly label: string;
  /** Ruta de primer nivel dentro del shell, sin barra inicial. */
  readonly route: string;
  /** Módulo del plan que la habilita, o `null` si no depende del plan. */
  readonly module: string | null;
  /** Con cualquiera de estos permissions alcanza. Vacío = solo autenticación. */
  readonly anyOf: readonly string[];
}

/**
 * Lo mínimo para preguntar "¿puede usar esto?": el módulo del plan y los permissions. Una feature
 * lo cumple, y también lo cumple algo que NO es una pantalla — un widget del dashboard, una
 * pestaña de un perfil —, que no tiene ruta propia y no puede estar en `FEATURES`.
 */
export type AccessRequirement = Pick<FeatureDefinition, 'module' | 'anyOf'>;

export const FEATURES: readonly FeatureDefinition[] = [
  // ---- Transversales: no dependen del plan ni de un permission ----
  { id: 'dashboard', label: 'Dashboard', route: 'dashboard', module: null, anyOf: [] },
  { id: 'profile', label: 'Profile', route: 'profile', module: null, anyOf: [] },
  { id: 'notifications', label: 'Notifications', route: 'notifications', module: null, anyOf: [] },
  { id: 'settings', label: 'Settings', route: 'settings', module: null, anyOf: [] },
  // El catálogo de planes es público por diseño: hay que poder verlo para poder contratarlo.
  { id: 'plans', label: 'Plans', route: 'plans', module: null, anyOf: [] },
  // Soporte queda exento del gate de módulo a propósito: una oficina con el plan vencido tiene que
  // poder escribirle a soporte, que es justamente cuando más lo necesita.
  { id: 'support', label: 'Support', route: 'support', module: null, anyOf: ['communication.support.open'] },

  // ---- Clientes ----
  { id: 'clients', label: 'Clients', route: 'clients', module: 'customers', anyOf: ['customers.view'] },
  // Subruta de clients con su propio permiso. El backend además exige actor administrativo, y eso
  // no es un permission: lo cubre `ClientPermissions.canImport`, que mira las dos capas.
  {
    id: 'clients-import',
    label: 'Import clients',
    route: 'clients/import',
    module: 'customers',
    anyOf: ['customers.import'],
  },

  // ---- Documentos y archivos ----
  { id: 'documents', label: 'Documents', route: 'documents', module: 'documents', anyOf: ['cloudstorage.file.view'] },
  { id: 'storage', label: 'Storage', route: 'storage', module: 'documents', anyOf: ['cloudstorage.file.view'] },

  // ---- Comunicación: chat, reuniones y correo ----
  {
    id: 'chat',
    label: 'Chat',
    route: 'chat',
    module: 'comms',
    anyOf: ['communication.chat.start', 'communication.chat.reply'],
  },
  {
    // `meetings` y no `comms`: las reuniones se venden aparte (Pro y Enterprise), mientras que chat,
    // llamadas y vídeo van en todos los planes. Espejo de `PermissionModuleMap` en el backend.
    id: 'meetings',
    label: 'Meetings',
    route: 'meetings',
    module: 'meetings',
    anyOf: ['communication.meeting.create', 'communication.meeting.join'],
  },
  {
    id: 'email',
    label: 'Mail',
    route: 'email',
    module: 'email',
    anyOf: ['correspondence.read', 'connectors.accounts.read'],
  },

  // ---- Trabajo diario ----
  { id: 'task', label: 'Task', route: 'task', module: 'planner', anyOf: ['tasks.read'] },
  {
    id: 'signature',
    label: 'Signature',
    route: 'signature',
    module: 'signatures',
    anyOf: ['signature.request.read'],
  },
  { id: 'campaigns', label: 'Campaigns', route: 'campaigns', module: 'campaigns', anyOf: ['campaigns.view'] },
  // SMS no es un módulo del plan: se cobra aparte por consumo.
  { id: 'sms', label: 'SMS', route: 'sms', module: null, anyOf: ['sms.read'] },

  // ---- Catálogo e inventario ----
  { id: 'catalog', label: 'Products/Services', route: 'products-services', module: null, anyOf: ['catalog.read'] },
  { id: 'inventory', label: 'Inventory', route: 'inventory', module: null, anyOf: ['inventory.read'] },

  // ---- Dinero ----
  { id: 'billing', label: 'Billing', route: 'billing', module: null, anyOf: ['invoicing.view'] },
  // El monedero se cobra por consumo (como SMS): transversal, no depende del módulo del plan.
  { id: 'wallet', label: 'Wallet', route: 'wallet', module: null, anyOf: ['wallet.view'] },

  // ---- Administración de la oficina ----
  { id: 'users', label: 'Users', route: 'company/users', module: null, anyOf: ['users.view'] },
  {
    id: 'company-settings',
    label: 'Company settings',
    route: 'company/settings',
    module: null,
    anyOf: ['settings.manage', 'branding.manage'],
  },
  { id: 'templates', label: 'Templates', route: 'templates', module: null, anyOf: ['notification.template.view'] },
  { id: 'referrals', label: 'Referrals', route: 'referrals', module: null, anyOf: ['referrals.own.read'] },

  // ---- Sin backend todavía ----
  // El constructor de flujos no tiene servicio detrás; se deja mapeado para que el inventario esté
  // completo, pero su módulo no existe en ningún plan, así que B4 lo tratará como no disponible.
  { id: 'workflow', label: 'Workflow', route: 'workflow', module: 'builder', anyOf: [] },
  { id: 'ai-assistant', label: 'AI', route: 'ai-assistant', module: null, anyOf: [] },
];

/** Rutas del shell que NO son una feature y por eso no aparecen arriba. */
export const NON_FEATURE_ROUTES: readonly string[] = [
  // Redirección a /billing que se conserva por enlaces guardados; la página vieja se retiró.
  'invoices',
  // Avisos de acceso (B4). No son features: son la pantalla a la que el guard MANDA, y gatearlas
  // sería un bucle.
  'forbidden',
  'not-available',
  'error',
];

export function featureByRoute(route: string): FeatureDefinition | undefined {
  return FEATURES.find(feature => feature.route === route);
}

/**
 * Por id. El menú y la grilla de settings declaran QUÉ feature es cada entrada, no su ruta: la
 * ruta de una entrada puede ser una subpágina (`/signature/templates`) de la misma feature.
 */
export function featureById(id: string): FeatureDefinition | undefined {
  return FEATURES.find(feature => feature.id === id);
}

/**
 * La feature de una URL del shell. Se busca por prefijo de segmento porque una pantalla puede tener
 * subrutas (`/clients/123`, `/signature/templates`) y el más específico gana — `company/users` no
 * puede resolverse como `company`.
 */
export function featureForUrl(url: string): FeatureDefinition | undefined {
  const path = url.split('?')[0].split('#')[0].replace(/^\/+/, '');
  return FEATURES.filter(feature => path === feature.route || path.startsWith(feature.route + '/')).sort(
    (a, b) => b.route.length - a.route.length,
  )[0];
}

/**
 * El nombre que ve el usuario para cada módulo del plan. Los códigos (`comms`, `planner`) son
 * internos: decirle a alguien "the comms module is not in your plan" le pide adivinar qué
 * contratar. `comms` es **Client communication**, que es como se llama en los planes.
 *
 * Un código desconocido cae a sí mismo: un módulo nuevo en el backend no puede dejar la frase
 * incompleta.
 */
const MODULE_LABELS: Readonly<Record<string, string>> = {
  comms: 'Client chat and calls',
  meetings: 'Video meetings',
  customers: 'Clients',
  documents: 'Documents',
  email: 'Mail',
  planner: 'Tasks and calendar',
  signatures: 'E-signature',
  campaigns: 'Campaigns',
  reports: 'Reports',
};

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}
