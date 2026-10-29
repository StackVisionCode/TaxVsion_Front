import { signal } from '@angular/core';
import { DeferBlockState, TestBed, type DeferBlockFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { FormTemplateBuilderStore } from '../../data-access/form-template-builder.store';
import { FormTemplateBuilderComponent } from './form-template-builder.component';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { catalogResponse, onboardingDefinition } from '../../testing/mapping-catalog.fixture';
import { MappingCatalogStore } from '../../data-access/mapping-catalog.store';

// Acceso de prueba: todos los permisos y plan desconocido (no oculta nada por módulo).
function accessStub(can: (permission: string) => boolean = () => true) {
  return { can, enabledModules: signal<ReadonlySet<string> | null>(null) };
}

// La ruta del builder: el id puede cambiar sin destruir el componente.
let route: { paramMap: BehaviorSubject<ParamMap> };

function freshRoute(id = 'template-1') {
  route = { paramMap: new BehaviorSubject(convertToParamMap({ id })) };
  return route;
}

function setup(trySave: () => Promise<boolean>) {
  freshRoute();
  const store = { trySave: vi.fn(trySave), load: vi.fn(), dispose: vi.fn(), lockRuleSets: vi.fn() };
  TestBed.configureTestingModule({
    imports: [FormTemplateBuilderComponent],
    providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: AccessStore, useValue: accessStub() },
        provideHttpClient(),
        provideHttpClientTesting(),
      { provide: ToastService, useValue: { success: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(FormTemplateBuilderComponent, {
    set: { template: '', imports: [], providers: [MappingCatalogStore, { provide: FormTemplateBuilderStore, useValue: store }] },
  });
  const component = TestBed.createComponent(FormTemplateBuilderComponent).componentInstance;
  return { component, store };
}

describe('FormTemplateBuilderComponent leave guard', () => {
  it('lets the user leave once the pending draft is saved', async () => {
    const { component, store } = setup(async () => true);

    await expect(component.canDeactivate()).resolves.toBe(true);
    expect(store.trySave).toHaveBeenCalledTimes(1);
    expect(component.leaveOpen()).toBe(false);
  });

  it('asks before leaving when the draft could not be saved', async () => {
    const { component } = setup(async () => false);

    const stay = component.canDeactivate();
    await vi.waitFor(() => expect(component.leaveOpen()).toBe(true));
    component.answerLeave(false);
    await expect(stay).resolves.toBe(false);

    const leave = component.canDeactivate();
    await vi.waitFor(() => expect(component.leaveOpen()).toBe(true));
    component.answerLeave(true);
    await expect(leave).resolves.toBe(true);
  });

  it('flushes and disposes the store when destroyed', () => {
    const { component, store } = setup(async () => true);

    component.ngOnDestroy();

    expect(store.dispose).toHaveBeenCalled();
  });
});

describe('FormTemplateBuilderComponent read-only editing lock', () => {
  function render(options: { readOnly: boolean; conflicts?: number }) {
    freshRoute();
    const definition = {
      schemaVersion: 1,
      title: 'Intake',
      purpose: 'clientIntake',
      presentation: 'wizard',
      pages: [
        {
          id: 'pg_abcdefghij',
          title: 'Page 1',
          sections: [
            {
              id: 'sc_abcdefghij',
              title: 'Details',
              components: [{ id: 'fd_abcdefghij', type: 'text', label: 'Name' }],
            },
          ],
        },
      ],
    };
    const store = {
      template: signal({ id: 'template-1', name: 'Intake', latestVersionNumber: 0, status: 'Active', versions: [] }),
      definition: signal(definition),
      selection: signal({ kind: 'component', id: 'fd_abcdefghij' }),
      readOnly: signal(options.readOnly),
      conflicts: signal(
        Array.from({ length: options.conflicts ?? 0 }, (_, index) => ({
          id: `/components/c${index}`,
          path: `/components/c${index}`,
          label: 'Field',
          localValue: undefined,
          remoteValue: undefined,
        })),
      ),
      loading: signal(false),
      error: signal(''),
      issues: signal([]),
      previewOpen: signal(false),
      versionsOpen: signal(false),
      publishing: signal(false),
      saveStatus: signal('idle'),
      canUndo: signal(true),
      canRedo: signal(false),
      load: vi.fn(),
      dispose: vi.fn(),
      lockRuleSets: vi.fn(),
      actionError: signal(''),
      dismissActionError: vi.fn(),
      select: vi.fn(),
      change: vi.fn(),
      takeControl: vi.fn(),
      trySave: vi.fn(async () => true),
    };
    TestBed.configureTestingModule({
      imports: [FormTemplateBuilderComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AccessStore, useValue: accessStub() },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: { success: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(FormTemplateBuilderComponent, {
      add: { providers: [{ provide: FormTemplateBuilderStore, useValue: store }] },
    });
    const fixture = TestBed.createComponent(FormTemplateBuilderComponent);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, store, fixture, definition };
  }

  const paletteButtons = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('app-builder-palette button'));
  const addPage = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('app-builder-canvas button')).find((item) =>
      item.textContent?.includes('Add page'),
    )!;
  const inspector = (root: HTMLElement) =>
    root.querySelector<HTMLFieldSetElement>('app-component-inspector fieldset[data-builder-inspector]')!;

  it('disables palette, canvas editing and inspector while another tab has control', () => {
    const { root, store } = render({ readOnly: true });

    expect(paletteButtons(root).length).toBeGreaterThan(0);
    expect(paletteButtons(root).every((item) => item.disabled)).toBe(true);
    expect(addPage(root).disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('app-builder-canvas [aria-label="Drag component"]')!.disabled).toBe(true);
    expect(inspector(root).disabled).toBe(true);
    expect(inspector(root).hasAttribute('inert')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(true);

    paletteButtons(root)[0].click();
    expect(store.change).not.toHaveBeenCalled();
  });

  it('also locks editing while a conflict is pending', () => {
    const { root } = render({ readOnly: false, conflicts: 1 });

    expect(paletteButtons(root).every((item) => item.disabled)).toBe(true);
    expect(inspector(root).disabled).toBe(true);
  });

  it('adds a palette block right after the selected component, in its section', () => {
    const { fixture, store, definition } = render({ readOnly: false });

    expect(fixture.componentInstance.targetLabel()).toBe('Details');
    fixture.componentInstance.addField('email');

    const mutate = store.change.mock.calls[0][0] as (value: typeof definition) => typeof definition;
    const types = mutate(definition).pages[0].sections[0].components.map((item) => item.type);
    expect(types).toEqual(['text', 'email']);
  });

  it('opens the palette on the section when the canvas asks to add a component', () => {
    const { fixture, store } = render({ readOnly: false });
    fixture.componentInstance.leftTab.set('outline');

    fixture.componentInstance.openPalette('sc_abcdefghij');

    expect(store.select).toHaveBeenCalledWith({ kind: 'section', id: 'sc_abcdefghij' });
    expect(fixture.componentInstance.leftTab()).toBe('components');
    expect(fixture.componentInstance.leftOpen()).toBe(true);
    fixture.componentInstance.ngOnDestroy();
  });

  it('keeps everything editable when this tab has control and there are no conflicts', () => {
    const { root } = render({ readOnly: false });

    expect(paletteButtons(root).some((item) => item.disabled)).toBe(false);
    expect(addPage(root).disabled).toBe(false);
    expect(inspector(root).disabled).toBe(false);
    expect(inspector(root).hasAttribute('inert')).toBe(false);
  });
});

describe('FormTemplateBuilderComponent template switch', () => {
  it('saves and releases the previous template and loads the new one when the id changes', () => {
    freshRoute('template-1');
    const store = {
      trySave: vi.fn(async () => true),
      load: vi.fn(),
      dispose: vi.fn(),
      lockRuleSets: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [FormTemplateBuilderComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AccessStore, useValue: accessStub() },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: { success: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(FormTemplateBuilderComponent, {
      set: { template: '', imports: [], providers: [MappingCatalogStore, { provide: FormTemplateBuilderStore, useValue: store }] },
    });
    const fixture = TestBed.createComponent(FormTemplateBuilderComponent);
    fixture.detectChanges();
    expect(store.load).toHaveBeenCalledWith('template-1');

    route.paramMap.next(convertToParamMap({ id: 'template-2' }));
    route.paramMap.next(convertToParamMap({ id: 'template-2' }));

    expect(store.load.mock.calls.map((call) => call[0])).toEqual(['template-1', 'template-2']);
  });
});

describe('FormTemplateBuilderComponent mapping and actions (P-16/P-17)', () => {
  function render(options: { canConfigure?: boolean; selection?: unknown } = {}) {
    freshRoute();
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_email0001', targetKey: 'customer.primary_email' }],
    });
    const store = {
      template: signal({ id: 'template-1', name: 'Intake', latestVersionNumber: 0, status: 'Active', versions: [] }),
      definition: signal(definition),
      selection: signal(options.selection ?? null),
      readOnly: signal(false),
      conflicts: signal([]),
      loading: signal(false),
      error: signal(''),
      issues: signal([]),
      previewOpen: signal(false),
      versionsOpen: signal(false),
      publishing: signal(false),
      saveStatus: signal('idle'),
      canUndo: signal(false),
      canRedo: signal(false),
      load: vi.fn(),
      dispose: vi.fn(),
      lockRuleSets: vi.fn(),
      actionError: signal(''),
      dismissActionError: vi.fn(),
      archive: vi.fn(),
      restoreVersion: vi.fn(),
      select: vi.fn((value: unknown) => store.selection.set(value as never)),
      change: vi.fn(),
      takeControl: vi.fn(),
      trySave: vi.fn(async () => true),
    };
    const canConfigure = options.canConfigure ?? true;
    TestBed.configureTestingModule({
      imports: [FormTemplateBuilderComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: AccessStore,
          useValue: accessStub((permission) => canConfigure || permission !== 'tasks.form_templates.configure_actions'),
        },
        { provide: ToastService, useValue: { success: vi.fn() } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    TestBed.overrideComponent(FormTemplateBuilderComponent, {
      add: { providers: [{ provide: FormTemplateBuilderStore, useValue: store }] },
    });
    const fixture = TestBed.createComponent(FormTemplateBuilderComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    return { fixture, store, definition, http, root: fixture.nativeElement as HTMLElement };
  }

  function respond(http: HttpTestingController, autoCustomerCreationEnabled: boolean): void {
    http.match((request) => request.url.endsWith('/tasks/forms/mapping-catalog')).forEach((request) => request.flush(catalogResponse()));
    http.match((request) => request.url.endsWith('/tasks/forms/availability')).forEach((request) =>
      request.flush({
        enabled: true,
        reason: null,
        capabilities: {
          externalParticipantsEnabled: true,
          intakeLinksEnabled: false,
          autoCustomerCreationEnabled,
          signatureStepEnabled: false,
          pushNotificationsEnabled: false,
        },
      }),
    );
  }

  // Los paneles de plantilla van en @defer: se fuerzan a completo.
  async function renderDeferred(fixture: { getDeferBlocks(): Promise<DeferBlockFixture[]> }) {
    for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
  }

  const tab = (root: HTMLElement, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.trim() === label);

  it('opens After submission with the office capabilities and applies actions through the store', async () => {
    const { fixture, store, definition, http, root } = render();
    respond(http, false);
    await fixture.whenStable();
    tab(root, 'After submission')!.click();
    fixture.detectChanges();
    await renderDeferred(fixture);

    const panel = root.querySelector('app-after-submission-panel')!;
    expect(panel).not.toBeNull();
    panel.querySelector<HTMLButtonElement>('[data-action-type="createCustomer"] [role="switch"]')!.click();
    const mutate = store.change.mock.calls[0][0] as (value: typeof definition) => typeof definition;
    expect(mutate(definition).actions?.[0]).toMatchObject({ type: 'createCustomer', trigger: 'manual' });
  });

  it('shows Mapping coverage and selects the field from a link', async () => {
    const { fixture, store, http, root } = render();
    respond(http, true);
    await fixture.whenStable();
    fixture.componentInstance.updateActions([
      { key: 'create_client', type: 'createCustomer', trigger: 'onSubmit', config: { kind: { constant: 'Individual' } } },
    ]);
    tab(root, 'Mapping coverage')!.click();
    fixture.detectChanges();
    await renderDeferred(fixture);
    expect(root.querySelector('app-mapping-coverage-panel')).not.toBeNull();

    fixture.componentInstance.selectElement('fd_first0001', true);
    expect(store.select).toHaveBeenLastCalledWith({ kind: 'component', id: 'fd_first0001' });
    expect(fixture.componentInstance.inspectorTab()).toBe('mapping');
    fixture.componentInstance.selectElement('sc_deps00001');
    expect(store.select).toHaveBeenLastCalledWith({ kind: 'section', id: 'sc_deps00001' });
  });

  it('routes mapping and action issues', () => {
    const { fixture, store } = render();
    fixture.componentInstance.selectIssue({ code: 'mapping.type_mismatch', path: '/mappings/0/targetKey', message: '' });
    expect(store.select).toHaveBeenLastCalledWith({ kind: 'component', id: 'fd_email0001' });

    fixture.componentInstance.selectIssue({ code: 'props.out_of_range', path: '/actions/0/trigger', message: '' });
    expect(store.select).toHaveBeenLastCalledWith(null);
    expect(fixture.componentInstance.activeTemplateTab()).toBe('actions');
  });

  it('writes field mappings and drops the mapping of a removed field', () => {
    const { fixture, store, definition } = render({ selection: { kind: 'component', id: 'fd_email0001' } });
    fixture.componentInstance.updateSelectedMapping('component', null);
    let mutate = store.change.mock.calls[0][0] as (value: typeof definition) => typeof definition;
    expect(mutate(definition).mappings).toEqual([]);

    fixture.componentInstance.removeField();
    mutate = store.change.mock.calls[1][0] as (value: typeof definition) => typeof definition;
    expect(mutate(definition).mappings).toEqual([]);
  });

  it('keeps the builder on screen with a dismissible action error', () => {
    const { fixture, store, root } = render();
    store.actionError.set('The template could not be published.');
    fixture.detectChanges();
    const banner = root.querySelector('[data-testid="builder-action-error"]')!;
    expect(banner.textContent).toContain('could not be published');
    expect(root.querySelector('app-builder-canvas')).not.toBeNull();
    banner.querySelector('button')!.click();
    expect(store.dismissActionError).toHaveBeenCalled();
  });

  it('disables Publish, Archive and Restore while editing is locked', async () => {
    const { fixture, store, root } = render();
    store.readOnly.set(true);
    fixture.detectChanges();
    const publish = [...root.querySelectorAll<HTMLButtonElement>('header button')].find((item) =>
      item.textContent?.includes('Publish'),
    )!;
    expect(publish.disabled).toBe(true);
    fixture.componentInstance.requestPublish();
    expect(fixture.componentInstance.publishOpen()).toBe(false);
    await fixture.componentInstance.archive();
    await fixture.componentInstance.restore(1);
    expect(store.archive).not.toHaveBeenCalled();
    expect(store.restoreVersion).not.toHaveBeenCalled();
  });

  it('locks rule sets in the store without the configure permission', () => {
    const { store } = render({ canConfigure: false });
    TestBed.tick();
    expect(store.lockRuleSets).toHaveBeenLastCalledWith(true);
  });

  it('explains instead of removing a mapped field without the configure permission', () => {
    const { fixture, store } = render({ canConfigure: false, selection: { kind: 'component', id: 'fd_email0001' } });
    fixture.componentInstance.removeField();
    expect(store.change).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mappingNotice()).toContain('feeds a data mapping');
  });

  it('explains instead of removing the signature step without the configure permission', () => {
    const { fixture, store, definition } = render({ canConfigure: false });
    definition.pages[0].sections[0].components.push({ id: 'fd_sign00001', type: 'signatureStep' });
    store.definition.set(structuredClone(definition));
    store.selection.set({ kind: 'component', id: 'fd_sign00001' } as never);
    fixture.componentInstance.removeField();
    expect(store.change).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mappingNotice()).toContain('Request signature');
  });

  it('blocks moving a mapped field into a repeater without the permission and cleans rows with it', () => {
    const blocked = render({ canConfigure: false });
    blocked.fixture.componentInstance.moveField({ id: 'fd_email0001', sectionId: 'sc_deps00001', index: 0 });
    expect(blocked.store.change).not.toHaveBeenCalled();
    expect(blocked.fixture.componentInstance.mappingNotice()).toContain('repeating section');
    TestBed.resetTestingModule();

    const { fixture, store, definition } = render();
    definition.mappings = [
      { componentId: 'sc_deps00001', targetKey: 'customer.relation.dependents', rowFields: { fd_depname1: 'first_name' } },
    ];
    store.definition.set(structuredClone(definition));
    fixture.componentInstance.moveField({ id: 'fd_depname1', sectionId: 'sc_main00001', index: 0 });
    const mutate = store.change.mock.calls[0][0] as (value: typeof definition) => typeof definition;
    expect(mutate(structuredClone(definition)).mappings?.[0].rowFields).toEqual({});
  });

  it('removes an orphan row field from the coverage panel', () => {
    const { fixture, store, definition } = render();
    definition.mappings = [
      { componentId: 'sc_deps00001', targetKey: 'customer.relation.dependents', rowFields: { fd_gone00001: 'first_name' } },
    ];
    fixture.componentInstance.removeMappingEntry({ mappingComponentId: 'sc_deps00001', rowComponentId: 'fd_gone00001' });
    const mutate = store.change.mock.calls[0][0] as (value: typeof definition) => typeof definition;
    expect(mutate(structuredClone(definition)).mappings?.[0].rowFields).toEqual({});
  });

  it('closes the floating panel with Escape and returns focus to the rail', () => {
    const { fixture, root } = render();
    document.body.appendChild(root);
    fixture.componentInstance.toggleLeft('outline');
    fixture.detectChanges();
    root.querySelector('.builder-left')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.leftOpen()).toBe(false);
    expect(document.activeElement?.textContent).toContain('Outline');
    root.remove();
  });

  it('hides template tabs and skips the catalog without the configure permission', () => {
    const { http, root, fixture } = render({ canConfigure: false });
    expect(tab(root, 'After submission')).toBeUndefined();
    expect(http.match(() => true)).toEqual([]);
    expect(fixture.componentInstance.activeTemplateTab()).toBe('structure');
  });
});

describe('FormTemplateBuilderComponent publish and validate feedback', () => {
  function feedbackSetup(publishResult: number | null = 2) {
    freshRoute();
    const issues = signal<unknown[]>([]);
    const actionError = signal('');
    const store = {
      trySave: vi.fn(async () => true),
      load: vi.fn(),
      dispose: vi.fn(),
      lockRuleSets: vi.fn(),
      template: signal({ id: 'template-1', latestVersionNumber: 1 }),
      issues,
      actionError,
      validate: vi.fn(async () => undefined),
      publish: vi.fn(async () => publishResult),
    };
    const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
    const router = { navigate: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      imports: [FormTemplateBuilderComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: AccessStore, useValue: accessStub() },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.overrideComponent(FormTemplateBuilderComponent, {
      set: {
        template: '',
        imports: [],
        providers: [MappingCatalogStore, { provide: FormTemplateBuilderStore, useValue: store }],
      },
    });
    const component = TestBed.createComponent(FormTemplateBuilderComponent).componentInstance;
    return { component, store, toast, issues, router };
  }

  it('confirms a clean validation instead of doing nothing', async () => {
    const { component, toast } = feedbackSetup();

    await component.validate();

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('No issues found'));
  });

  it('summarises how many issues validation found', async () => {
    const { component, toast, issues } = feedbackSetup();
    issues.set([{}, {}]);

    await component.validate();

    expect(toast.info).toHaveBeenCalledWith('2 issues to fix before publishing.');
  });

  it('publishes with the choreography and returns to the templates list with the row highlighted', async () => {
    vi.useFakeTimers();
    const { component, store, router } = feedbackSetup(2);
    component.publishOpen.set(true);

    const run = component.publish();
    await vi.runAllTimersAsync();
    await run;

    expect(store.publish).toHaveBeenCalled();
    expect(component.publishingVersion()).toBe(2);
    expect(component.publishOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/client-forms'], {
      queryParams: { tab: 'templates', published: 'template-1' },
    });
    // El sello se queda hasta que el builder se destruye al navegar.
    expect(component.launch()).toBe('done');
    vi.useRealTimers();
  });

  it('drops the overlay when the navigation back to the list is cancelled', async () => {
    vi.useFakeTimers();
    const { component, router } = feedbackSetup(2);
    router.navigate.mockResolvedValueOnce(false);

    const run = component.publish();
    await vi.runAllTimersAsync();
    await run;

    expect(component.launch()).toBe('idle');
    vi.useRealTimers();
  });

  it('closes the confirmation and points at the issues when publishing is rejected', async () => {
    const { component, toast, issues, store } = feedbackSetup(null);
    store.publish.mockImplementationOnce(async () => {
      issues.set([{}, {}, {}]);
      return null;
    });
    component.publishOpen.set(true);

    await component.publish();

    expect(component.publishOpen()).toBe(false);
    expect(component.launch()).toBe('idle');
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Fix 3 issues'));
  });
});
