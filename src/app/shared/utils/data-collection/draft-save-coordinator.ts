import { canonicalJson } from './canonical-json';
import type { FormAnswers, RepeaterRow } from './form-answers.model';
import { isRecord } from './properties';

export type DraftSaveStatus =
  'idle' | 'saving' | 'queued' | 'conflict' | 'conflict-resolved' | 'error';

export type ConflictChoice = 'local' | 'remote';

/** `answers` es el documento: respuestas, o la definición en el builder (P-6.2). */
export interface DraftSnapshot<T = FormAnswers> {
  answers: T;
  rowVersion: string;
}

export type DraftSaveResult =
  | { outcome: 'saved'; rowVersion: string }
  | { outcome: 'conflict' }
  | { outcome: 'error'; error: unknown };

/** Qué toca un conflicto: el componente, la fila completa o el campo dentro de la fila. */
export interface DraftConflictTarget {
  path: string;
  kind: DraftConflict['kind'];
  /** Componente; en una fila completa, la sección repetible. */
  componentId: string;
  /** Sección repetible cuando la ruta es una fila o un campo de fila. */
  sectionId: string | null;
  rowId: string | null;
  /** Posición (base 0) de la fila en la versión local o remota, para "Row 2". */
  rowIndex: number | null;
}

export interface DraftConflict {
  id: string;
  path: string;
  kind: 'value' | 'row-delete-edit' | 'attachment-delete-retain';
  componentId: string;
  sectionId: string | null;
  rowId: string | null;
  rowIndex: number | null;
  /** Nombre legible (de `labelFor`); sin resolutor es el id del componente. */
  label: string;
  /** Valores sin referencias sensibles: el taxId solo lleva `kind` y `last4`; ausente = `undefined`. */
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
  baseDisplayValue: unknown;
  localDisplayValue: unknown;
  remoteDisplayValue: unknown;
}

export interface DraftSaveState<T = FormAnswers> {
  status: DraftSaveStatus;
  answers: T;
  rowVersion: string;
  changedPaths: readonly string[];
  conflicts: readonly DraftConflict[];
  error: unknown | null;
  readOnly: boolean;
  otherTabOpen: boolean;
  /** Hay una petición en vuelo (guardado, carga tras 409 u operación exclusiva). */
  busy: boolean;
}

export interface ReadonlyState<T> {
  readonly value: T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface DraftKeepalivePayload<T = FormAnswers> extends DraftSnapshot<T> {}

/** Resultado de una operación de servidor serializada con el guardado (subida, taxId, consentimiento…). */
export interface DraftExclusiveResult<T> {
  value: T;
  /** RowVersion nuevo si la operación lo cambió sin tocar las respuestas. */
  rowVersion?: string | null;
  /** Snapshot completo del servidor leído en la operación; se adopta como `adoptServerSnapshot`. */
  snapshot?: DraftSnapshot<unknown> | null;
}

export interface DraftBroadcastChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export interface DraftLifecycleDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface DraftLifecycleWindow {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

export interface DraftLifecycle {
  document: DraftLifecycleDocument;
  window: DraftLifecycleWindow;
}

export interface DraftSaveCoordinatorOptions<T = FormAnswers> {
  initial: DraftSnapshot<T>;
  requestId: string;
  save: (answers: T, rowVersion: string) => Promise<DraftSaveResult>;
  load: () => Promise<DraftSnapshot<T>>;
  saveKeepalive?: (payload: DraftKeepalivePayload<T>) => void;
  /** Forma del documento. Por defecto, las respuestas (`FormAnswers`); el builder pasa su modelo. */
  model?: DraftDocumentModel<T>;
  /** Etiqueta legible de un conflicto (ver `createDefinitionConflictLabeler`). */
  labelFor?: (target: DraftConflictTarget) => string | null | undefined;
  debounceMs?: number;
  keepaliveMaxBytes?: number;
  lifecycle?: DraftLifecycle | null;
  channelFactory?: ((name: string) => DraftBroadcastChannel) | null;
  tabId?: string;
  openedAt?: number;
}

/** Marca tomada antes de leer del servidor (ver `beginServerRead`). */
export interface DraftServerReadToken {
  readonly generation: number;
}

/** Conflicto interno de una fusión; `DRAFT_MISSING` marca un lado donde el elemento no existe. */
export interface DraftRawConflict {
  id: string;
  path: string;
  kind: DraftConflict['kind'];
  base: DraftMergeValue;
  local: DraftMergeValue;
  remote: DraftMergeValue;
  target?: DraftConflictTarget;
}

type RawConflict = DraftRawConflict;

export interface DraftMergeResult<T> {
  value: T;
  conflicts: DraftRawConflict[];
}

/**
 * Operaciones que dependen de la forma del documento: respuestas (por defecto) o la definición del
 * builder (`DEFINITION_DRAFT_MODEL`, rutas por id de página, sección y componente).
 */
export interface DraftDocumentModel<T> {
  changedPaths(base: T, local: T): Set<string>;
  merge(base: T, local: T, remote: T): DraftMergeResult<T>;
  apply(document: T, path: string, value: DraftMergeValue): T;
  /** `documents` en orden de preferencia para ubicar el elemento (local, remota, base). */
  target(conflict: DraftRawConflict, documents: readonly T[]): DraftConflictTarget;
}

interface PresenceMessage {
  scope: 'dc-form-presence-v1';
  requestId: string;
  senderId: string;
  openedAt: number;
  type: 'probe' | 'presence' | 'claim' | 'release' | 'leave';
}

/** Marca de "no existe" en las fusiones de un `DraftDocumentModel`. */
export const DRAFT_MISSING: unique symbol = Symbol('missing');
export type DraftMergeValue = unknown;
const MISSING: typeof DRAFT_MISSING = DRAFT_MISSING;
type MergeValue = DraftMergeValue;

export class DraftSaveConflictPendingError extends Error {
  constructor() {
    super('Draft conflicts must be resolved before saving.');
    this.name = 'DraftSaveConflictPendingError';
  }
}

export class DraftSaveFailedError extends Error {
  constructor(override readonly cause: unknown) {
    super('The draft could not be saved.');
    this.name = 'DraftSaveFailedError';
  }
}

export class DraftSaveRepeatedConflictError extends Error {
  constructor() {
    super('The draft changed again during the automatic conflict retry.');
    this.name = 'DraftSaveRepeatedConflictError';
  }
}

/** La pestaña está en solo lectura o el coordinador ya se destruyó. */
export class DraftSaveInactiveError extends Error {
  constructor(reason: 'read-only' | 'disposed') {
    super(
      reason === 'read-only'
        ? 'This draft is read-only in this tab.'
        : 'The draft save coordinator is disposed.',
    );
    this.name = 'DraftSaveInactiveError';
  }
}

export class DraftSaveCoordinator<T = FormAnswers> {
  readonly state$: ReadonlyState<DraftSaveState<T>>;

