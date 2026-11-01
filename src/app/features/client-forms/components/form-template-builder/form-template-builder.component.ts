import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import type {
  FormAction,
  FormComponent,
  FormDefinition,
  FormMapping,
  FormPage,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { describeDefinitionPath } from '@shared/utils/data-collection/draft-definition-model';
import type { DraftConflict } from '@shared/utils/data-collection/draft-save-coordinator';
import {
  FormTemplateBuilderStore,
  type BuilderConflictChoice,
} from '../../data-access/form-template-builder.store';
import {
  addComponent,
  addPage,
  addSection,
  duplicateComponent,
  earlierInputComponents,
  findComponent,
  findPage,
  findSection,
  moveComponent,
  removeComponent,
  removePage,
  removeSection,
  updateComponent,
  updatePage,
  updateSection,
} from '../../utils/definition-mutations';
import {
  BuilderPaletteComponent,
  type PaletteComponentDrop,
} from '../../ui/builder-palette/builder-palette.component';
import { BuilderCanvasComponent } from '../../ui/builder-canvas/builder-canvas.component';
import {
  ComponentInspectorComponent,
  type InspectorTab,
} from '../../ui/component-inspector/component-inspector.component';
import { TemplateSettingsPanelComponent } from '../../ui/template-settings-panel/template-settings-panel.component';
import { MappingCatalogStore } from '../../data-access/mapping-catalog.store';
import { FormTemplatesService } from '../../data-access/form-templates.service';
import type { ClientFormsCapabilities } from '../../data-access/client-forms.model';
import { CONFIGURE_ACTIONS_PERMISSION } from '../../utils/form-action-catalog';
import {
  mappingReferences,
  removeMapping,
  setActions,
  setComponentMapping,
  withoutComponentMappings,
  withoutStaleRowFields,
  type MappingRemoval,
} from '../../utils/mapping-mutations';
import type { CoverageFix } from '../../utils/mapping-coverage';
import { PreviewPanelComponent } from '../../ui/preview-panel/preview-panel.component';
import { LibraryUpdateBannerComponent } from '../../ui/library-update-banner/library-update-banner.component';
import { IssuesPanelComponent } from '../../ui/issues-panel/issues-panel.component';
import { VersionHistoryDrawerComponent } from '../../ui/version-history-drawer/version-history-drawer.component';
import { BuilderOutlineComponent } from '../../ui/builder-outline/builder-outline.component';
import { StructureInspectorComponent } from '../../ui/structure-inspector/structure-inspector.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { LaunchOverlayComponent } from '@shared/ui/launch-overlay/launch-overlay.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { runWithLaunch, type LaunchPhase } from '@shared/utils/launch.util';
import { SegmentedComponent, type SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';
import {
  DropdownMenuComponent,
  MenuItemDirective,
} from '@shared/ui/dropdown-menu/dropdown-menu.component';

type TemplateTab = 'structure' | 'actions' | 'coverage';

@Component({
  selector: 'app-form-template-builder',
  imports: [
    LaunchOverlayComponent,
    ModalComponent,
    SkeletonComponent,
    StatusPillComponent,
    BuilderPaletteComponent,
    BuilderCanvasComponent,
    BuilderOutlineComponent,
    ComponentInspectorComponent,
    StructureInspectorComponent,
    PreviewPanelComponent,
    LibraryUpdateBannerComponent,
    IssuesPanelComponent,
    VersionHistoryDrawerComponent,
    ConfirmDialogComponent,
    DrawerComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    SegmentedComponent,
    ClickOutsideDirective,
    TemplateSettingsPanelComponent,
  ],
  providers: [MappingCatalogStore],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="builder flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-gray-100 bg-white shadow-sm"
    >
      <!-- En lg+ el navbar flota arriba a la derecha: la fila entera queda a la izquierda del hueco
           y, si no entra, las acciones bajan a una segunda línea en vez de quedar tapadas. -->
      <header
        class="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-3 lg:min-h-[var(--shell-notch-height)] lg:pr-[var(--shell-notch-width)]"
      >
        <div class="flex min-w-[12rem] flex-1 items-center gap-3">
          <button
            type="button"
            class="icon-button shrink-0"
            aria-label="Back to templates"
            (click)="back()"
          >
            <ion-icon name="arrow-back-outline"></ion-icon>
          </button>
          <div class="min-w-0">
            <h1 class="truncate text-lg font-bold text-gray-900">
              {{ store.template()?.name || 'Form template' }}
            </h1>
            <div class="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
              <app-status-pill
                class="shrink-0"
                [tone]="store.template()?.latestVersionNumber ? 'success' : 'neutral'"
                [soft]="true"
                size="xs"
                >{{
                  store.template()?.latestVersionNumber
                    ? 'Published v' + store.template()!.latestVersionNumber
                    : 'Draft'
                }}</app-status-pill
              >
              <span
                class="flex min-w-0 items-center gap-1 truncate"
                [class.text-gray-500]="!saveProblem()"
                [class.text-red-700]="saveProblem()"
                aria-live="polite"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  [class]="saveDotClass()"
                  aria-hidden="true"
                ></span
                >{{ saveLabel() }}
              </span>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <div class="flex items-center">
            <button
              type="button"
              class="icon-button"
              aria-label="Undo"
              title="Undo"
              [disabled]="editingLocked() || !store.canUndo()"
              (click)="store.undo()"
            >
              <ion-icon name="arrow-undo-outline"></ion-icon>
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label="Redo"
              title="Redo"
              [disabled]="editingLocked() || !store.canRedo()"
              (click)="store.redo()"
            >
              <ion-icon name="arrow-redo-outline"></ion-icon>
            </button>
          </div>
          <button
            type="button"
            class="action-secondary"
            aria-label="Validate"
            title="Validate"
            (click)="validate()"
          >
            <ion-icon name="checkmark-done-outline"></ion-icon
            ><span class="builder-label">Validate</span>
          </button>
          <button
            type="button"
            class="action-secondary"
            aria-label="Preview"
            title="Preview"
            (click)="openPreview()"
          >
            <ion-icon name="eye-outline"></ion-icon><span class="builder-label">Preview</span>
          </button>
          <app-dropdown-menu ariaLabel="Template actions">
            <button appMenuItem type="button" (click)="openVersions()">
              <ion-icon name="time-outline"></ion-icon> Versions
            </button>
            <button appMenuItem type="button" (click)="duplicateDraft()">
              <ion-icon name="copy-outline"></ion-icon> Duplicate
            </button>
            @if (store.template()?.status === 'Active') {
              <button
                appMenuItem
                [danger]="true"
                type="button"
                [disabled]="editingLocked()"
                (click)="archiveOpen.set(true)"
              >
                <ion-icon name="archive-outline"></ion-icon> Archive
              </button>
            }
          </app-dropdown-menu>
          <button
            type="button"
            class="action-primary"
            [disabled]="store.publishing() || !canPublish() || editingLocked()"
            [attr.title]="canPublish() ? null : 'Only an admin can publish this template'"
            (click)="requestPublish()"
          >
            <ion-icon name="rocket-outline"></ion-icon
            >{{ canPublish() ? 'Publish' : 'Ask an admin to publish' }}
          </button>
        </div>
      </header>

      <app-library-update-banner [origin]="store.template()?.libraryOrigin ?? null" />

      @if (store.readOnly()) {
        <div
          class="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900"
          role="status"
        >
          <span>This template is open in another tab. Changes here are paused.</span>
          <button type="button" class="action-secondary" (click)="store.takeControl()">
            Use it here
          </button>
        </div>
      }

      @if (store.loading()) {
        <!-- Esqueleto con la forma del builder (paleta · lienzo · inspector): nada salta al cargar. -->
        <div
          class="grid flex-1 gap-4 p-5 lg:grid-cols-[14rem_minmax(0,1fr)_16rem]"
          role="status"
          aria-label="Loading builder"
        >
          <app-skeleton class="hidden lg:block" variant="rows" [rows]="9" minHeight="24rem" />
          <app-skeleton variant="card" [rows]="7" minHeight="24rem" />
          <app-skeleton class="hidden lg:block" variant="rows" [rows]="6" minHeight="24rem" />
        </div>
      } @else if (store.error()) {
        <div class="m-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {{ store.error() }}
        </div>
      } @else if (store.definition(); as definition) {
        @if (store.actionError()) {
          <!-- Fallos de acciones: aviso descartable; el builder sigue a la vista. -->
          <div
            class="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800"
            role="alert"
            data-testid="builder-action-error"
          >
            <span>{{ store.actionError() }}</span>
            <button
              type="button"
              class="icon-button !h-8 !w-8 shrink-0 !text-red-800"
              aria-label="Dismiss message"
              (click)="store.dismissActionError()"
            >
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
        }
        <div class="builder-enter flex flex-1 min-h-0 flex-col">
          <div class="flex flex-1 items-center justify-center p-8 text-center lg:hidden">
            <div>
              <ion-icon name="desktop-outline" class="text-4xl text-brand-bold"></ion-icon>
              <h2 class="mt-3 text-xl font-bold text-gray-900">
                The form builder works best on a larger screen
              </h2>
              <p class="mt-2 max-w-sm text-sm text-gray-600">
                You can review this template here. Use a screen at least 1024 px wide to make
                changes.
              </p>
              <button type="button" class="action-secondary mt-5" (click)="openPreview()">
                Open preview
              </button>
            </div>
          </div>
          <!-- Columnas por ancho del contenedor (no del viewport): el sidebar del CRM cambia el ancho
               disponible. Angosto: riel + panel flotante; ancho: paleta/outline fija. Ver estilos. -->
          <div class="builder-grid hidden min-h-0 flex-1 lg:grid">
            <div
              class="builder-left relative flex min-h-0 border-r border-gray-200 bg-white"
              appClickOutside
              [clickOutsideEnabled]="leftOpen()"
              (appClickOutside)="leftOpen.set(false)"
              (keydown.escape)="closeLeftPanel()"
            >
              <div class="builder-rail w-full flex-col items-center gap-1 py-3">
                <button
                  type="button"
                  #railComponents
                  class="rail-button"
                  [class.is-active]="leftOpen() && leftTab() === 'components'"
                  aria-controls="builder-left-panel"
                  [attr.aria-expanded]="leftOpen() && leftTab() === 'components'"
                  (click)="toggleLeft('components')"
                >
                  <ion-icon name="add-circle-outline" class="text-xl"></ion-icon>
                  <span>Add</span>
                </button>
                <button
                  type="button"
                  #railOutline
                  class="rail-button"
                  [class.is-active]="leftOpen() && leftTab() === 'outline'"
                  aria-controls="builder-left-panel"
                  [attr.aria-expanded]="leftOpen() && leftTab() === 'outline'"
                  (click)="toggleLeft('outline')"
                >
                  <ion-icon name="list-outline" class="text-xl"></ion-icon>
                  <span>Outline</span>
                </button>
              </div>
              <div
                id="builder-left-panel"
                class="builder-left-panel min-h-0 flex-col bg-white"
                [class.is-open]="leftOpen()"
                [class.is-dragging]="paletteDragging()"
                [class.is-highlighted]="paletteHighlight()"
              >
                <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
                  <app-segmented
                    class="min-w-0 flex-1"
                    [fill]="true"
                    [options]="leftTabs"
                    [value]="leftTab()"
                    (valueChange)="leftTab.set($event)"
                  />
                  <button
                    type="button"
                    class="builder-left-close icon-button !h-8 !w-8 shrink-0"
                    aria-label="Close panel"
                    (click)="leftOpen.set(false)"
                  >
                    <ion-icon name="close-outline"></ion-icon>
                  </button>
                </div>
                <!-- Un solo scroll para la pestaña activa: outline y paleta ya no se pisan. -->
                <div #leftScroll class="min-h-0 flex-1 overflow-y-auto">
                  @if (leftTab() === 'components') {
                    <app-builder-palette
                      [disabled]="editingLocked()"
                      [targetLabel]="targetLabel()"
                      [disabledTypes]="canConfigureActions() ? [] : ['signatureStep']"
                      disabledReason="Adding a signature step also adds an action. Ask someone with Configure actions."
                      (componentAdded)="addField($event)"
                      (componentDropped)="dropField($event)"
                      (draggingChange)="paletteDragging.set($event)"
                    />
                  } @else {
                    <app-builder-outline
                      [definition]="definition"
                      [selection]="store.selection()"
                      (selected)="store.select($event)"
                    />
                  }
                </div>
              </div>
            </div>
            <app-builder-canvas
              class="block min-h-0 min-w-0"
              [definition]="definition"
              [selection]="store.selection()"
              [disabled]="editingLocked()"
              (selected)="store.select($event)"
              (pageAdded)="store.change(addPage)"
              (sectionAdded)="addSectionTo($event)"
              (move)="moveField($event)"
              (addRequested)="openPalette($event)"
            />
            <div class="min-h-0 min-w-0 overflow-y-auto border-l border-gray-200 bg-white">
              @if (selectedComponent()) {
                <app-component-inspector
                  [component]="selectedComponent()"
                  [earlierFields]="earlierFields()"
                  [disabled]="editingLocked()"
                  [canMap]="canConfigureActions()"
                  [preferredTab]="inspectorTab()"
                  [definition]="definition"
                  [mappingCatalog]="catalogStore.catalog()"
                  [mappingLoading]="catalogStore.loading()"
                  [mappingError]="catalogStore.error()"
                  (componentChange)="updateField($event)"
                  (removed)="removeField()"
                  (duplicated)="duplicateField()"
                  (mappingChange)="updateSelectedMapping('component', $event)"
                  (mappingRetry)="catalogStore.reload()"
                />
              } @else {
                <!-- Pestañas de plantilla: "After submission" y "Mapping coverage" exigen configure_actions (P-16/P-17). -->
                @if (canConfigureActions()) {
                  <div class="px-4 pt-4">
                    <app-segmented
                      [columns]="1"
                      [options]="templateTabs"
                      [value]="activeTemplateTab()"
                      (valueChange)="openTemplateTab($event)"
                    />
                  </div>
                }
                @switch (activeTemplateTab()) {
                  @case ('structure') {
                    <app-structure-inspector
                      [page]="selectedPage()"
                      [section]="selectedSection()"
                      [earlierFields]="earlierFields()"
                      [disabled]="editingLocked()"
                      [canMap]="canConfigureActions()"
                      [definition]="definition"
                      [mappingCatalog]="catalogStore.catalog()"
                      [mappingLoading]="catalogStore.loading()"
                      [mappingError]="catalogStore.error()"
                      (pageChange)="updateSelectedPage($event)"
                      (sectionChange)="updateSelectedSection($event)"
                      (mappingChange)="updateSelectedMapping('section', $event)"
                      (mappingRetry)="catalogStore.reload()"
                      [canRemove]="canRemoveStructure()"
                      (removed)="requestRemoveStructure()"
                    />
                  }
                  @default {
                    <div class="px-4 py-4">
                      <app-template-settings-panel
                        [panel]="activeTemplateTab() === 'actions' ? 'actions' : 'coverage'"
                        [definition]="definition"
                        [catalog]="catalogStore.catalog()"
                        [catalogLoading]="catalogStore.loading()"
                        [catalogError]="catalogStore.error()"
                        [modules]="modules()"
                        [autoCustomerCreationEnabled]="capabilities()?.autoCustomerCreationEnabled ?? null"
                        [disabled]="editingLocked()"
                        [focusActionKey]="coverageFocus()"
                        (actionsChange)="updateActions($event)"
                        (coverageRequested)="showCoverage($event)"
                        (componentSelected)="selectElement($event, true)"
                        (mappingRemoved)="removeMappingEntry($event)"
                        (fixApplied)="applyCoverageFix($event)"
                        (actionSelected)="openTemplateTab('actions')"
                        (retry)="catalogStore.reload()"
                      />
                    </div>
                  }
                }
              }
            </div>
          </div>
          <app-builder-issues-panel
            [issues]="store.issues()"
            (issueSelected)="selectIssue($event)"
          />
        </div>
        <app-form-preview-panel
          [isOpen]="store.previewOpen()"
          [definition]="versionPreview() || definition"
          [heading]="
            versionPreviewNumber() ? 'Published version ' + versionPreviewNumber() : 'Preview form'
          "
          [subheading]="
            versionPreviewNumber()
              ? 'Published versions are immutable.'
              : 'This uses the same renderer as the client experience.'
          "
          (closed)="closePreview()"
        />
        <app-version-history-drawer
          [isOpen]="store.versionsOpen()"
          [versions]="store.template()?.versions || []"
          (closed)="store.versionsOpen.set(false)"
          (viewed)="viewVersion($event)"
          [restoreDisabled]="editingLocked()"
          (restored)="restore($event)"
          (duplicated)="duplicateVersion($event)"
        />
      }
    </section>

    <app-launch-overlay
      variant="publish"
      exit="hold"
      [phase]="launch()"
      [badge]="'v' + publishingVersion()"
      [workingCaption]="'Publishing version ' + publishingVersion() + '…'"
      [doneCaption]="'Version ' + publishingVersion() + ' is live'"
    />

    <app-confirm-dialog
      [isOpen]="publishOpen()"
      [heading]="'Publish version ' + ((store.template()?.latestVersionNumber || 0) + 1)"
      message="Requests created from this version stay pinned to it. Later edits create a new version."
      confirmLabel="Publish version"
      tone="primary"
      [busy]="store.publishing()"
      (cancelled)="publishOpen.set(false)"
      (confirmed)="publish()"
      ><p class="mt-4 text-sm font-semibold text-gray-900">
        {{ componentCount() }} {{ componentCount() === 1 ? 'component' : 'components' }}
      </p></app-confirm-dialog
    >

    <app-confirm-dialog
      [isOpen]="archiveOpen()"
      heading="Archive template?"
      message="Existing requests and published versions remain available, but this template cannot be assigned to new requests."
      confirmLabel="Archive"
      tone="danger"
      (cancelled)="archiveOpen.set(false)"
      (confirmed)="archive()"
    />

    @if (store.conflicts().length > 0) {
      <app-drawer
        [isOpen]="true"
        heading="This template was changed elsewhere"
        subheading="Choose a version for every item changed by both people. Nothing is saved until you choose."
        width="xl"
      >
        <div class="space-y-3">
          @for (conflict of store.conflicts(); track conflict.id; let index = $index) {
            <fieldset class="rounded-2xl border border-gray-200 p-4">
              <legend class="px-1 text-sm font-bold text-gray-900">{{ conflict.label }}</legend>
              <div class="mt-2 grid gap-3 sm:grid-cols-2">
                <label class="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm">
                  <input
                    type="radio"
                    class="mt-1"
                    [name]="'builder-conflict-' + index"
                    [checked]="conflictChoices()[conflict.id] === 'mine'"
                    (change)="choose(conflict.id, 'mine')"
                  />
                  <span class="min-w-0">
                    <span class="block font-semibold text-gray-900">Keep mine</span>
                    <span class="block break-words text-gray-600">{{
                      describeConflict(conflict, 'mine')
                    }}</span>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm">
                  <input
                    type="radio"
                    class="mt-1"
                    [name]="'builder-conflict-' + index"
                    [checked]="conflictChoices()[conflict.id] === 'theirs'"
                    (change)="choose(conflict.id, 'theirs')"
                  />
                  <span class="min-w-0">
                    <span class="block font-semibold text-gray-900">Keep theirs</span>
                    <span class="block break-words text-gray-600">{{
                      describeConflict(conflict, 'theirs')
                    }}</span>
                  </span>
                </label>
              </div>
            </fieldset>
          }
        </div>
        <button
          drawerFooter
          type="button"
          class="action-primary"
          [disabled]="!allConflictsChosen()"
          (click)="resolveConflicts()"
        >
          Resolve and save
        </button>
      </app-drawer>
    }

    <app-confirm-dialog
      [isOpen]="leaveOpen()"
      heading="Leave without saving?"
      message="Some changes could not be saved yet. If you leave now, they will be lost."
      confirmLabel="Leave anyway"
      tone="danger"
      (cancelled)="answerLeave(false)"
      (confirmed)="answerLeave(true)"
    />

    <!-- Avisos con app-modal: animación, Escape, focus-trap y bloqueo de scroll como el resto. -->
    <app-modal
      [isOpen]="mappingNotice() !== null"
      heading="This change needs Configure actions"
      size="sm"
      (closed)="mappingNotice.set(null)"
    >
      <p class="mt-3 text-sm text-gray-600" data-testid="builder-mapping-notice">{{ mappingNotice() }}</p>
      <div class="mt-6 flex justify-end">
        <button type="button" class="action-secondary" (click)="mappingNotice.set(null)">Got it</button>
      </div>
    </app-modal>

    <app-confirm-dialog
      [isOpen]="structureRemoval() !== null"
      [heading]="structureRemoval()?.kind === 'page' ? 'Delete this page?' : 'Delete this section?'"
      [message]="structureRemovalMessage()"
      confirmLabel="Delete"
      tone="danger"
      (cancelled)="structureRemoval.set(null)"
      (confirmed)="confirmRemoveStructure()"
    />

    <app-modal
      [isOpen]="blockedRemoval() !== null"
      [heading]="'This ' + blockedSubject() + ' is used by conditions'"
      [subheading]="'Remove those conditions before deleting the ' + blockedSubject() + '.'"
      size="sm"
      (closed)="blockedRemoval.set(null)"
    >
      <ul class="mt-4 space-y-2">
        @for (item of blockedRemoval() ?? []; track item.ownerId + item.property) {
          <li class="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <ion-icon name="git-branch-outline" class="shrink-0 text-gray-400"></ion-icon>
            <span class="font-medium text-gray-900">{{ item.ownerLabel }}</span>
            <span class="text-gray-400">· {{ item.property }}</span>
          </li>
        }
      </ul>
      <div class="mt-6 flex justify-end">
        <button type="button" class="action-secondary" (click)="blockedRemoval.set(null)">Got it</button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .icon-button {
        display: inline-flex;
        height: 2.5rem;
        width: 2.5rem;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        color: #4b5563;
      }
      .icon-button:hover {
        background: #f3f4f6;
      }
      .icon-button:disabled {
        opacity: 0.35;
      }
      .action-primary,
      .action-secondary {
        display: inline-flex;
        min-height: 2.5rem;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        padding: 0.5rem 0.9rem;
        font-size: 0.8125rem;
        font-weight: 700;
        border-radius: 9999px;
      }
      .action-primary {
        background: #1e466b;
        color: white;
      }
      /* Entrada del editor al terminar de cargar (o al llegar desde "New template"). */
      .builder-enter {
        animation: builder-in 360ms cubic-bezier(0.2, 0, 0, 1) both;
      }
      @keyframes builder-in {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          /* "none": un transform activo encerraría el panel flotante y los fixed del builder. */
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .builder-enter {
          animation: none;
        }
      }
      .action-primary:hover {
        background: #132c43;
      }
      .action-primary:disabled {
        opacity: 0.5;
      }
      .action-secondary {
        border: 1px solid #d1d5db;
        background: white;
        color: #374151;
      }
      .action-secondary:hover {
        background: #f9fafb;
      }
      .action-primary ion-icon,
      .action-secondary ion-icon {
        font-size: 1rem;
      }

      /* Layout por ancho del builder (container query): el sidebar del CRM expandido o colapsado
         cambia el espacio real, así que el viewport no sirve para decidir columnas. */
      .builder {
        container: builder / inline-size;
      }
      .builder-grid {
        grid-template-rows: minmax(0, 1fr);
        grid-template-columns: 4rem minmax(0, 1fr) 17rem;
      }
      .builder-rail {
        display: flex;
      }
      .rail-button {
        display: flex;
        width: 3.25rem;
        flex-direction: column;
        align-items: center;
        gap: 0.15rem;
        padding: 0.5rem 0.25rem;
        border-radius: 1rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: #4b5563;
      }
      .rail-button ion-icon {
        color: #1e466b;
      }
      .rail-button:hover,
      .rail-button.is-active {
        background: #eef3f8;
        color: #111827;
      }
      /* Angosto: el panel flota sobre el canvas y se abre desde el riel. */
      .builder-left-panel {
        display: none;
        position: absolute;
        top: 0;
        bottom: 0;
        left: 100%;
        z-index: 30;
        width: 16.5rem;
        border-right: 1px solid #e5e7eb;
        box-shadow: 0 20px 40px -12px rgb(15 23 42 / 0.25);
      }
      .builder-left-panel.is-open {
        display: flex;
      }
      /* Arrastrando desde el panel flotante: no tapa el canvas ni recibe el drop. */
      .builder-left-panel.is-open.is-dragging {
        visibility: hidden;
        pointer-events: none;
      }
      .builder-left-panel.is-highlighted {
        box-shadow:
          inset 0 0 0 2px #93b4d4,
          0 20px 40px -12px rgb(15 23 42 / 0.25);
      }
      @container builder (min-width: 62rem) {
        .builder-grid {
          grid-template-columns: 14rem minmax(0, 1fr) 18rem;
        }
        .builder-rail,
        .builder-left-close {
          display: none;
        }
        .builder-left-panel {
          display: flex;
          position: static;
          flex: 1 1 auto;
          width: auto;
          min-width: 0;
          border-right: 0;
          box-shadow: none;
        }
        .builder-left-panel.is-highlighted {
          box-shadow: inset 0 0 0 2px #93b4d4;
        }
      }
      @container builder (min-width: 80rem) {
        .builder-grid {
          grid-template-columns: 16rem minmax(0, 1fr) 21rem;
        }
      }
      /* Header angosto: Validate y Preview quedan solo con icono (title + aria-label). */
      @container builder (max-width: 56rem) {
        .builder-label {
          display: none;
        }
      }
    `,
  ],
})
export class FormTemplateBuilderComponent implements OnInit, OnDestroy {
  @ViewChild(BuilderCanvasComponent) private canvas?: BuilderCanvasComponent;
  @ViewChild('leftScroll') private leftScroll?: ElementRef<HTMLElement>;
  @ViewChild('railComponents') private railComponents?: ElementRef<HTMLButtonElement>;
  @ViewChild('railOutline') private railOutline?: ElementRef<HTMLButtonElement>;
  readonly store = inject(FormTemplateBuilderStore);
  readonly catalogStore = inject(MappingCatalogStore);
  private readonly templates = inject(FormTemplatesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly access = inject(AccessStore);
  private readonly toast = inject(ToastService);
  readonly publishOpen = signal(false);
  readonly launch = signal<LaunchPhase>('idle');
  // Se fija al iniciar el publish: el detalle se refresca a mitad de la coreografía y cambiaría el número.
  readonly publishingVersion = signal(1);
  readonly archiveOpen = signal(false);
  readonly blockedRemoval = signal<ReturnType<typeof removeComponent>['blockedBy'] | null>(null);
  /** Qué se intentaba borrar cuando lo bloquearon las condiciones (título del aviso). */
  readonly blockedSubject = signal<'field' | 'section' | 'page'>('field');
  /** Sección o página pendiente de confirmar su borrado. */
  readonly structureRemoval = signal<{ kind: 'section' | 'page'; id: string; fields: number } | null>(null);
  readonly canRemoveStructure = computed(() => {
    const definition = this.store.definition();
    const section = this.selectedSection();
    if (!definition) return false;
    if (section) return (definition.pages.find((page) => page.sections.some((s) => s.id === section.id))?.sections.length ?? 0) > 1;
    return this.selectedPage() != null && definition.pages.length > 1;
  });
  readonly structureRemovalMessage = computed(() => {
    const pending = this.structureRemoval();
    if (!pending) return '';
    const what = pending.kind === 'page' ? 'page' : 'section';
    return pending.fields > 0
      ? `This ${what} and its ${pending.fields} ${pending.fields === 1 ? 'component' : 'components'} will be removed from the template.`
      : `This empty ${what} will be removed from the template.`;
  });
  readonly conflictChoices = signal<Record<string, BuilderConflictChoice>>({});
  readonly leaveOpen = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private loadedId: string | null = null;
  private leaveAnswer: ((leave: boolean) => void) | null = null;
  readonly versionPreview = signal<FormDefinition | null>(null);
  readonly versionPreviewNumber = signal<number | null>(null);
  readonly canPublish = computed(() => this.access.can('tasks.form_templates.publish'));
  /** Mapeo de datos y acciones posteriores al envío (P-16/P-17). */
  readonly canConfigureActions = computed(() => this.access.can(CONFIGURE_ACTIONS_PERMISSION));
  readonly modules = this.access.enabledModules;
  /** Sub-flags de la oficina (`GET tasks/forms/availability`); null si no se conocen. */
  readonly capabilities = signal<ClientFormsCapabilities | null>(null);
  /** Pestaña de plantilla de la columna derecha cuando no hay campo seleccionado. */
  readonly templateTab = signal<TemplateTab>('structure');
  readonly templateTabs: readonly SegmentedOption<TemplateTab>[] = [
    { id: 'structure', label: 'Page & section' },
    { id: 'actions', label: 'After submission' },
    { id: 'coverage', label: 'Mapping coverage' },
  ];
  /** Con una página o sección elegida manda el inspector de estructura. */
  readonly activeTemplateTab = computed<TemplateTab>(() => {
    const kind = this.store.selection()?.kind;
    if (!this.canConfigureActions() || kind === 'page' || kind === 'section') return 'structure';
    return this.templateTab();
  });
  /** Pide al inspector de campo una pestaña (link de cobertura o de issue → "Mapping"). */
  readonly inspectorTab = signal<InspectorTab | null>(null);
  /** Acción a enfocar en "Mapping coverage" al llegar desde "After submission". */
  readonly coverageFocus = signal<string | null>(null);
  /** Sin control de la pestaña o con conflicto pendiente, toda la edición queda deshabilitada. */
  readonly editingLocked = computed(
    () => this.store.readOnly() || this.store.conflicts().length > 0,
  );
  readonly addPage = addPage;
  /** Columna izquierda: una pestaña a la vez, con un único scroll. */
  readonly leftTab = signal<'components' | 'outline'>('components');
  readonly leftTabs: readonly SegmentedOption<'components' | 'outline'>[] = [
    { id: 'components', label: 'Components' },
    { id: 'outline', label: 'Outline' },
  ];
  /** Solo se nota en anchos angostos, donde el panel flota sobre el canvas. */
  readonly leftOpen = signal(false);
  readonly paletteHighlight = signal(false);
  /** Arrastre desde la paleta en curso (el panel flotante deja pasar el drop). */
  readonly paletteDragging = signal(false);
  /** Explicación cuando una edición tocaría el mapeo o las acciones sin permiso. */
  readonly mappingNotice = signal<string | null>(null);
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** Sección donde cae un componente agregado con clic, según lo seleccionado. */
  readonly target = computed(() => {
    const definition = this.store.definition();
    if (!definition) return null;
    const selection = this.store.selection();
    const sections = definition.pages.flatMap((page) =>
      page.sections.map((section) => ({ page, section })),
    );
    let hit = sections[0];
    let index: number | null = null;
    if (selection?.kind === 'section') {
      hit = sections.find((item) => item.section.id === selection.id) ?? hit;
    } else if (selection?.kind === 'page') {
      hit = sections.find((item) => item.page.id === selection.id) ?? hit;
    } else if (selection?.kind === 'component') {
      const owner = sections.find((item) =>
        item.section.components.some((component) => component.id === selection.id),
      );
      if (owner) {
        hit = owner;
        index = owner.section.components.findIndex((component) => component.id === selection.id) + 1;
      }
    }
    if (!hit) return null;
    return { section: hit.section, page: hit.page, index: index ?? hit.section.components.length };
  });
  readonly targetLabel = computed(() => {
    const target = this.target();
    const definition = this.store.definition();
    if (!target || !definition) return '';
    const sectionNumber =
      definition.pages
        .flatMap((page) => page.sections)
        .findIndex((section) => section.id === target.section.id) + 1;
    const section = target.section.title || `Section ${sectionNumber}`;
    if (definition.pages.length < 2) return section;
    const pageNumber = definition.pages.findIndex((page) => page.id === target.page.id) + 1;
    return `${section} · ${target.page.title || 'Page ' + pageNumber}`;
  });

  readonly selectedComponent = computed(() => {
    const definition = this.store.definition();
    const selection = this.store.selection();
    return definition && selection?.kind === 'component'
      ? findComponent(definition, selection.id)
      : null;
  });
  readonly selectedPage = computed(() => {
    const definition = this.store.definition();
    const selection = this.store.selection();
    return definition && selection?.kind === 'page' ? findPage(definition, selection.id) : null;
  });
  readonly selectedSection = computed(() => {
    const definition = this.store.definition();
    const selection = this.store.selection();
    return definition && selection?.kind === 'section'
      ? findSection(definition, selection.id)
      : null;
  });
  readonly earlierFields = computed(() => {
    const definition = this.store.definition();
    const selection = this.store.selection();
    if (!definition || !selection) return [];
    return earlierInputComponents(definition, selection);
  });
  readonly componentCount = computed(
    () =>
      this.store
        .definition()
        ?.pages.reduce(
          (total, page) =>
            total + page.sections.reduce((sum, section) => sum + section.components.length, 0),
          0,
        ) ?? 0,
  );
  readonly allConflictsChosen = computed(() =>
    this.store.conflicts().every((item) => this.conflictChoices()[item.id] != null),
  );

  constructor() {
    effect(() => this.store.lockRuleSets(!this.canConfigureActions()));
  }

  ngOnInit(): void {
    if (this.canConfigureActions()) {
      void this.catalogStore.load();
      void this.loadCapabilities();
    }
    // La ruta reutiliza este componente al cambiar de plantilla: cada id nuevo recarga el store.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.loadedId) return;
      this.loadedId = id;
      this.conflictChoices.set({});
      this.versionPreview.set(null);
      this.versionPreviewNumber.set(null);
      this.publishOpen.set(false);
      this.archiveOpen.set(false);
      void this.store.load(id);
    });
  }
  ngOnDestroy(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.answerLeave(false);
    this.store.dispose();
  }

  /** Guard de salida: espera el guardado y, si no se pudo, pregunta antes de perder cambios. */
  async canDeactivate(): Promise<boolean> {
    if (await this.store.trySave()) return true;
    this.answerLeave(false);
    this.leaveOpen.set(true);
    return new Promise<boolean>((resolve) => (this.leaveAnswer = resolve));
  }

  answerLeave(leave: boolean): void {
    this.leaveOpen.set(false);
    const answer = this.leaveAnswer;
    this.leaveAnswer = null;
    answer?.(leave);
  }
  back(): void {
    void this.router.navigate(['/client-forms']);
  }
  saveProblem(): boolean {
    const status = this.store.saveStatus();
    return status === 'error' || status === 'conflict';
  }
  saveDotClass(): string {
    const status = this.store.saveStatus();
    if (status === 'error' || status === 'conflict') return 'bg-red-500';
    if (status === 'queued' || status === 'saving') return 'bg-amber-400';
    return 'bg-emerald-500';
  }
  toggleLeft(tab: 'components' | 'outline'): void {
    const same = this.leftOpen() && this.leftTab() === tab;
    this.leftTab.set(tab);
    this.leftOpen.set(!same);
  }
  /** "Add a component" del canvas: selecciona la sección y lleva a la paleta. */
  openPalette(sectionId: string): void {
    this.store.select({ kind: 'section', id: sectionId });
    this.leftTab.set('components');
    this.leftOpen.set(true);
    this.paletteHighlight.set(true);
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.paletteHighlight.set(false), 1600);
    setTimeout(() => {
      const scroll = this.leftScroll?.nativeElement;
      if (!scroll) return;
      scroll.scrollTop = 0;
      scroll.querySelector<HTMLButtonElement>('app-builder-palette button:not([disabled])')?.focus();
    });
  }
  saveLabel(): string {
    const labels = {
      idle: 'No changes',
      queued: 'Unsaved changes',
      saving: 'Saving…',
      saved: 'Saved',
      conflict: 'Conflict needs attention',
      error: 'Save failed',
    };
    return labels[this.store.saveStatus()];
  }
  addSectionTo(pageId: string): void {
    this.store.change((definition) => addSection(definition, pageId));
  }
  addField(type: string): void {
    const target = this.target();
    if (target) this.insertField(type, target.section.id, target.index);
  }
  dropField(event: PaletteComponentDrop): void {
    const target = this.canvas?.dropTarget(event.point);
    if (target) this.insertField(event.type, target.sectionId, target.index);
  }
  moveField(event: { id: string; sectionId: string; index: number }): void {
    const definition = this.store.definition();
    if (!definition) return;
    const blocked = this.canConfigureActions() ? null : this.moveBlockedByMapping(definition, event);
    if (blocked) {
      this.mappingNotice.set(blocked);
      return;
    }
    // Con permiso, sacar un campo de su repeater lo saca de las filas de ese mapeo.
    this.store.change((current) =>
      withoutStaleRowFields(moveComponent(current, event.id, event.sectionId, event.index), event.id),
    );
  }
  updateField(update: Partial<FormComponent>): void {
    const selected = this.selectedComponent();
    if (selected)
      this.store.change((definition) => updateComponent(definition, selected.id, update));
  }
  // "Limit to 80" desde la cobertura: el mismo arreglo que ofrece el editor de mapeo del campo.
  applyCoverageFix(fix: CoverageFix): void {
    this.store.change((definition) => updateComponent(definition, fix.componentId, fix.patch));
  }
  updateSelectedPage(update: Partial<FormPage>): void {
    const selected = this.selectedPage();
    if (selected) this.store.change((definition) => updatePage(definition, selected.id, update));
  }
  updateSelectedSection(update: Partial<FormSection>): void {
    const selected = this.selectedSection();
    if (selected) this.store.change((definition) => updateSection(definition, selected.id, update));
  }
  duplicateField(): void {
    const selected = this.selectedComponent();
    if (selected) this.store.change((definition) => duplicateComponent(definition, selected.id));
  }
  removeField(): void {
    const selected = this.selectedComponent();
    const definition = this.store.definition();
    if (!selected || !definition) return;
    const result = removeComponent(definition, selected.id);
    if (result.blockedBy.length) {
      this.blockedSubject.set('field');
      this.blockedRemoval.set(result.blockedBy);
      return;
    }
    // Sin configure_actions el backend rechaza tocar mappings/actions: se explica en vez de romper el guardado.
    if (!this.canConfigureActions()) {
      const references = mappingReferences(definition, selected.id);
      if (references.own || references.rowsOf.length > 0) {
        this.mappingNotice.set(
          'This field feeds a data mapping. Ask someone with Configure actions to remove the mapping first.',
        );
        return;
      }
      if (selected.type === 'signatureStep') {
        this.mappingNotice.set(
          'The signature step comes with a Request signature action. Ask someone with Configure actions to remove it.',
        );
        return;
      }
    }
    // El mapeo del campo borrado (propio o como fila de un repeater) no sobrevive.
    this.store.change(() => withoutComponentMappings(result.definition, selected.id));
    this.store.select(null);
  }
  /** Borrar sección o página: mismas reglas que un campo (condiciones, mapeos) y confirmación. */
  requestRemoveStructure(): void {
    const definition = this.store.definition();
    const section = this.selectedSection();
    const page = section ? null : this.selectedPage();
    if (!definition || (!section && !page) || !this.canRemoveStructure()) return;
    const kind = section ? 'section' : 'page';
    const result = section ? removeSection(definition, section.id) : removePage(definition, page!.id);
    if (result.lastOne) return;
    if (result.blockedBy.length) {
      this.blockedSubject.set(kind);
      this.blockedRemoval.set(result.blockedBy);
      return;
    }
    const sections = section ? [section] : page!.sections;
    if (!this.canConfigureActions()) {
      const mapped =
        sections.some((item) => mappingReferences(definition, item.id).own) ||
        result.removedComponentIds.some((id) => {
          const references = mappingReferences(definition, id);
          return references.own || references.rowsOf.length > 0;
        });
      if (mapped) {
        this.mappingNotice.set(
          `This ${kind} has fields that feed a data mapping. Ask someone with Configure actions to remove the mapping first.`,
        );
        return;
      }
      if (sections.some((item) => item.components.some((component) => component.type === 'signatureStep'))) {
        this.mappingNotice.set(
          `This ${kind} has the signature step, which comes with a Request signature action. Ask someone with Configure actions to remove it.`,
        );
        return;
      }
    }
    this.structureRemoval.set({
      kind,
      id: section?.id ?? page!.id,
      fields: sections.reduce((total, item) => total + item.components.length, 0),
    });
  }

  confirmRemoveStructure(): void {
    const pending = this.structureRemoval();
    this.structureRemoval.set(null);
    const definition = this.store.definition();
    if (!pending || !definition) return;
    const removedSections =
      pending.kind === 'section'
        ? [pending.id]
        : (definition.pages.find((page) => page.id === pending.id)?.sections.map((section) => section.id) ?? []);
    const result = pending.kind === 'section' ? removeSection(definition, pending.id) : removePage(definition, pending.id);
    if (result.lastOne || result.blockedBy.length) return;
    // Los mapeos de lo borrado (campos y repeaters) no sobreviven.
    this.store.change(() =>
      [...result.removedComponentIds, ...removedSections].reduce(
        (next, id) => withoutComponentMappings(next, id),
        result.definition,
      ),
    );
    this.store.select(null);
  }

  async validate(): Promise<void> {
    await this.store.validate();
    if (this.store.actionError()) return;
    // Sin issues el panel no se pinta: sin este aviso, "Validate" parecía no hacer nada.
    const count = this.store.issues().length;
    if (count === 0) this.toast.success('No issues found. This template is ready to publish.');
    else this.toast.info(`${count} ${count === 1 ? 'issue' : 'issues'} to fix before publishing.`);
  }
  requestPublish(): void {
    if (this.canPublish() && !this.editingLocked()) this.publishOpen.set(true);
  }
  async publish(): Promise<void> {
    if (this.launch() !== 'idle') return;
    this.publishingVersion.set((this.store.template()?.latestVersionNumber || 0) + 1);
    const templateId = this.store.template()?.id;
    // La confirmación se va al entrar el overlay (se transparentaba detrás). Como al crear: el sello
    // se queda y se vuelve a la lista, donde la fila publicada destella.
    this.publishOpen.set(false);
    const version = await runWithLaunch(this.launch, () => this.store.publish(), {
      keepOnDone: true,
    });
    if (version) {
      const navigated = await this.router.navigate(['/client-forms'], {
        queryParams: { tab: 'templates', published: templateId },
      });
      if (!navigated) this.launch.set('idle');
      return;
    }
    // Los issues quedan a la vista en el panel y el error general en el banner del builder.
    const count = this.store.issues().length;
    if (count > 0)
      this.toast.error(
        `Fix ${count} ${count === 1 ? 'issue' : 'issues'} before publishing. They're listed below the canvas.`,
      );
  }
  async openVersions(): Promise<void> {
    await this.store.loadVersions();
    this.store.versionsOpen.set(true);
  }
  openPreview(): void {
    this.versionPreview.set(null);
    this.versionPreviewNumber.set(null);
    this.store.previewOpen.set(true);
  }
  closePreview(): void {
    this.store.previewOpen.set(false);
    this.versionPreview.set(null);
    this.versionPreviewNumber.set(null);
  }
  async viewVersion(version: number): Promise<void> {
    const definition = await this.store.loadVersion(version);
    if (!definition) return;
    this.versionPreview.set(definition);
    this.versionPreviewNumber.set(version);
    this.store.versionsOpen.set(false);
    this.store.previewOpen.set(true);
  }
  async duplicateVersion(version: number): Promise<void> {
    const id = await this.store.duplicateVersion(version);
    if (id) await this.router.navigate(['/client-forms/templates', id]);
  }
  async duplicateDraft(): Promise<void> {
    const id = await this.store.duplicateDraft();
    if (id) await this.router.navigate(['/client-forms/templates', id]);
  }
  async archive(): Promise<void> {
    if (this.editingLocked()) return;
    if (await this.store.archive()) await this.router.navigate(['/client-forms']);
  }
  async restore(version: number): Promise<void> {
    if (this.editingLocked()) return;
    await this.store.restoreVersion(version);
    this.store.versionsOpen.set(false);
  }
  selectIssue(issue: ValidationIssue): void {
    const mappingIndex = /^\/mappings\/(\d+)/.exec(issue.path)?.[1];
    if (mappingIndex != null) {
      const mapping = this.store.definition()?.mappings?.[Number(mappingIndex)];
      const id = mapping?.componentId ?? issue.componentId;
      if (id) this.selectElement(id, true);
      return;
    }
    if (issue.path.startsWith('/actions')) {
      this.openTemplateTab('actions');
      return;
    }
    if (issue.componentId) this.store.select({ kind: 'component', id: issue.componentId });
  }
  /** Selecciona un campo (con la pestaña "Mapping" si se pide) o una sección repeater. */
  selectElement(id: string, mapping = false): void {
    const definition = this.store.definition();
    if (!definition) return;
    if (findComponent(definition, id)) {
      if (mapping && this.canConfigureActions()) {
        this.inspectorTab.set('mapping');
        setTimeout(() => this.inspectorTab.set(null));
      }
      this.store.select({ kind: 'component', id });
    } else if (findSection(definition, id)) {
      this.store.select({ kind: 'section', id });
    }
  }
  /** Las pestañas de plantilla sueltan la página o sección elegida para poder mostrarse. */
  openTemplateTab(tab: TemplateTab): void {
    if (tab !== 'structure') this.store.select(null);
    this.coverageFocus.set(null);
    this.templateTab.set(tab);
  }
  updateSelectedMapping(kind: 'component' | 'section', mapping: FormMapping | null): void {
    const id = kind === 'component' ? this.selectedComponent()?.id : this.selectedSection()?.id;
    if (id) this.updateMapping(id, mapping);
  }
  removeMappingEntry(removal: MappingRemoval): void {
    this.store.change((definition) => removeMapping(definition, removal));
  }
  /** Escape cierra el panel flotante y devuelve el foco al botón del riel. */
  closeLeftPanel(): void {
    if (!this.leftOpen()) return;
    this.leftOpen.set(false);
    (this.leftTab() === 'components' ? this.railComponents : this.railOutline)?.nativeElement.focus();
  }
  private moveBlockedByMapping(
    definition: FormDefinition,
    event: { id: string; sectionId: string },
  ): string | null {
    const references = mappingReferences(definition, event.id);
    const target = findSection(definition, event.sectionId);
    if (references.rowsOf.some((owner) => owner !== event.sectionId))
      return 'This field feeds a repeating section mapping. Ask someone with Configure actions to update the mapping before moving it.';
    if (references.own && target?.repeat != null)
      return 'This field feeds a data mapping, which stops working inside a repeating section. Ask someone with Configure actions first.';
    return null;
  }
  updateMapping(componentId: string, mapping: FormMapping | null): void {
    this.store.change((definition) => setComponentMapping(definition, componentId, mapping));
  }
  updateActions(actions: FormAction[]): void {
    this.store.change((definition) => setActions(definition, actions));
  }
  /** "Review mapping coverage" desde "After submission": abre la pestaña y enfoca la acción. */
  showCoverage(actionKey: string): void {
    this.openTemplateTab('coverage');
    this.coverageFocus.set(actionKey);
  }
  private async loadCapabilities(): Promise<void> {
    try {
      const availability = await firstValueFrom(this.templates.availability());
      this.capabilities.set(availability.capabilities ?? null);
    } catch {
      this.capabilities.set(null);
    }
  }
  choose(id: string, choice: BuilderConflictChoice): void {
    this.conflictChoices.update((current) => ({ ...current, [id]: choice }));
  }
  async resolveConflicts(): Promise<void> {
    const choices = this.conflictChoices();
    this.conflictChoices.set({});
    await this.store.resolveConflicts(choices);
  }
  /** Resumen legible de un lado del conflicto (nunca JSON crudo). */
  describeConflict(conflict: DraftConflict, side: BuilderConflictChoice): string {
    const value = side === 'mine' ? conflict.localValue : conflict.remoteValue;
    if (value === undefined) return 'Removed';
    const element = describeDefinitionPath(conflict.path);
    const record = (value ?? {}) as Record<string, unknown>;
    if (element.kind === 'component') {
      const component = record['component'] as FormComponent | undefined;
      const section = this.sectionTitle(String(record['sectionId'] ?? ''));
      return `${component?.label || component?.type || 'Field'} · ${component?.type ?? ''} · in "${section}"`;
    }
    if (element.kind === 'section') {
      const section = record['section'] as Partial<FormSection> | undefined;
      return `${section?.title || 'Untitled section'}${section?.repeat ? ' · repeatable' : ''}${
        section?.visibleWhen ? ' · has a condition' : ''
      }`;
    }
    if (element.kind === 'page') {
      const page = record as Partial<FormPage>;
      return `${page.title || 'Untitled page'}${page.visibleWhen ? ' · has a condition' : ''}`;
    }
    if (element.kind === 'order')
      return Array.isArray(value) ? value.map((id) => this.elementName(String(id))).join(' → ') : '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    if (Array.isArray(value)) return `${value.length} item(s)`;
    return 'Changed settings';
  }
  private sectionTitle(id: string): string {
    const definition = this.store.definition();
    return (definition && findSection(definition, id)?.title) || 'Untitled section';
  }
  private elementName(id: string): string {
    const definition = this.store.definition();
    if (!definition) return id;
    return (
      findPage(definition, id)?.title ||
      findSection(definition, id)?.title ||
      findComponent(definition, id)?.label ||
      'Untitled'
    );
  }
  private insertField(type: string, sectionId: string, index: number): void {
    const before = new Set(
      this.store
        .definition()
        ?.pages.flatMap((page) =>
          page.sections.flatMap((section) => section.components.map((component) => component.id)),
        ) ?? [],
    );
    this.store.change((definition) => addComponent(definition, sectionId, type, index));
    const added = this.store
      .definition()
      ?.pages.flatMap((page) => page.sections.flatMap((section) => section.components))
      .find((component) => !before.has(component.id));
    if (added) this.store.select({ kind: 'component', id: added.id });
  }
}
