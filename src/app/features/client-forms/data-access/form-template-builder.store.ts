import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { canonicalJson } from '@shared/utils/data-collection/canonical-json';
import {
  DEFINITION_DRAFT_MODEL,
  describeDefinitionPath,
} from '@shared/utils/data-collection/draft-definition-model';
import {
  DraftSaveConflictPendingError,
  DraftSaveCoordinator,
  type DraftConflict,
  type DraftConflictTarget,
  type DraftSaveResult,
  type DraftSaveState,
  type DraftSnapshot,
} from '@shared/utils/data-collection/draft-save-coordinator';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { firstValueFrom } from 'rxjs';
import type { FormTemplateDetail } from './client-forms.model';
import { FormTemplatesService } from './form-templates.service';
import { normalizeLegacyEmptyDefinition } from '../utils/definition-mutations';

export type BuilderSelection =
  | { kind: 'page'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'component'; id: string }
  | null;
export type BuilderSaveStatus = 'idle' | 'queued' | 'saving' | 'saved' | 'conflict' | 'error';
export type BuilderConflictChoice = 'mine' | 'theirs';

/**
 * Estado del builder. El guardado lo hace el coordinador compartido (P-5.3-bis) con el modelo de
 * definición (P-6.2): debounce de 2 s, una petición en vuelo, `pagehide`, varias pestañas y fusión
 * de tres vías por página, sección y componente.
 */
@Injectable()
export class FormTemplateBuilderStore {
  private readonly service = inject(FormTemplatesService);
  private coordinator: DraftSaveCoordinator<FormDefinition> | null = null;
  private unsubscribe: (() => void) | null = null;
  private undoStack: FormDefinition[] = [];
  private redoStack: FormDefinition[] = [];
  /** Última versión leída del servidor, para nombrar elementos que ya no existen aquí. */
  private lastRemote: FormDefinition | null = null;
  private readonly savedOnce = signal(false);