  private readonly model: DraftDocumentModel<T>;
  private readonly stateChannel: StateChannel<DraftSaveState<T>>;
  private readonly debounceMs: number;
  private readonly keepaliveMaxBytes: number;
  private readonly lifecycle: DraftLifecycle | null;
  private readonly channel: DraftBroadcastChannel | null;
  private readonly tabId: string;
  private readonly openedAt: number;
  private base: T;
  private local: T;
  private rowVersion: string;
  private changedPaths = new Set<string>();
  private rawConflicts: RawConflict[] = [];
  private conflictCandidate: T | null = null;
  // Cola única: guardados y operaciones exclusivas salen de a uno (regla 1 de P-5.3-bis).
  private queue: Promise<void> = Promise.resolve();
  private pendingFlush: Promise<void> | null = null;
  private inFlight = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readOnly = false;
  // Sube con cada versión confirmada o adoptada: descarta snapshots leídos antes de ella.
  private confirmations = 0;
  private otherTabOpen = false;
  // Pestañas vistas por el canal; una que se va (release o leave) sale del conjunto.
  private readonly otherTabs = new Set<string>();

  private readonly visibilityListener = (): void => {
    if (this.lifecycle?.document.visibilityState === 'hidden') void this.handleBlur();
  };

  private readonly pageHideListener = (): void => {
    this.handlePageHide();
    // Al cerrar la pestaña con el control se avisa a las demás para que lo retomen (regla 7). Esta
    // queda en solo lectura: si vuelve del bfcache, "Use it here" recupera el control.
    if (this.disposed || this.channel == null) return;
    if (this.readOnly) {
      this.postPresence('leave');
      return;
    }
    this.readOnly = true;
    this.otherTabOpen = true;
    this.postPresence('release');
    this.emit(this.stateChannel.value.status);
  };

  private readonly channelListener = (event: MessageEvent<unknown>): void => {
    this.handleChannelMessage(event.data);
  };

  constructor(private readonly options: DraftSaveCoordinatorOptions<T>) {
    this.model = options.model ?? (ANSWERS_MODEL as unknown as DraftDocumentModel<T>);
    this.base = clone(options.initial.answers);
    this.local = clone(options.initial.answers);
    this.rowVersion = options.initial.rowVersion;
    this.debounceMs = options.debounceMs ?? 5_000;
    this.keepaliveMaxBytes = options.keepaliveMaxBytes ?? 60_000;
    this.tabId = options.tabId ?? createTabId();
    this.openedAt = options.openedAt ?? Date.now();
    this.lifecycle = options.lifecycle === undefined ? browserLifecycle() : options.lifecycle;
    this.channel = createChannel(options.requestId, options.channelFactory);
    this.stateChannel = new StateChannel(this.createState('idle'));
    this.state$ = this.stateChannel;
    this.attachBrowserSignals();
  }

  get snapshot(): DraftSaveState<T> {
    return this.stateChannel.value;
  }

  /**
   * Última versión confirmada por el servidor. Sirve de `initial` a un coordinador nuevo (p. ej. tras
   * renovar la sesión) para que lo escrito se fusione en tres vías en vez de pisar cambios remotos.
   */
  get confirmed(): DraftSnapshot<T> {
    return { answers: clone(this.base), rowVersion: this.rowVersion };
  }

  /** Se puede editar: activo, con el control de la pestaña y sin conflictos pendientes. */
  get canEdit(): boolean {
    return !this.disposed && !this.readOnly && this.rawConflicts.length === 0;
  }

  /**
   * Registra un cambio. Devuelve `false` (sin lanzar) si la pestaña no puede editar: solo lectura,
   * conflicto pendiente o coordinador destruido. Una ruta no admitida sí lanza: es un error de código.
   */
  notifyChange(path: string, value: unknown): boolean {
    if (!this.canEdit) return false;
    this.local = applyChange(this.model, this.local, path, value);
    this.changedPaths = this.model.changedPaths(this.base, this.local);
    if (this.changedPaths.size === 0) {
      this.clearDebounce();
      this.emit(this.inFlight > 0 ? 'saving' : 'idle');
      return true;
    }
    if (this.inFlight === 0) this.emit('queued');
    else this.emit(this.stateChannel.value.status);
    this.scheduleDebounce();
    return true;
  }

