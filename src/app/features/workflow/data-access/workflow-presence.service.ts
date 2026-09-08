import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';

/** Se descarta a un compañero que lleve esto sin dar señales (cerró la pestaña sin avisar). */
const STALE_MS = 8_000;
const SWEEP_MS = 2_000;
/** Canal local entre pestañas del mismo navegador. Ver la nota de la clase. */
const CHANNEL = 'tvf.workflow.presence.v1';

/** Paleta de los cursores. Estable por persona: el color identifica, no decora. */
const CURSOR_COLORS = [
  { dot: '#2563eb', pill: 'bg-blue-500' },
  { dot: '#16a34a', pill: 'bg-green-600' },
  { dot: '#db2777', pill: 'bg-pink-600' },
  { dot: '#f59e0b', pill: 'bg-amber-500' },
  { dot: '#7c3aed', pill: 'bg-violet-600' },
  { dot: '#0891b2', pill: 'bg-cyan-600' },
] as const;

export interface PeerCursor {
  userId: string;
  name: string;
  /** Coordenadas del LIENZO, no de pantalla: así el cursor sigue al zoom y al scroll. */
  x: number;
  y: number;
  color: string;
  pill: string;
  seenAt: number;
}

interface CursorMessage {
  type: 'move' | 'leave';
  docId: string;
  userId: string;
  name: string;
  x: number;
  y: number;
}

/**
 * Cursores en vivo de quien está mirando el mismo workflow.
 *
 * TRANSPORTE: hoy `BroadcastChannel`, o sea **entre pestañas del mismo navegador**. No es
 * un capricho: el socket de Communication solo enruta `chat.*`, `call.*`, `notification.*`
 * y `session.*` — no existe un evento de workflow que el servidor sepa reenviar, y el
 * workflow tampoco tiene backend propio (vive en localStorage). Emitir por ahí sería
 * mandar mensajes que nadie reparte y pintar una colaboración que no existe.
 *
 * Cuando Communication publique un `workflow.cursor`, esto se cambia sustituyendo
 * `publish`/`subscribe` por `realtime.emitNoAck` / `realtime.on` — el resto de la clase y
 * toda la UI siguen igual, porque ya trabajan contra `peers`.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowPresenceService {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private channel: BroadcastChannel | null = null;
  private sweep: ReturnType<typeof setInterval> | null = null;
  private docId = '';

  private readonly _peers = signal<readonly PeerCursor[]>([]);
  readonly peers = this._peers.asReadonly();
  readonly peerCount = computed(() => this._peers().length);

  constructor() {
    this.destroyRef.onDestroy(() => this.leave());
  }

  /** Entra al documento. Idempotente: volver a llamar con el mismo id no hace nada. */
  join(docId: string): void {
    if (this.channel && this.docId === docId) {
      return;
    }
    this.leave();
    this.docId = docId;
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = event => this.onMessage(event.data as CursorMessage);
    // Un compañero que se va sin avisar (crash, pestaña cerrada de golpe) se cae solo.
    this.sweep = setInterval(() => this.dropStale(), SWEEP_MS);
  }

  leave(): void {
    if (this.sweep !== null) {
      clearInterval(this.sweep);
      this.sweep = null;
    }
    if (this.channel) {
      this.post({ type: 'leave', docId: this.docId, ...this.identity(), x: 0, y: 0 });
      this.channel.close();
      this.channel = null;
    }
    this._peers.set([]);
  }

  /** Publica MI cursor. Se llama ya limitado a un frame desde el lienzo. */
  publish(x: number, y: number): void {
    this.post({ type: 'move', docId: this.docId, ...this.identity(), x, y });
  }

  private identity(): { userId: string; name: string } {
    const me = this.auth.currentUser();
    return {
      userId: me?.id ?? 'anon',
      name: me ? `${me.name} ${me.lastName}`.trim() || me.email : 'Someone',
    };
  }

  private post(message: CursorMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // Un canal ya cerrado no debe romper el arrastre del ratón.
    }
  }

  private onMessage(message: CursorMessage): void {
    if (!message || message.docId !== this.docId || message.userId === this.identity().userId) {
      return;
    }
    if (message.type === 'leave') {
      this._peers.update(peers => peers.filter(p => p.userId !== message.userId));
      return;
    }
    this._peers.update(peers => {
      const color = colorFor(message.userId);
      const next: PeerCursor = {
        userId: message.userId,
        name: message.name,
        x: message.x,
        y: message.y,
        color: color.dot,
        pill: color.pill,
        seenAt: Date.now(),
      };
      const index = peers.findIndex(p => p.userId === message.userId);
      return index === -1
        ? [...peers, next]
        : peers.map((peer, i) => (i === index ? next : peer));
    });
  }

  private dropStale(): void {
    const cutoff = Date.now() - STALE_MS;
    this._peers.update(peers =>
      peers.length === 0 ? peers : peers.filter(p => p.seenAt >= cutoff),
    );
  }
}

/** Mismo usuario, mismo color siempre — sin registro central ni negociación. */
function colorFor(userId: string): (typeof CURSOR_COLORS)[number] {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}
