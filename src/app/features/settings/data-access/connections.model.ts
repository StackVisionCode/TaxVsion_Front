/**
 * Tipos y catálogo de "Connections & MCP" (Settings → conexiones de terceros para la IA).
 *
 * SOLO FRONT: todavía no existe backend para esto. El catálogo (qué proveedores / cuentas se
 * pueden conectar) es dato fijo del front; el estado de cada conexión vive en memoria en
 * `ConnectionsStore` y se pierde al recargar. Cuando exista la API, el store cambia sus métodos
 * por llamadas HTTP y estos tipos pasan a ser los DTO mapeados.
 *
 * Nunca se guarda ni se muestra el secreto completo: solo una pista (`••••1234`), igual que hará
 * el backend.
 */

// ---- Proveedores de IA (API key) ----

export type AiProviderId = 'anthropic' | 'openai' | 'google-gemini' | 'azure-openai';

export interface AiProviderDefinition {
  id: AiProviderId;
  name: string;
  description: string;
  icon: string;
  circleClass: string;
  /** Prefijo orientativo de la key, solo para el placeholder. */
  keyPlaceholder: string;
  /** Modelo sugerido como placeholder del campo "Default model". */
  modelPlaceholder: string;
  /** Azure exige el endpoint del recurso; el resto usa el endpoint público del proveedor. */
  requiresEndpoint: boolean;
  docsUrl: string;
}

export interface AiProviderConnection {
  providerId: AiProviderId;
  /** Pista de la key (últimos 4), nunca la key completa. */
  keyHint: string;
  defaultModel: string;
  endpoint: string;
  enabled: boolean;
  connectedAt: string;
}

/** Lo que emite el formulario de API key. */
export interface AiProviderCredentials {
  providerId: AiProviderId;
  apiKey: string;
  defaultModel: string;
  endpoint: string;
}

export const AI_PROVIDERS: readonly AiProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models for drafting, summaries and document review.',
    icon: 'sparkles-outline',
    circleClass: 'bg-orange-50 text-orange-500',
    keyPlaceholder: 'sk-ant-…',
    modelPlaceholder: 'claude-sonnet-5-5',
    requiresEndpoint: false,
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models for chat, extraction and classification.',
    icon: 'hardware-chip-outline',
    circleClass: 'bg-gray-200 text-gray-700',
    keyPlaceholder: 'sk-…',
    modelPlaceholder: 'Provider default',
    requiresEndpoint: false,
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'Gemini models through Google AI Studio.',
    icon: 'logo-google',
    circleClass: 'bg-indigo-100 text-indigo-600',
    keyPlaceholder: 'AIza…',
    modelPlaceholder: 'Provider default',
    requiresEndpoint: false,
    docsUrl: 'https://ai.google.dev',
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'OpenAI models hosted in your own Azure tenant.',
    icon: 'logo-microsoft',
    circleClass: 'bg-indigo-100 text-brand-bold',
    keyPlaceholder: 'Azure resource key',
    modelPlaceholder: 'Deployment name',
    requiresEndpoint: true,
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
  },
];

// ---- Cuentas conectadas (OAuth) ----

export type AccountProviderId = 'google-workspace' | 'microsoft-365' | 'dropbox' | 'slack' | 'quickbooks';

export interface AccountProviderDefinition {
  id: AccountProviderId;
  name: string;
  description: string;
  icon: string;
  circleClass: string;
  /** Qué podrá leer/hacer el asistente con la cuenta (se muestra antes de conectar). */
  scopes: readonly string[];
}

export interface AccountConnection {
  providerId: AccountProviderId;
  /** Etiqueta de la cuenta. Sin OAuth real no hay e-mail: se muestra como vista previa. */
  accountLabel: string;
  /** El asistente puede escribir (crear borradores, subir archivos) además de leer. */
  allowWrite: boolean;
  enabled: boolean;
  connectedAt: string;
}

export const ACCOUNT_PROVIDERS: readonly AccountProviderDefinition[] = [
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Drive, Gmail and Calendar as context for the assistant.',
    icon: 'logo-google',
    circleClass: 'bg-indigo-100 text-indigo-600',
    scopes: ['Read files in Google Drive', 'Search Gmail messages', 'Read Calendar events'],
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    description: 'OneDrive, Outlook and Teams as context for the assistant.',
    icon: 'logo-microsoft',
    circleClass: 'bg-indigo-100 text-brand-bold',
    scopes: ['Read files in OneDrive and SharePoint', 'Search Outlook mail', 'Read Outlook calendar'],
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Let the assistant find and read client documents.',
    icon: 'logo-dropbox',
    circleClass: 'bg-indigo-50 text-indigo-600',
    scopes: ['Read files and folders', 'Search file contents'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Ask the assistant from Slack and search team channels.',
    icon: 'logo-slack',
    circleClass: 'bg-indigo-50 text-orange-500',
    scopes: ['Read messages in public channels', 'Post replies from the assistant'],
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    description: 'Books, invoices and reports for financial questions.',
    icon: 'calculator-outline',
    circleClass: 'bg-gray-200 text-gray-700',
    scopes: ['Read company financials', 'Read invoices and customers'],
  },
];

// ---- Servidores MCP ----

/** Transportes remotos. `stdio` no aplica: la app es web y no lanza procesos locales. */
export type McpTransport = 'http' | 'sse';
export type McpAuthType = 'none' | 'bearer' | 'oauth';

export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  /** Pista del token si `authType === 'bearer'`. */
  tokenHint: string;
  enabled: boolean;
  createdAt: string;
}

/** Lo que emite el formulario de servidor MCP. `token` vacío al editar = conservar el actual. */
export interface McpServerDraft {
  id: string | null;
  name: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  token: string;
}

export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  http: 'Streamable HTTP',
  sse: 'SSE',
};

export const MCP_AUTH_LABELS: Record<McpAuthType, string> = {
  none: 'No auth',
  bearer: 'Bearer token',
  oauth: 'OAuth',
};

/** `••••1234` a partir de un secreto. Nunca devuelve el secreto. */
export function secretHint(secret: string): string {
  const trimmed = secret.trim();
  return trimmed ? `••••${trimmed.slice(-4)}` : '';
}

/** Solo URLs https (o http a localhost, para desarrollo). */
export function isValidMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'https:') {
      return true;
    }
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}