  /**
   * Reemplaza el documento local completo (el builder produce la definición entera en cada edición).
   * Mismas reglas que `notifyChange`: `false` si la pestaña no puede editar.
   */
  notifyDocument(document: T): boolean {
    if (!this.canEdit) return false;
    this.local = clone(document);
    this.changedPaths = this.model.changedPaths(this.base, this.local);
    if (this.changedPaths.size === 0) {
      this.clearDebounce();
      this.emit(this.inFlight > 0 ? 'saving' : 'idle');
      return true;
    }
    if (this.inFlight === 0) this.emit('queued');
    else this.emit(this.stateChannel.value.status);
    this.scheduleDebounce();
    return true;
  }

  /** Guarda al perder el foco. Nunca rechaza: el fallo queda en `state$`. */
  handleBlur(): Promise<void> {
    const run =
      !this.canEdit || this.changedPaths.size === 0
        ? (this.pendingFlush ?? Promise.resolve())
        : this.flush();
    return run.catch(() => undefined);
  }

  /**
   * Guarda todo lo pendiente y espera la confirmación. En solo lectura o tras `dispose` resuelve sin
   * guardar; con conflictos pendientes rechaza con `DraftSaveConflictPendingError`.
   */
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.clearDebounce();
    if (this.rawConflicts.length > 0) return Promise.reject(new DraftSaveConflictPendingError());
    if (this.readOnly) return this.pendingFlush ?? Promise.resolve();
    return this.startFlush();
  }