  readonly template = signal<FormTemplateDetail | null>(null);
  readonly definition = signal<FormDefinition | null>(null);
  readonly selection = signal<BuilderSelection>(null);
  readonly issues = signal<ValidationIssue[]>([]);
  readonly loading = signal(false);
  /** Solo el fallo de carga: reemplaza el builder por la pantalla de error. */
  readonly error = signal('');
  /** Fallos de acciones (publicar, archivar, guardar…): aviso descartable sobre el builder. */
  readonly actionError = signal('');
  /** Sin `configure_actions` el backend rechaza cualquier cambio a `mappings` o `actions`. */
  private readonly ruleSetsLocked = signal(false);
  readonly previewOpen = signal(false);
  readonly versionsOpen = signal(false);
  readonly publishing = signal(false);
  readonly saveState = signal<DraftSaveState<FormDefinition> | null>(null);
  readonly conflicts = computed<readonly DraftConflict[]>(() => this.saveState()?.conflicts ?? []);
  /** Otra pestaña tiene el control: aquí no se edita hasta "Use it here". */
  readonly readOnly = computed(() => this.saveState()?.readOnly === true);
  readonly dirty = computed(() => (this.saveState()?.changedPaths.length ?? 0) > 0);
  readonly saveStatus = computed<BuilderSaveStatus>(() => {
    const state = this.saveState();
    if (!state) return 'idle';
    if (state.status === 'conflict') return 'conflict';
    if (state.status === 'error') return 'error';
    if (state.status === 'saving') return 'saving';
    if (state.status === 'queued' || state.status === 'conflict-resolved') return 'queued';
    return this.savedOnce() ? 'saved' : 'idle';
  });
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  async load(id: string): Promise<void> {
    // Otra plantilla en la misma instancia (p. ej. tras "Duplicate"): se guarda y suelta la anterior.
    this.disposeCoordinator(true);
    this.template.set(null);
    this.definition.set(null);
    this.saveState.set(null);
    this.issues.set([]);
    this.previewOpen.set(false);
    this.versionsOpen.set(false);
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    try {
      const detail = await firstValueFrom(this.service.get(id));
      const server = JSON.parse(detail.draft) as FormDefinition;
      const definition = normalizeLegacyEmptyDefinition(structuredClone(server));
      this.template.set(detail);
      this.lastRemote = server;
      this.definition.set(definition);
      this.undoStack = [];
      this.redoStack = [];
      this.savedOnce.set(false);
      // Primera sección seleccionada: la paleta agrega ahí sin pasos previos.
      const firstSection = definition.pages[0]?.sections[0];
      this.selection.set(
        firstSection
          ? { kind: 'section', id: firstSection.id }
          : { kind: 'page', id: definition.pages[0]?.id ?? '' },
      );
      this.syncHistory();
      this.createCoordinator(id, { answers: server, rowVersion: detail.rowVersion });
      // Un draft legado vacío se normaliza y se guarda como un cambio local más.
      if (!same(server, definition)) this.coordinator?.notifyDocument(definition);
    } catch {
      this.error.set('The template could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  select(selection: BuilderSelection): void {
    this.selection.set(selection);
  }

  /** El builder lo fija según el permiso; sirve de red por si una mutación toca las reglas. */
  lockRuleSets(locked: boolean): void {
    this.ruleSetsLocked.set(locked);
  }

  dismissActionError(): void {
    this.actionError.set('');
  }

  change(mutator: (definition: FormDefinition) => FormDefinition): void {
    const current = this.definition();
    if (!current || !this.coordinator?.canEdit) return;
    const next = mutator(clone(current));
    if (same(current, next)) return;
    if (this.ruleSetsLocked() && !sameRuleSets(current, next)) {
      this.actionError.set('Only people with Configure actions can change data mapping or actions.');
      return;
    }
    if (!this.commit(current, next)) return;
    this.undoStack.push(clone(current));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.issues.set([]);
    this.syncHistory();
  }

  undo(): void {
    const current = this.definition();
    const previous = this.undoStack.at(-1);
    if (!current || !previous || !this.commit(current, previous)) return;
    this.undoStack.pop();
    this.redoStack.push(clone(current));
    this.syncHistory();
  }

  redo(): void {
    const current = this.definition();
    const next = this.redoStack.at(-1);
    if (!current || !next || !this.commit(current, next)) return;
    this.redoStack.pop();
    this.undoStack.push(clone(current));
    this.syncHistory();
  }

  /** Guarda lo pendiente. Rechaza si hay conflictos o el guardado falla. */
  async flush(): Promise<void> {
    await this.coordinator?.flush();
  }

  /** `true` solo si no queda nada sin guardar; en solo lectura con cambios sucios es `false`. */
  async trySave(): Promise<boolean> {
    try {
      await this.flush();
      return !this.dirty();
    } catch {
      return false;
    }
  }

  takeControl(): void {
    this.coordinator?.takeControl();
  }

  async validate(): Promise<void> {
    const template = this.template();
    if (!template || !(await this.trySave())) return;
    try {
      const response = await firstValueFrom(this.service.validate(template.id));
      this.issues.set(response.issues);
    } catch {
      this.actionError.set('The template could not be validated.');
    }
  }

  async publish(): Promise<number | null> {
    const template = this.template();
    const coordinator = this.coordinator;
    if (!template || !coordinator) return null;
    if (!(await this.trySave())) {
      this.actionError.set('Save or resolve your changes before publishing.');
      return null;
    }
    this.publishing.set(true);
    try {
      const outcome = await coordinator.runExclusive(async (rowVersion) => {
        const result = await firstValueFrom(this.service.publish(template.id, rowVersion));
        if (!result.published || !result.version) return { value: result };
        const refreshed = await firstValueFrom(this.service.get(template.id));
        return { value: result, snapshot: this.acceptDetail(refreshed) };
      });
      this.issues.set(outcome.issues);
      return outcome.published && outcome.version ? outcome.version.versionNumber : null;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 422) {
        const issues = (error.error as { issues?: ValidationIssue[] } | null)?.issues;
        this.issues.set(Array.isArray(issues) ? issues : []);
        return null;
      }
      this.actionError.set('The template could not be published.');
      return null;
    } finally {
      this.publishing.set(false);
    }
  }

  async restoreVersion(versionNumber: number): Promise<void> {
    const template = this.template();
    const coordinator = this.coordinator;
    if (!template || !coordinator || !(await this.trySave())) return;
    try {
      await coordinator.runExclusive(async (rowVersion) => {
        const detail = await firstValueFrom(this.service.revert(template.id, versionNumber, rowVersion));
        return { value: detail, snapshot: this.acceptDetail(detail) };
      });
    } catch {
      this.actionError.set('The version could not be restored.');
    }
  }

  async loadVersions(): Promise<void> {
    const template = this.template();
    if (!template) return;
    try {
      const versions = await firstValueFrom(this.service.versions(template.id));
      this.template.update((current) => (current ? { ...current, versions } : current));
    } catch {
      this.actionError.set('The version history could not be loaded.');
    }
  }

  async loadVersion(versionNumber: number): Promise<FormDefinition | null> {
    const template = this.template();
    if (!template) return null;
    try {
      const version = await firstValueFrom(this.service.version(template.id, versionNumber));
      return JSON.parse(version.definition) as FormDefinition;
    } catch {
      this.actionError.set('The published version could not be loaded.');
      return null;
    }
  }

  async duplicateVersion(versionNumber: number): Promise<string | null> {
    const template = this.template();
    if (!template) return null;
    try {
      const duplicate = await firstValueFrom(this.service.duplicate(template.id, versionNumber));
      return duplicate.id;
    } catch {
      this.actionError.set('The published version could not be duplicated.');
      return null;
    }
  }

  async duplicateDraft(): Promise<string | null> {
    const template = this.template();
    if (!template || !(await this.trySave())) return null;
    try {
      const duplicate = await firstValueFrom(this.service.duplicate(template.id));
      return duplicate.id;
    } catch {
      this.actionError.set('The template could not be duplicated.');
      return null;
    }
  }

  async archive(): Promise<boolean> {
    const template = this.template();
    const coordinator = this.coordinator;
    if (!template || !coordinator || !(await this.trySave())) return false;
    try {
      await coordinator.runExclusive(async (rowVersion) => {
        const archived = await firstValueFrom(this.service.archive(template.id, rowVersion));
        return { value: archived, snapshot: this.acceptDetail(archived) };
      });
      return true;
    } catch {
      this.actionError.set('The template could not be archived.');
      return false;
    }
  }

  /** Aplica la elección de cada conflicto (por `conflict.id`) y guarda. */
  async resolveConflicts(choices: Readonly<Record<string, BuilderConflictChoice>>): Promise<void> {
    const coordinator = this.coordinator;
    const conflicts = this.conflicts();
    if (!coordinator || conflicts.some((conflict) => !choices[conflict.id])) return;
    try {
      await coordinator.resolveConflicts(
        Object.fromEntries(
          conflicts.map((conflict) => [
            conflict.id,
            choices[conflict.id] === 'mine' ? ('local' as const) : ('remote' as const),
          ]),
        ),
      );
    } catch (error) {
      // Un 409 durante la resolución abre otro ciclo con los conflictos nuevos.
      if (!(error instanceof DraftSaveConflictPendingError))
        this.actionError.set('The draft could not be saved.');
    }
  }

  /** Nombre legible del elemento en conflicto, para el diálogo. */
  conflictLabel(target: Pick<DraftConflictTarget, 'path'>): string {
    const element = describeDefinitionPath(target.path);
    const definitions = [this.definition(), this.lastRemote].filter(
      (item): item is FormDefinition => item != null,
    );
    const page = (id: string) => definitions.flatMap((item) => item.pages).find((item) => item.id === id);
    const section = (id: string) =>
      definitions
        .flatMap((item) => item.pages.flatMap((entry) => entry.sections))
        .find((item) => item.id === id);
    const component = (id: string) =>
      definitions
        .flatMap((item) => item.pages.flatMap((entry) => entry.sections.flatMap((s) => s.components)))
        .find((item) => item.id === id);
    if (element.kind === 'root') return ROOT_LABELS[element.id] ?? humanize(element.id);
    if (element.kind === 'page') return `Page "${page(element.id)?.title || 'Untitled page'}"`;
    if (element.kind === 'section')
      return `Section "${section(element.id)?.title || 'Untitled section'}"`;
    if (element.kind === 'component') {
      const found = component(element.id);
      return `Field "${found?.label || found?.type || element.id}"`;
    }
    if (element.container === 'pages') return 'Order of pages';
    if (element.container === 'page')
      return `Order of sections in page "${page(element.id)?.title || 'Untitled page'}"`;
    return `Order of fields in section "${section(element.id)?.title || 'Untitled section'}"`;
  }

  /** Destruye el coordinador tras guardar lo pendiente (al salir del builder). */
  dispose(): void {
    this.disposeCoordinator(true);
  }

  private createCoordinator(id: string, initial: DraftSnapshot<FormDefinition>): void {
    const coordinator = new DraftSaveCoordinator<FormDefinition>({
      initial,
      requestId: `form-template-${id}`,
      model: DEFINITION_DRAFT_MODEL,
      debounceMs: 2_000,
      labelFor: (target) => this.conflictLabel(target),
      save: (definition, rowVersion) => this.saveDraft(id, definition, rowVersion),
      load: () => this.loadRemote(id),
      saveKeepalive: ({ answers, rowVersion }) =>
        this.service.updateDraftKeepalive(id, answers, rowVersion),
    });
    this.coordinator = coordinator;
    this.unsubscribe = coordinator.state$.subscribe((state) => this.onState(state));
  }

  private onState(state: DraftSaveState<FormDefinition>): void {
    this.saveState.set(state);
    this.template.update((current) =>
      current && current.rowVersion !== state.rowVersion
        ? { ...current, rowVersion: state.rowVersion }
        : current,
    );
    const current = this.definition();
    // Llegó otra versión (fusión tras 409, conflicto o snapshot): el historial ya no aplica.
    if (current == null || !same(current, state.answers)) {
      this.definition.set(state.answers);
      this.undoStack = [];
      this.redoStack = [];
      this.syncHistory();
    }
  }

  private commit(current: FormDefinition, next: FormDefinition): boolean {
    this.definition.set(next);
    if (this.coordinator?.notifyDocument(next)) return true;
    this.definition.set(current);
    return false;
  }

  private async saveDraft(
    id: string,
    definition: FormDefinition,
    rowVersion: string,
  ): Promise<DraftSaveResult> {
    try {
      const outcome = await firstValueFrom(this.service.updateDraft(id, definition, rowVersion));
      // Un guardado de la plantilla anterior (al cambiar de id) no toca el estado de la nueva.
      const current = this.template()?.id === id;
      if (current) this.issues.set(outcome.issues);
      if (!outcome.updated || !outcome.rowVersion) return { outcome: 'error', error: outcome.issues };
      if (current) {
        this.template.update((item) =>
          item ? { ...item, draftHash: outcome.draftHash ?? item.draftHash } : item,
        );
        this.savedOnce.set(true);
      }
      return { outcome: 'saved', rowVersion: outcome.rowVersion };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) return { outcome: 'conflict' };
      return { outcome: 'error', error };
    }
  }

