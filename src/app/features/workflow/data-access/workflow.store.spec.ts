import { TestBed } from '@angular/core/testing';
import { WorkflowStore } from './workflow.store';

/**
 * El store es hoy la única "persistencia" del módulo: no hay backend de
 * workflows. Estas pruebas cubren lo que rompería el trabajo del usuario —
 * borrar de más, perder el documento al recargar o quedarse colgado con un
 * documento corrupto.
 */
describe('WorkflowStore', () => {
  let store: WorkflowStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [WorkflowStore] });
    store = TestBed.inject(WorkflowStore);
  });

  afterEach(() => localStorage.clear());

  it('arranca con el flujo de ejemplo, no con el lienzo vacío', () => {
    expect(store.steps().length).toBeGreaterThan(0);
    expect(store.steps().some(step => step.parentId === null)).toBe(true);
  });

  it('inserta un paso en medio y le pasa los hijos que había', () => {
    const root = store.steps().find(step => step.parentId === null)!;
    const before = store.steps().filter(step => step.parentId === root.id).map(step => step.id);

    const newId = store.addStep('delay', root.id, null);

    // Lo que colgaba del padre ahora cuelga del paso nuevo.
    for (const id of before) {
      expect(store.steps().find(step => step.id === id)!.parentId).toBe(newId);
    }
    expect(store.steps().find(step => step.id === newId)!.parentId).toBe(root.id);
  });

  it('borrar un paso se lleva su subárbol', () => {
    const root = store.steps().find(step => step.parentId === null)!;
    const child = store.steps().find(step => step.parentId === root.id)!;
    const descendants = store.steps().filter(step => step.parentId === child.id).map(step => step.id);
    expect(descendants.length).toBeGreaterThan(0);

    store.removeStep(child.id);

    expect(store.steps().some(step => step.id === child.id)).toBe(false);
    for (const id of descendants) {
      expect(store.steps().some(step => step.id === id)).toBe(false);
    }
  });

  it('deshacer y rehacer devuelven el documento exacto', () => {
    const before = JSON.stringify(store.steps());
    store.addStep('send-sms', store.steps()[0].id, null);
    expect(JSON.stringify(store.steps())).not.toBe(before);

    store.undo();
    expect(JSON.stringify(store.steps())).toBe(before);

    store.redo();
    expect(JSON.stringify(store.steps())).not.toBe(before);
  });

  it('una edición nueva descarta la pila de rehacer', () => {
    store.addStep('delay', store.steps()[0].id, null);
    store.undo();
    expect(store.canRedo()).toBe(true);

    store.addStep('send-sms', store.steps()[0].id, null);
    expect(store.canRedo()).toBe(false);
  });

  it('persiste el documento y lo recupera en un store nuevo', () => {
    store.rename('My automation');
    const id = store.addStep('delay', store.steps()[0].id, null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [WorkflowStore] });
    const revived = TestBed.inject(WorkflowStore);

    expect(revived.name()).toBe('My automation');
    expect(revived.steps().some(step => step.id === id)).toBe(true);
  });

  it('con basura guardada vuelve al ejemplo en vez de romper la pantalla', () => {
    localStorage.setItem('tvf.workflow.v1', '{ not json');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [WorkflowStore] });
    const revived = TestBed.inject(WorkflowStore);

    expect(revived.steps().length).toBeGreaterThan(0);
  });

  it('descarta los pasos huérfanos al cargar', () => {
    localStorage.setItem(
      'tvf.workflow.v1',
      JSON.stringify({
        id: 'wf',
        name: 'Test',
        updatedAtIso: new Date().toISOString(),
        steps: [
          { id: 'root', typeId: 'schedule', title: 'r', subtitle: '', parentId: null, branch: null, config: {} },
          { id: 'lost', typeId: 'delay', title: 'l', subtitle: '', parentId: 'ghost', branch: null, config: {} },
        ],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [WorkflowStore] });
    const revived = TestBed.inject(WorkflowStore);

    expect(revived.steps().some(step => step.id === 'lost')).toBe(false);
    expect(revived.steps().some(step => step.id === 'root')).toBe(true);
  });
});