  /**
   * Ejecuta una operación de servidor (subida, taxId, consentimiento…) sin ninguna otra petición en
   * vuelo. Si devuelve `rowVersion`, se adopta. No llamar a `flush()` desde dentro: espera a esta cola.
   */
  runExclusive<R>(operation: (rowVersion: string) => Promise<DraftExclusiveResult<R>>): Promise<R> {
    if (this.disposed) return Promise.reject(new DraftSaveInactiveError('disposed'));
    if (this.readOnly) return Promise.reject(new DraftSaveInactiveError('read-only'));
    if (this.rawConflicts.length > 0) return Promise.reject(new DraftSaveConflictPendingError());
    this.clearDebounce();
    const run = this.queue.then(async () => {
      // Se revisa otra vez al tocarle el turno: pudo entrar un conflicto u otra pestaña mientras esperaba.
      if (this.disposed) throw new DraftSaveInactiveError('disposed');
      if (this.readOnly) throw new DraftSaveInactiveError('read-only');
      if (this.rawConflicts.length > 0) throw new DraftSaveConflictPendingError();
      this.inFlight++;
      this.emit('saving');
      try {
        const result = await operation(this.rowVersion);
        if (result.snapshot) this.adopt(result.snapshot as DraftSnapshot<T>);
        else if (result.rowVersion) {
          this.rowVersion = result.rowVersion;
          this.confirmations++;
        }
        return result.value;
      } finally {
        this.inFlight--;
        if (!this.disposed && this.rawConflicts.length === 0) {
          this.emit(this.changedPaths.size === 0 ? 'idle' : 'queued');
          if (this.changedPaths.size > 0 && this.canEdit) this.scheduleDebounce();
        } else if (!this.disposed) this.emit('conflict');
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Marca a tomar ANTES de leer el snapshot que se pasará a `adoptServerSnapshot`. */
  beginServerRead(): DraftServerReadToken {
    return { generation: this.confirmations };
  }

  /**
   * Adopta lo que el servidor tiene ahora sin recrear el coordinador (después de una subida, un taxId
   * o un borrado de archivo). Sin cambios locales reemplaza base y RowVersion; con cambios hace la
   * misma fusión de tres vías que ante un 409, y los conflictos quedan en `state$` (`conflict`).
   * Si desde `token` (o, sin token, desde esta llamada) se confirmó o adoptó otra versión, el snapshot
   * es viejo y se descarta: resuelve `false`. Lo más seguro es leer dentro de `runExclusive` y devolver
   * `snapshot`. Espera a que no haya petición en vuelo. Resuelve `false` tras `dispose`; con conflictos
   * pendientes rechaza con `DraftSaveConflictPendingError`.
   */
  adoptServerSnapshot(answers: T, rowVersion: string, token?: DraftServerReadToken): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.rawConflicts.length > 0) return Promise.reject(new DraftSaveConflictPendingError());
    const expected = token?.generation ?? this.confirmations;
    const run = this.queue.then(() => {
      if (this.disposed || this.confirmations !== expected) return false;
      if (this.rawConflicts.length > 0) throw new DraftSaveConflictPendingError();
      this.adopt({ answers, rowVersion });
      if (this.rawConflicts.length > 0) {
        this.emit('conflict');
        return true;
      }
      this.emit(this.changedPaths.size === 0 ? 'idle' : 'queued');
      if (this.changedPaths.size > 0 && this.canEdit) this.scheduleDebounce();
      return true;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async resolveConflicts(resolutions: Readonly<Record<string, ConflictChoice>>): Promise<void> {
    if (this.disposed) throw new DraftSaveInactiveError('disposed');
    if (this.readOnly) throw new DraftSaveInactiveError('read-only');
    if (this.rawConflicts.length === 0 || this.conflictCandidate == null) return;
    if (this.rawConflicts.some((conflict) => resolutions[conflict.id] == null)) {
      throw new DraftSaveConflictPendingError();
    }

    // Se calcula todo antes de tocar el estado: si algo falla, el conflicto sigue abierto.
    let resolved: T = clone(this.conflictCandidate as T);
    for (const conflict of this.rawConflicts) {
      const value = resolutions[conflict.id] === 'local' ? conflict.local : conflict.remote;
      resolved = this.model.apply(resolved, conflict.path, value);
    }
    this.local = resolved;
    this.rawConflicts = [];
    this.conflictCandidate = null;
    this.changedPaths = this.model.changedPaths(this.base, this.local);
    this.emit('conflict-resolved');
    await this.flush();
  }

  handlePageHide(): boolean {
    this.clearDebounce();
    // Con una petición en vuelo, el keepalive saldría en paralelo y con un RowVersion viejo.
    if (
      this.disposed ||
      this.readOnly ||
      this.inFlight > 0 ||
      this.changedPaths.size === 0 ||
      this.rawConflicts.length > 0 ||
      this.options.saveKeepalive == null
    )
      return false;
    const payload = { answers: clone(this.local), rowVersion: this.rowVersion };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes >= this.keepaliveMaxBytes) return false;
    this.options.saveKeepalive(payload);
    return true;
  }

  takeControl(): void {
    if (this.disposed) return;
    this.readOnly = false;
    this.otherTabOpen = true;
    this.postPresence('claim');
    this.emit(this.changedPaths.size === 0 ? 'idle' : 'queued');
  }

  /** Guarda lo pendiente (si se puede) y después destruye. Nunca rechaza. */
  async flushAndDispose(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.flush();
    } catch {
      // El estado ya informó el fallo; destruir no debe lanzar.
    } finally {
      this.dispose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearDebounce();
    this.disposed = true;
    this.lifecycle?.document.removeEventListener('visibilitychange', this.visibilityListener);
    this.lifecycle?.window.removeEventListener('pagehide', this.pageHideListener);
    if (this.channel != null) {
      this.postPresence(this.readOnly ? 'leave' : 'release');
      this.channel.removeEventListener('message', this.channelListener);
      this.channel.close();
    }
    this.stateChannel.clear();
  }

  private startFlush(): Promise<void> {
    if (this.pendingFlush != null) return this.pendingFlush;
    const tracked = this.queue
      .then(() => this.runSaveLoop())
      .finally(() => {
        if (this.pendingFlush === tracked) this.pendingFlush = null;
      });
    this.pendingFlush = tracked;
    this.queue = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  private async runSaveLoop(): Promise<void> {
    let automaticConflictRetries = 0;
    while (!this.disposed && this.changedPaths.size > 0) {
      if (this.rawConflicts.length > 0) throw new DraftSaveConflictPendingError();
      const savedSnapshot = clone(this.local);
      const savedRowVersion = this.rowVersion;
      let result: DraftSaveResult;
      this.inFlight++;
      this.emit('saving');
      try {
        result = await this.options.save(savedSnapshot, savedRowVersion);
      } catch (error) {
        result = { outcome: 'error', error };
      } finally {
        this.inFlight--;
      }

      if (result.outcome === 'saved') {
        automaticConflictRetries = 0;
        this.base = savedSnapshot;
        this.rowVersion = result.rowVersion;
        this.confirmations++;
        this.changedPaths = this.model.changedPaths(this.base, this.local);
        this.emit(this.changedPaths.size === 0 ? 'idle' : 'queued');
        continue;
      }
      if (result.outcome === 'conflict') {
        if (automaticConflictRetries >= 1) {
          const error = new DraftSaveRepeatedConflictError();
          this.emit('error', error);
          throw new DraftSaveFailedError(error);
        }
        automaticConflictRetries++;
        await this.rebaseAfterConflict();
        continue;
      }
      this.emit('error', result.error);
      throw new DraftSaveFailedError(result.error);
    }
  }

  private async rebaseAfterConflict(): Promise<void> {
    let remote: DraftSnapshot<T>;
    this.inFlight++;
    try {
      remote = await this.options.load();
    } catch (error) {
      this.inFlight--;
      this.emit('error', error);
      throw new DraftSaveFailedError(error);
    }
    this.inFlight--;
    this.adopt(remote);
    if (this.rawConflicts.length === 0) {
      this.emit(this.changedPaths.size === 0 ? 'idle' : 'queued');
      return;
    }
    this.emit('conflict');
    throw new DraftSaveConflictPendingError();
  }

  /** Toma `remote` como nueva base; lo local pendiente se fusiona en tres vías. */
  private adopt(remote: DraftSnapshot<T>): void {
    // Con conflictos abiertos, adoptar dejaría un candidato viejo que revertiría lo remoto.
    if (this.rawConflicts.length > 0) throw new DraftSaveConflictPendingError();
    this.confirmations++;
    if (this.changedPaths.size === 0) {
      this.base = clone(remote.answers);
      this.local = clone(remote.answers);
      this.rowVersion = remote.rowVersion;
      this.changedPaths = new Set();
      return;
    }
    const merged = this.model.merge(this.base, this.local, remote.answers);
    const documents = [this.local, remote.answers, this.base];
    for (const conflict of merged.conflicts) conflict.target = this.model.target(conflict, documents);
    this.base = clone(remote.answers);
    this.rowVersion = remote.rowVersion;
    this.local = clone(merged.value);
    this.changedPaths = this.model.changedPaths(this.base, this.local);
    if (merged.conflicts.length === 0) return;
    this.clearDebounce();
    this.rawConflicts = merged.conflicts;
    this.conflictCandidate = clone(merged.value);
  }

  private scheduleDebounce(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.handleBlur();
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer == null) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private emit(status: DraftSaveStatus, error: unknown | null = null): void {
    if (this.disposed) return;
    this.stateChannel.next(this.createState(status, error));
  }

  private createState(status: DraftSaveStatus, error: unknown | null = null): DraftSaveState<T> {
    return {
      status,
      answers: clone(this.local),
      rowVersion: this.rowVersion,
      changedPaths: [...this.changedPaths].sort(),
      conflicts: this.rawConflicts.map((conflict) => this.toPublicConflict(conflict)),
      error,
      readOnly: this.readOnly,
      otherTabOpen: this.otherTabOpen,
      busy: this.inFlight > 0,
    };
  }

  private toPublicConflict(conflict: RawConflict): DraftConflict {
    const target = conflict.target ?? this.model.target(conflict, [this.local]);
    let label: string | null | undefined = null;
    try {
      label = this.options.labelFor?.(target);
    } catch {
      label = null;
    }
    return {
      id: conflict.id,
      path: conflict.path,
      kind: conflict.kind,
      componentId: target.componentId,
      sectionId: target.sectionId,
      rowId: target.rowId,
      rowIndex: target.rowIndex,
      label: label?.trim() || target.componentId,
      baseValue: safeValue(conflict.base),
      localValue: safeValue(conflict.local),
      remoteValue: safeValue(conflict.remote),
      baseDisplayValue: displayValue(conflict.base, conflict.kind),
      localDisplayValue: displayValue(conflict.local, conflict.kind),
      remoteDisplayValue: displayValue(conflict.remote, conflict.kind),
    };
  }

  private attachBrowserSignals(): void {
    this.lifecycle?.document.addEventListener('visibilitychange', this.visibilityListener);
    this.lifecycle?.window.addEventListener('pagehide', this.pageHideListener);
    this.channel?.addEventListener('message', this.channelListener);
    this.postPresence('probe');
  }

  private handleChannelMessage(value: unknown): void {
    if (this.disposed || !isPresenceMessage(value, this.options.requestId, this.tabId)) return;
    if (value.type === 'leave') {
      // Una pestaña en solo lectura se cerró: sin ella puede no quedar nadie más.
      this.otherTabs.delete(value.senderId);
      this.otherTabOpen = this.otherTabs.size > 0;
      this.emit(this.stateChannel.value.status);
      return;
    }
    if (value.type === 'probe') {
      this.otherTabs.add(value.senderId);
      if (!this.readOnly) this.postPresence('presence');
      return;
    }
    if (value.type === 'release') {
      this.otherTabs.delete(value.senderId);
      this.otherTabOpen = this.otherTabs.size > 0;
      // La pestaña con el control se cerró: esta lo retoma sola. Si quedan otras, el sondeo
      // vuelve a decidir por antigüedad (la más antigua escribe).
      if (this.readOnly) {
        this.readOnly = false;
        this.postPresence('probe');
      }
      this.emit(this.stateChannel.value.status);
      return;
    }
    this.otherTabs.add(value.senderId);
    this.otherTabOpen = true;
    const wasReadOnly = this.readOnly;
    if (value.type === 'claim' || precedes(value, this.openedAt, this.tabId)) {
      this.readOnly = true;
      this.clearDebounce();
      // Lo escrito antes de ceder el control se guarda igual; la otra pestaña lo fusiona en su 409.
      if (!wasReadOnly && this.changedPaths.size > 0 && this.rawConflicts.length === 0)
        void this.startFlush().catch(() => undefined);
      if (value.type === 'presence' && !wasReadOnly) this.postPresence('presence');
    } else if (!this.readOnly) {
      this.postPresence('presence');
    }
    this.emit(this.stateChannel.value.status);
  }

  private postPresence(type: PresenceMessage['type']): void {
    this.channel?.postMessage({
      scope: 'dc-form-presence-v1',
      requestId: this.options.requestId,
      senderId: this.tabId,
      openedAt: this.openedAt,
      type,
    } satisfies PresenceMessage);
  }
}

class StateChannel<T> implements ReadonlyState<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  next(value: T): void {
    this.current = value;
    for (const listener of this.listeners) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ---------- Modelo de respuestas: rutas de componente, fila y campo de fila ----------

const ANSWERS_MODEL: DraftDocumentModel<FormAnswers> = {
  changedPaths: changedAnswerPaths,
  merge: mergeAnswers,
  apply: applyMergeValue,
  target: answersConflictTarget,
};

/**
 * Fusión de tres vías por `componentId`. El valor de un componente es atómico (dirección, taxId,
 * objetos): nunca se fusionan sus subcampos. Solo los repeaters bajan a fila y a campo de fila.
 */
function mergeAnswers(
  base: FormAnswers,
  local: FormAnswers,
  remote: FormAnswers,
): DraftMergeResult<FormAnswers> {
  const conflicts: RawConflict[] = [];
  const values: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(remote.values ?? {}),
    ...Object.keys(local.values ?? {}),
    ...Object.keys(base.values ?? {}),
  ]);
  for (const key of keys) {
    const merged = mergeTopLevel(
      member(base.values, key),
      member(local.values, key),
      member(remote.values, key),
      `/values/${escapePath(key)}`,
      conflicts,
    );
    if (merged !== MISSING) values[key] = merged;
  }
  return { value: { schemaVersion: remote.schemaVersion, values }, conflicts };
}

function mergeTopLevel(
  base: MergeValue,
  local: MergeValue,
  remote: MergeValue,
  path: string,
  conflicts: RawConflict[],
): MergeValue {
  const trivial = trivialMerge(base, local, remote);
  if (trivial.resolved) return trivial.value;
  const sides = [base, local, remote];
  if (
    sides.some(isRepeaterValue) &&
    sides.every((side) => side === MISSING || isRepeaterValue(side))
  ) {
    return { rows: mergeRows(rowsOf(base), rowsOf(local), rowsOf(remote), path, conflicts) };
  }
  return mergeAtomic(base, local, remote, path, conflicts);
}

function mergeRows(
  base: readonly RepeaterRow[],
  local: readonly RepeaterRow[],
  remote: readonly RepeaterRow[],
  sectionPath: string,
  conflicts: RawConflict[],
): RepeaterRow[] {
  const baseRows = rowMap(base);
  const localRows = rowMap(local);
  const remoteRows = rowMap(remote);
  const order = [
    ...remote.map((row) => row.rowId),
    ...local.map((row) => row.rowId).filter((id) => !remoteRows.has(id)),
  ];
  const rows = new Map<string, RepeaterRow>();
  for (const id of new Set([...baseRows.keys(), ...localRows.keys(), ...remoteRows.keys()])) {
    const baseRow: RepeaterRow | typeof MISSING = baseRows.get(id) ?? MISSING;
    const localRow: RepeaterRow | typeof MISSING = localRows.get(id) ?? MISSING;
    const remoteRow: RepeaterRow | typeof MISSING = remoteRows.get(id) ?? MISSING;
    const rowPath = `${sectionPath}/rows/${escapePath(id)}`;
    const trivial = trivialMerge(baseRow, localRow, remoteRow);
    let merged: MergeValue;
    if (trivial.resolved) merged = trivial.value;
    else if (localRow === MISSING || remoteRow === MISSING)
      // Borrada en un lado y editada en el otro (si ambos la borraron, `trivialMerge` ya lo resolvió).
      merged = addConflict(rowPath, 'row-delete-edit', baseRow, localRow, remoteRow, conflicts);
    else merged = mergeRowFields(baseRow, localRow, remoteRow, id, rowPath, conflicts);
    if (merged !== MISSING && isRepeaterRow(merged)) rows.set(id, merged);
  }
  return [...new Set(order)].filter((id) => rows.has(id)).map((id) => rows.get(id)!);
}

function mergeRowFields(
  base: MergeValue,
  local: RepeaterRow,
  remote: RepeaterRow,
  rowId: string,
  rowPath: string,
  conflicts: RawConflict[],
): RepeaterRow {
  const baseValues = isRepeaterRow(base) ? base.values : {};
  const values: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(remote.values),
    ...Object.keys(local.values),
    ...Object.keys(baseValues),
  ]);
  for (const key of keys) {
    const fieldBase = member(baseValues, key);
    const fieldLocal = member(local.values, key);
    const fieldRemote = member(remote.values, key);
    const trivial = trivialMerge(fieldBase, fieldLocal, fieldRemote);
    const merged = trivial.resolved
      ? trivial.value
      : mergeAtomic(
          fieldBase,
          fieldLocal,
          fieldRemote,
          `${rowPath}/values/${escapePath(key)}`,
          conflicts,
        );
    if (merged !== MISSING) values[key] = merged;
  }
  return { ...clone(remote), rowId, values };
}

function mergeAtomic(
  base: MergeValue,
  local: MergeValue,
  remote: MergeValue,
  path: string,
  conflicts: RawConflict[],
): MergeValue {
  const trivial = trivialMerge(base, local, remote);
  if (trivial.resolved) return trivial.value;
  if (isFileArray(base) || isFileArray(local) || isFileArray(remote))
    return mergeFiles(base, local, remote, path, conflicts);
  return addConflict(path, 'value', base, local, remote, conflicts);
}

function trivialMerge(
  base: MergeValue,
  local: MergeValue,
  remote: MergeValue,
): { resolved: true; value: MergeValue } | { resolved: false } {
  if (equal(local, remote)) return { resolved: true, value: cloneMergeValue(local) };
  if (equal(local, base)) return { resolved: true, value: cloneMergeValue(remote) };
  if (equal(remote, base)) return { resolved: true, value: cloneMergeValue(local) };
  return { resolved: false };
}

function mergeFiles(
  base: MergeValue,
  local: MergeValue,
  remote: MergeValue,
  path: string,
  conflicts: RawConflict[],
): MergeValue {
  if (
    !isFileArrayOrMissing(base) ||
    !isFileArrayOrMissing(local) ||
    !isFileArrayOrMissing(remote)
  ) {
    return addConflict(path, 'value', base, local, remote, conflicts);
  }
  const baseFiles = fileMap(base);
  const localFiles = fileMap(local);
  const remoteFiles = fileMap(remote);
  const ids = new Set([...baseFiles.keys(), ...localFiles.keys(), ...remoteFiles.keys()]);
  const localCandidate = new Map<string, Record<string, unknown>>();
  const remoteCandidate = new Map<string, Record<string, unknown>>();
  let hasConflict = false;
  let conflictKind: RawConflict['kind'] = 'value';

  for (const id of ids) {
    const baseFile = baseFiles.get(id);
    const localFile = localFiles.get(id);
    const remoteFile = remoteFiles.get(id);

    if (baseFile == null) {
      if (localFile != null) localCandidate.set(id, clone(localFile));
      if (remoteFile != null) remoteCandidate.set(id, clone(remoteFile));
      if (localFile == null && remoteFile != null) localCandidate.set(id, clone(remoteFile));
      if (remoteFile == null && localFile != null) remoteCandidate.set(id, clone(localFile));
      continue;
    }

    if ((localFile == null) !== (remoteFile == null)) {
      hasConflict = true;
      conflictKind = 'attachment-delete-retain';
      if (localFile != null) localCandidate.set(id, clone(localFile));
      if (remoteFile != null) remoteCandidate.set(id, clone(remoteFile));
      continue;
    }
    if (localFile == null || remoteFile == null) continue;

    if (equal(localFile, remoteFile)) {
      localCandidate.set(id, clone(localFile));
      remoteCandidate.set(id, clone(remoteFile));
    } else if (equal(localFile, baseFile)) {
      localCandidate.set(id, clone(remoteFile));
      remoteCandidate.set(id, clone(remoteFile));
    } else if (equal(remoteFile, baseFile)) {
      localCandidate.set(id, clone(localFile));
      remoteCandidate.set(id, clone(localFile));
    } else {
      hasConflict = true;
      localCandidate.set(id, clone(localFile));
      remoteCandidate.set(id, clone(remoteFile));
    }
  }

  const localValue = orderedFiles(localCandidate, remote, local);
  const remoteValue = orderedFiles(remoteCandidate, remote, local);
  return hasConflict
    ? addConflict(path, conflictKind, base, localValue, remoteValue, conflicts)
    : remoteValue;
}

function addConflict(
  path: string,
  kind: RawConflict['kind'],
  base: MergeValue,
  local: MergeValue,
  remote: MergeValue,
  conflicts: RawConflict[],
): MergeValue {
  conflicts.push({
    id: path,
    path,
    kind,
    base: cloneMergeValue(base),
    local: cloneMergeValue(local),
    remote: cloneMergeValue(remote),
  });
  return cloneMergeValue(remote);
}

function changedAnswerPaths(base: FormAnswers, local: FormAnswers): Set<string> {
  const changed = new Set<string>();
  const keys = new Set([...Object.keys(base.values ?? {}), ...Object.keys(local.values ?? {})]);
  for (const key of keys) {
    const baseValue = member(base.values, key);
    const localValue = member(local.values, key);
    if (equal(baseValue, localValue)) continue;
    if (isRepeaterValue(baseValue) || isRepeaterValue(localValue))
      collectRowChanges(baseValue, localValue, `/values/${escapePath(key)}`, changed);
    else changed.add(`/values/${escapePath(key)}`);
  }
  return changed;
}

function collectRowChanges(
  base: MergeValue,
  local: MergeValue,
  path: string,
  changed: Set<string>,
): void {
  const baseRows = rowMap(rowsOf(base));
  const localRows = rowMap(rowsOf(local));
  const ids = new Set([...baseRows.keys(), ...localRows.keys()]);
  let any = false;
  for (const id of ids) {
    const baseRow = baseRows.get(id);
    const localRow = localRows.get(id);
    const rowPath = `${path}/rows/${escapePath(id)}`;
    if (baseRow == null || localRow == null) {
      changed.add(rowPath);
      any = true;
      continue;
    }
    const fields = new Set([...Object.keys(baseRow.values), ...Object.keys(localRow.values)]);
    for (const field of fields)
      if (!equal(member(baseRow.values, field), member(localRow.values, field))) {
        changed.add(`${rowPath}/values/${escapePath(field)}`);
        any = true;
      }
  }
  // Mismo contenido con otro orden de filas (o el repeater aparece vacío): cambia el componente.
  if (!any) changed.add(path);
}

function applyChange<T>(
  model: DraftDocumentModel<T>,
  answers: T,
  path: string,
  value: unknown,
): T {
  return model.apply(answers, path, value === undefined ? MISSING : clone(value));
}

function applyMergeValue(answers: FormAnswers, path: string, value: MergeValue): FormAnswers {
  const parts = parseAnswerPath(path);
  const result = clone(answers);
  const componentOrSectionId = parts.componentOrSectionId;
  if (parts.rowId == null) {
    if (value === MISSING) delete result.values[componentOrSectionId];
    else result.values[componentOrSectionId] = clone(value);
    return result;
  }
  const rowId = parts.rowId;
  const rows = readRows(result.values[componentOrSectionId]);
  const rowIndex = rows.findIndex((row) => row.rowId === rowId);
  if (parts.fieldId == null) {
    if (value === MISSING) {
      if (rowIndex >= 0) rows.splice(rowIndex, 1);
    } else if (isRepeaterRow(value)) {
      if (rowIndex >= 0) rows[rowIndex] = clone(value);
      else rows.push(clone(value));
    } else throw new Error(`Row path '${path}' requires a repeater row.`);
  } else {
    const row = rowIndex >= 0 ? rows[rowIndex] : { rowId, values: {} };
    if (value === MISSING) delete row.values[parts.fieldId];
    else row.values[parts.fieldId] = clone(value);
    if (rowIndex < 0) rows.push(row);
  }
  result.values[componentOrSectionId] = { rows };
  return result;
}

interface AnswerPath {
  componentOrSectionId: string;
  rowId: string | null;
  fieldId: string | null;
}

/** Rutas admitidas: `/values/{id}`, `/values/{section}/rows/{row}` y `.../values/{field}`. */
function parseAnswerPath(path: string): AnswerPath {
  const parts = path.split('/').slice(1).map(unescapePath);
  const valid =
    path.startsWith('/') &&
    parts[0] === 'values' &&
    (parts.length === 2 ||
      (parts.length === 4 && parts[2] === 'rows') ||
      (parts.length === 6 && parts[2] === 'rows' && parts[4] === 'values'));
  if (!valid) throw new Error(`Unsupported draft path '${path}'.`);
  return {
    componentOrSectionId: parts[1],
    rowId: parts.length >= 4 ? parts[3] : null,
    fieldId: parts.length === 6 ? parts[5] : null,
  };
}

function answersConflictTarget(
  conflict: RawConflict,
  documents: readonly FormAnswers[],
): DraftConflictTarget {
  const parts = parseAnswerPath(conflict.path);
  const sectionId = parts.rowId == null ? null : parts.componentOrSectionId;
  let rowIndex: number | null = null;
  for (const document of documents) {
    if (rowIndex != null || parts.rowId == null || sectionId == null) break;
    rowIndex = indexOfRow(document, sectionId, parts.rowId);
  }
  return {
    path: conflict.path,
    kind: conflict.kind,
    componentId: parts.fieldId ?? parts.componentOrSectionId,
    sectionId,
    rowId: parts.rowId,
    rowIndex,
  };
}

function indexOfRow(answers: FormAnswers, sectionId: string, rowId: string): number | null {
  const index = rowsOf(member(answers.values, sectionId)).findIndex((row) => row.rowId === rowId);
  return index >= 0 ? index : null;
}

// ---------- Valores visibles de un conflicto ----------

function displayValue(value: MergeValue, kind: RawConflict['kind']): unknown {
  if (kind === 'row-delete-edit') return value === MISSING ? 'Row removed' : 'Row edited';
  if (value === MISSING) return 'Removed';
  if (isTaxIdValue(value)) return `****${value['last4']}`;
  if (isFileValue(value)) return { fileId: value['fileId'] };
  return safeValue(value);
}

/** Copia sin `sensitiveRef`: del taxId solo quedan `kind` y `last4`. */
function safeValue(value: MergeValue): unknown {
  if (value === MISSING) return undefined;
  if (isTaxIdValue(value)) return { kind: value['kind'], last4: value['last4'] };
  if (Array.isArray(value)) return value.map((item) => safeValue(item));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, safeValue(item)]),
    );
  return value;
}

