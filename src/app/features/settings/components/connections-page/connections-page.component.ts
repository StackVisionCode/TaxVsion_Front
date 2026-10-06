import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ConnectionsStore } from '../../data-access/connections.store';
import {
  ACCOUNT_PROVIDERS,
  AI_PROVIDERS,
  AccountProviderDefinition,
  AiProviderCredentials,
  AiProviderDefinition,
  McpServer,
  McpServerDraft,
} from '../../data-access/connections.model';
import { ConnectionCardComponent } from '../../ui/connection-card/connection-card.component';
import { AiProviderFormComponent } from '../../ui/ai-provider-form/ai-provider-form.component';
import { AccountConnectFormComponent } from '../../ui/account-connect-form/account-connect-form.component';
import { McpServerFormComponent } from '../../ui/mcp-server-form/mcp-server-form.component';
import { McpServerListComponent } from '../../ui/mcp-server-list/mcp-server-list.component';

type ConnectionsTab = 'ai' | 'accounts' | 'mcp';

/** Qué se está editando en el drawer. */
type DrawerTarget =
  | { kind: 'ai'; provider: AiProviderDefinition }
  | { kind: 'account'; provider: AccountProviderDefinition }
  | { kind: 'mcp'; server: McpServer | null };

/** Qué se está por desconectar en el diálogo de confirmación. */
type DisconnectTarget =
  | { kind: 'ai'; provider: AiProviderDefinition }
  | { kind: 'account'; provider: AccountProviderDefinition }
  | { kind: 'mcp'; server: McpServer };

/**
 * Settings → Connections & MCP: conexiones de terceros que usa la IA.
 * - AI providers: API keys propias de la firma (Anthropic, OpenAI, Gemini, Azure OpenAI).
 * - Connected accounts: cuentas OAuth que el asistente usa como contexto (Drive, Outlook, Slack…).
 * - MCP servers: servidores Model Context Protocol remotos con herramientas extra.
 *
 * SOLO FRONT: `ConnectionsStore` guarda todo en memoria (ver su cabecera). La página lo avisa
 * arriba para que nadie crea que la key quedó guardada.
 */
@Component({
  selector: 'app-connections-page',
  imports: [
    RouterLink,
    DrawerComponent,
    ConfirmDialogComponent,
    SegmentedComponent,
    ConnectionCardComponent,
    AiProviderFormComponent,
    AccountConnectFormComponent,
    McpServerFormComponent,
    McpServerListComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './connections-page.component.html',
})
export class ConnectionsPageComponent {
  readonly store = inject(ConnectionsStore);
  private readonly toast = inject(ToastService);

  readonly aiProviders = AI_PROVIDERS;
  readonly accountProviders = ACCOUNT_PROVIDERS;

  readonly tab = signal<ConnectionsTab>('ai');
  readonly drawer = signal<DrawerTarget | null>(null);
  readonly pendingDisconnect = signal<DisconnectTarget | null>(null);

  readonly tabOptions = computed<SegmentedOption<ConnectionsTab>[]>(() => [
    { id: 'ai', label: this.withCount('AI providers', this.store.aiConnections().length) },
    { id: 'accounts', label: this.withCount('Connected accounts', this.store.accountConnections().length) },
    { id: 'mcp', label: this.withCount('MCP servers', this.store.mcpServers().length) },
  ]);

  readonly drawerHeading = computed(() => {
    const target = this.drawer();
    if (!target) {
      return '';
    }
    if (target.kind === 'mcp') {
      return target.server ? `Edit ${target.server.name}` : 'Add MCP server';
    }
    const connected =
      target.kind === 'ai'
        ? !!this.store.aiConnectionFor(target.provider.id)
        : !!this.store.accountConnectionFor(target.provider.id);
    return `${connected ? 'Manage' : 'Connect'} ${target.provider.name}`;
  });

  readonly drawerSubheading = computed(() => {
    const target = this.drawer();
    if (!target) {
      return '';
    }
    if (target.kind === 'mcp') {
      return 'A remote server that exposes tools and data to the assistant.';
    }
    return target.provider.description;
  });

  readonly disconnectName = computed(() => {
    const target = this.pendingDisconnect();
    return target ? this.nameOf(target) : '';
  });

  // ---- Detalle de las tarjetas ----

  aiMeta(provider: AiProviderDefinition): string[] {
    const connection = this.store.aiConnectionFor(provider.id);
    if (!connection) {
      return [];
    }
    const lines = [`Key ${connection.keyHint}`];
    if (connection.defaultModel) {
      lines.push(`${provider.requiresEndpoint ? 'Deployment' : 'Model'}: ${connection.defaultModel}`);
    }
    if (connection.endpoint) {
      lines.push(connection.endpoint);
    }
    return lines;
  }

  accountMeta(provider: AccountProviderDefinition): string[] {
    const connection = this.store.accountConnectionFor(provider.id);
    if (!connection) {
      return [];
    }
    return [connection.accountLabel, connection.allowWrite ? 'Read & write access' : 'Read-only access'];
  }

  // ---- Drawer ----

  closeDrawer(): void {
    if (!this.store.busyId()) {
      this.drawer.set(null);
    }
  }

  saveAiProvider(credentials: AiProviderCredentials, provider: AiProviderDefinition): void {
    const isNew = !this.store.aiConnectionFor(provider.id);
    this.store.saveAiProvider(credentials, () => {
      this.drawer.set(null);
      this.toast.success(isNew ? `${provider.name} connected.` : `${provider.name} updated.`);
    });
  }

  saveAccount(allowWrite: boolean, provider: AccountProviderDefinition): void {
    if (this.store.accountConnectionFor(provider.id)) {
      this.store.updateAccountAccess(provider.id, allowWrite, () => {
        this.drawer.set(null);
        this.toast.success(`${provider.name} access updated.`);
      });
      return;
    }
    this.store.connectAccount(provider.id, allowWrite, () => {
      this.drawer.set(null);
      this.toast.success(`${provider.name} connected.`);
    });
  }

  saveMcpServer(draft: McpServerDraft): void {
    this.store.saveMcpServer(draft, () => {
      this.drawer.set(null);
      this.toast.success(draft.id ? `${draft.name.trim()} updated.` : `${draft.name.trim()} added.`);
    });
  }

  // ---- Desconectar ----

  confirmDisconnect(): void {
    const target = this.pendingDisconnect();
    if (!target) {
      return;
    }
    const done = () => {
      this.pendingDisconnect.set(null);
      this.toast.success(`${this.nameOf(target)} ${target.kind === 'mcp' ? 'removed' : 'disconnected'}.`);
    };
    if (target.kind === 'ai') {
      this.store.disconnectAiProvider(target.provider.id, done);
    } else if (target.kind === 'account') {
      this.store.disconnectAccount(target.provider.id, done);
    } else {
      this.store.removeMcpServer(target.server.id, done);
    }
  }

  private nameOf(target: DisconnectTarget): string {
    return target.kind === 'mcp' ? target.server.name : target.provider.name;
  }

  private withCount(label: string, count: number): string {
    return count > 0 ? `${label} · ${count}` : label;
  }
}
