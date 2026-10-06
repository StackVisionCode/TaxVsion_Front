import { Injectable, computed, signal } from '@angular/core';
import {
  AccountConnection,
  AccountProviderId,
  AiProviderConnection,
  AiProviderCredentials,
  AiProviderId,
  McpServer,
  McpServerDraft,
  secretHint,
} from './connections.model';

/** Simula la latencia de la futura API para que los estados "busy" de la UI se vean y se prueben. */
const FAKE_LATENCY_MS = 600;

/**
 * Estado de "Connections & MCP". Provisto en la ruta `settings/connections` (se destruye al salir).
 *
 * SOLO FRONT: no hay `connections.service.ts` porque no hay endpoints todavía. Todo vive en estos
 * signals y se pierde al recargar — la página lo dice en un aviso. Cada método público corresponde
 * a una operación de la futura API (connect / update / disconnect / toggle); al conectar el backend
 * se reemplaza el `setTimeout` por la llamada HTTP sin tocar los componentes.
 */
@Injectable()
export class ConnectionsStore {
  readonly aiConnections = signal<AiProviderConnection[]>([]);
  readonly accountConnections = signal<AccountConnection[]>([]);
  readonly mcpServers = signal<McpServer[]>([]);

  /** Id de lo que se está guardando (proveedor, cuenta o servidor), para el spinner de su tarjeta. */
  readonly busyId = signal<string | null>(null);

  readonly connectedCount = computed(
    () =>
      this.aiConnections().length +
      this.accountConnections().length +
      this.mcpServers().length,
  );

  // ---- Proveedores de IA ----

  aiConnectionFor(providerId: AiProviderId): AiProviderConnection | null {
    return this.aiConnections().find(c => c.providerId === providerId) ?? null;
  }

  /** Alta o actualización. Sin `apiKey` en una actualización se conserva la key anterior. */
  saveAiProvider(credentials: AiProviderCredentials, done: () => void): void {
    this.run(credentials.providerId, () => {
      const existing = this.aiConnectionFor(credentials.providerId);
      const next: AiProviderConnection = {
        providerId: credentials.providerId,
        keyHint: credentials.apiKey.trim() ? secretHint(credentials.apiKey) : (existing?.keyHint ?? ''),
        defaultModel: credentials.defaultModel.trim(),
        endpoint: credentials.endpoint.trim(),
        enabled: existing?.enabled ?? true,
        connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      };
      this.aiConnections.update(list => [...list.filter(c => c.providerId !== next.providerId), next]);
      done();
    });
  }

  toggleAiProvider(providerId: AiProviderId, enabled: boolean): void {
    this.run(providerId, () =>
      this.aiConnections.update(list => list.map(c => (c.providerId === providerId ? { ...c, enabled } : c))),
    );
  }

  disconnectAiProvider(providerId: AiProviderId, done: () => void): void {
    this.run(providerId, () => {
      this.aiConnections.update(list => list.filter(c => c.providerId !== providerId));
      done();
    });
  }

  // ---- Cuentas conectadas ----

  accountConnectionFor(providerId: AccountProviderId): AccountConnection | null {
    return this.accountConnections().find(c => c.providerId === providerId) ?? null;
  }

  /** Con backend, esto redirige al consentimiento OAuth del proveedor y vuelve con el callback. */
  connectAccount(providerId: AccountProviderId, allowWrite: boolean, done: () => void): void {
    this.run(providerId, () => {
      const next: AccountConnection = {
        providerId,
        accountLabel: 'Preview connection',
        allowWrite,
        enabled: true,
        connectedAt: new Date().toISOString(),
      };
      this.accountConnections.update(list => [...list.filter(c => c.providerId !== providerId), next]);
      done();
    });
  }

  updateAccountAccess(providerId: AccountProviderId, allowWrite: boolean, done: () => void): void {
    this.run(providerId, () => {
      this.accountConnections.update(list =>
        list.map(c => (c.providerId === providerId ? { ...c, allowWrite } : c)),
      );
      done();
    });
  }

  toggleAccount(providerId: AccountProviderId, enabled: boolean): void {
    this.run(providerId, () =>
      this.accountConnections.update(list => list.map(c => (c.providerId === providerId ? { ...c, enabled } : c))),
    );
  }

  disconnectAccount(providerId: AccountProviderId, done: () => void): void {
    this.run(providerId, () => {
      this.accountConnections.update(list => list.filter(c => c.providerId !== providerId));
      done();
    });
  }

  // ---- Servidores MCP ----

  saveMcpServer(draft: McpServerDraft, done: () => void): void {
    const id = draft.id ?? crypto.randomUUID();
    this.run(id, () => {
      const existing = this.mcpServers().find(s => s.id === id);
      const tokenHint =
        draft.authType !== 'bearer' ? '' : draft.token.trim() ? secretHint(draft.token) : (existing?.tokenHint ?? '');
      const next: McpServer = {
        id,
        name: draft.name.trim(),
        url: draft.url.trim(),
        transport: draft.transport,
        authType: draft.authType,
        tokenHint,
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      this.mcpServers.update(list =>
        existing ? list.map(s => (s.id === id ? next : s)) : [...list, next],
      );
      done();
    });
  }

  toggleMcpServer(id: string, enabled: boolean): void {
    this.run(id, () => this.mcpServers.update(list => list.map(s => (s.id === id ? { ...s, enabled } : s))));
  }

  removeMcpServer(id: string, done: () => void): void {
    this.run(id, () => {
      this.mcpServers.update(list => list.filter(s => s.id !== id));
      done();
    });
  }

  private run(id: string, apply: () => void): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(id);
    setTimeout(() => {
      apply();
      this.busyId.set(null);
    }, FAKE_LATENCY_MS);
  }
}