// ---------- Navegador ----------

function createChannel(
  requestId: string,
  factory: DraftSaveCoordinatorOptions<unknown>['channelFactory'],
): DraftBroadcastChannel | null {
  if (factory === null) return null;
  if (factory != null) return factory(`dc-form-${requestId}`);
  return typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(`dc-form-${requestId}`);
}

function browserLifecycle(): DraftLifecycle | null {
  return typeof document === 'undefined' || typeof window === 'undefined'
    ? null
    : { document, window };
}

function createTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function isPresenceMessage(
  value: unknown,
  requestId: string,
  tabId: string,
): value is PresenceMessage {
  return (
    isRecord(value) &&
    value['scope'] === 'dc-form-presence-v1' &&
    value['requestId'] === requestId &&
    value['senderId'] !== tabId &&
    typeof value['senderId'] === 'string' &&
    typeof value['openedAt'] === 'number' &&
    ['probe', 'presence', 'claim', 'release', 'leave'].includes(String(value['type']))
  );
}

function precedes(message: PresenceMessage, openedAt: number, tabId: string): boolean {
  return message.openedAt < openedAt || (message.openedAt === openedAt && message.senderId < tabId);
}

// ---------- Utilidades ----------

function member(value: MergeValue, key: string): MergeValue {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : MISSING;
}