  private async loadRemote(id: string): Promise<DraftSnapshot<FormDefinition>> {
    const detail = await firstValueFrom(this.service.get(id));
    const remote = JSON.parse(detail.draft) as FormDefinition;
    if (this.template()?.id === id) {
      this.lastRemote = remote;
      this.template.update((current) => (current ? { ...detail, versions: current.versions } : detail));
    }
    return { answers: remote, rowVersion: detail.rowVersion };
  }

  private acceptDetail(detail: FormTemplateDetail): DraftSnapshot<FormDefinition> {
    const definition = JSON.parse(detail.draft) as FormDefinition;
    this.lastRemote = definition;
    this.template.set(detail);
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistory();
    return { answers: definition, rowVersion: detail.rowVersion };
  }

  private syncHistory(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }

  private disposeCoordinator(flushFirst: boolean): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (flushFirst) void this.coordinator?.flushAndDispose();
    else this.coordinator?.dispose();
    this.coordinator = null;
  }
}

const ROOT_LABELS: Readonly<Record<string, string>> = {
  title: 'Form title',
  description: 'Form description',
  purpose: 'Purpose',
  presentation: 'Presentation',
  settings: 'Form settings',
  mappings: 'Profile mappings',
  actions: 'Actions',
  schemaVersion: 'Schema version',
};

function humanize(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sameRuleSets(left: FormDefinition, right: FormDefinition): boolean {
  return (
    same(left.mappings ?? [], right.mappings ?? []) && same(left.actions ?? [], right.actions ?? [])
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