function isTaxIdValue(value: MergeValue): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value['sensitiveRef'] === 'string' &&
    typeof value['last4'] === 'string' &&
    typeof value['kind'] === 'string'
  );
}

function isFileValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value['fileId'] === 'string';
}

function isFileArray(value: MergeValue): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every(isFileValue);
}

function isFileArrayOrMissing(value: MergeValue): boolean {
  return value === MISSING || (Array.isArray(value) && value.every(isFileValue));
}

function fileMap(value: MergeValue): Map<string, Record<string, unknown>> {
  return new Map(
    (Array.isArray(value) ? value.filter(isFileValue) : []).map((file) => [
      String(file['fileId']),
      file,
    ]),
  );
}

function orderedFiles(
  files: ReadonlyMap<string, Record<string, unknown>>,
  primary: MergeValue,
  secondary: MergeValue,
): Record<string, unknown>[] {
  const primaryOrder = fileOrder(primary);
  const order = [
    ...primaryOrder,
    ...fileOrder(secondary).filter((id) => !primaryOrder.includes(id)),
  ];
  return order.filter((id) => files.has(id)).map((id) => clone(files.get(id)!));
}

function fileOrder(value: MergeValue): string[] {
  return Array.isArray(value)
    ? value.filter(isFileValue).map((file) => String(file['fileId']))
    : [];
}

function isRepeaterValue(value: unknown): value is { rows: unknown[] } {
  return isRecord(value) && Array.isArray(value['rows']);
}

function isRepeaterRow(value: unknown): value is RepeaterRow {
  return isRecord(value) && typeof value['rowId'] === 'string' && isRecord(value['values']);
}

function rowsOf(value: MergeValue): RepeaterRow[] {
  return isRepeaterValue(value) ? value.rows.filter(isRepeaterRow) : [];
}

function rowMap(rows: readonly RepeaterRow[]): Map<string, RepeaterRow> {
  return new Map(rows.map((row) => [row.rowId, row]));
}

function readRows(value: unknown): RepeaterRow[] {
  return clone(rowsOf(value));
}

function equal(left: MergeValue, right: MergeValue): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function cloneMergeValue(value: MergeValue): MergeValue {
  return value === MISSING ? MISSING : clone(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function escapePath(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePath(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}
