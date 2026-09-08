import { TestBed } from '@angular/core/testing';
import { WorkflowStore } from './workflow.store';

/**
 * El store es hoy la única "persistencia" del módulo: no hay backend de
 * workflows. Estas pruebas cubren lo que rompería el trabajo del usuario —
 * perder el documento al recargar, perderlo al migrar de formato, o dejar el
 * grafo en un estado que el layout no sabe dibujar.
 */
describe('WorkflowStore', () => {
  let store: WorkflowStore;

  function freshStore(): WorkflowStore {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [WorkflowStore] });
    return TestBed.inject(WorkflowStore);
  }

  beforeEach(() => {
    localStorage.clear();
    store = freshStore();
  });

  afterEach(() => localStorage.clear());

  it('arranca con el flujo de ejemplo, ya con sus hilos', () => {
    expect(store.steps().length).toBeGreaterThan(0);
    expect(store.connections().length).toBeGreaterThan(0);
  });

  it('el ejemplo une las dos ramas en la misma carta', () => {
    const merge = store.steps().find(step => store.inDegreeOf(step.id) === 2);
    expect(merge).toBeTruthy();
  });

  // ---------- Hilos ----------

  it('conecta dos cartas y el hilo queda con identidad propia', () => {
    const a = store.addStep('delay', null);
    const b = store.addStep('send-sms', null);

    expect(store.connect(a, 'main', b)).toBeNull();
    const link = store.connections().find(c => c.fromStepId === a && c.toStepId === b);
    expect(link).toBeTruthy();
    expect(link!.id).toBeTruthy();
  });

  it('rechaza conectar una carta consigo misma', () => {
    const a = store.addStep('delay', null);
    expect(store.connect(a, 'main', a)).toBe("A step can't connect to itself");
  });

  it('rechaza un hilo duplicado', () => {
    const a = store.addStep('delay', null);
    const b = store.addStep('send-sms', null);
    store.connect(a, 'main', b);

    expect(store.connect(a, 'main', b)).toBe('These steps are already connected');
  });

  /** Un ciclo dejaría el grafo sin principio y el layout sin forma de ordenarlo. */
  it('rechaza un hilo que cerraría un ciclo', () => {
    const a = store.addStep('delay', null);
    const b = store.addStep('send-sms', null);
    store.connect(a, 'main', b);

    expect(store.connect(b, 'main', a)).toBe('That would create a loop');
  });

  it('borrar un hilo no borra las cartas', () => {
    const a = store.addStep('delay', null);
    const b = store.addStep('send-sms', null);
    store.connect(a, 'main', b);
    const link = store.connections().find(c => c.fromStepId === a)!;

    store.disconnect(link.id);

    expect(store.connections().some(c => c.id === link.id)).toBe(false);
    expect(store.steps().some(step => step.id === a)).toBe(true);
    expect(store.steps().some(step => step.id === b)).toBe(true);
  });

  // ---------- Cartas ----------

  it('insertar en un hilo mete la carta EN MEDIO', () => {
    const link = store.connections()[0];
    const { fromStepId, toStepId } = link;

    const newId = store.addStep('delay', fromStepId, link.fromPort);

    // El origen ahora apunta al paso nuevo, y el paso nuevo al destino de antes.
    expect(store.connections().some(c => c.fromStepId === fromStepId && c.toStepId === newId)).toBe(true);
    expect(store.connections().some(c => c.fromStepId === newId && c.toStepId === toStepId)).toBe(true);
  });

  /**
   * En un grafo, lo que venía detrás puede estar alimentado por otras cartas:
   * borrar ya no puede llevarse el subárbol entero por delante.
   */
  it('borrar una carta cose el hilo de quien la alimentaba con quien la seguía', () => {
    const a = store.addStep('delay', null);
    const b = store.addStep('send-sms', a);
    const c = store.addStep('create-record', b);

    store.removeStep(b);

    expect(store.steps().some(step => step.id === c)).toBe(true);
    expect(store.connections().some(link => link.fromStepId === a && link.toStepId === c)).toBe(true);
  });

  it('duplicar deja la copia al lado, no encima', () => {
    const id = store.addStepAt('delay', null, 100, 100);
    store.duplicateStep(id);

    const copy = store.steps().find(step => step.title.endsWith('(copy)'))!;
    expect(copy.x).not.toBe(100);
  });

  // ---------- Migración ----------

  /** Sin esto, quien ya tenía un workflow guardado lo perdería. */
  it('migra un documento del formato viejo (parentId) a hilos', () => {
    localStorage.setItem(
      'tvf.workflow.v1',
      JSON.stringify({
        id: 'wf',
        name: 'Legacy',
        updatedAtIso: new Date().toISOString(),
        steps: [
          { id: 'root', typeId: 'schedule', title: 'r', subtitle: '', parentId: null, branch: null, config: {} },
          { id: 'yes', typeId: 'send-email', title: 'y', subtitle: '', parentId: 'root', branch: 'yes', config: {} },
        ],
      }),
    );

    const revived = freshStore();

    expect(revived.name()).toBe('Legacy');
    expect(revived.steps().length).toBe(2);
    const link = revived.connections().find(c => c.fromStepId === 'root' && c.toStepId === 'yes');
    expect(link).toBeTruthy();
    // La rama del hijo era, en la práctica, el puerto del padre.
    expect(link!.fromPort).toBe('yes');
  });

  it('descarta hilos que apuntan a cartas inexistentes', () => {
    localStorage.setItem(
      'tvf.workflow.v1',
      JSON.stringify({
        id: 'wf',
        name: 'Test',
        updatedAtIso: new Date().toISOString(),
        steps: [{ id: 'a', typeId: 'schedule', title: 'a', subtitle: '', config: {} }],
        connections: [{ id: 'c1', fromStepId: 'a', fromPort: 'main', toStepId: 'ghost' }],
      }),
    );

    expect(freshStore().connections()).toEqual([]);
  });

  it('con basura guardada vuelve al ejemplo en vez de romper la pantalla', () => {
    localStorage.setItem('tvf.workflow.v1', '{ not json');
    expect(freshStore().steps().length).toBeGreaterThan(0);
  });

  it('persiste el documento y lo recupera en un store nuevo', () => {
    store.rename('My automation');
    const id = store.addStep('delay', null);

    const revived = freshStore();
    expect(revived.name()).toBe('My automation');
    expect(revived.steps().some(step => step.id === id)).toBe(true);
  });

  // ---------- Personas ----------

  it('añade colaboradores y persiste; el duplicado se ignora', () => {
    store.addCollaborator({ userId: 'u1', name: 'Ana Diaz', email: 'ana@x.com', role: 'owner' });
    store.addCollaborator({ userId: 'u1', name: 'Ana otra vez', email: 'ana@x.com', role: 'viewer' });

    expect(store.collaborators().length).toBe(1);
    expect(store.collaborators()[0].role).toBe('owner');

    const revived = freshStore();
    expect(revived.collaborators().length).toBe(1);
  });

  it('protege al último Owner: ni quitarlo ni degradarlo', () => {
    store.addCollaborator({ userId: 'u1', name: 'Ana', email: 'a@x.com', role: 'owner' });
    store.addCollaborator({ userId: 'u2', name: 'Luis', email: 'l@x.com', role: 'viewer' });

    expect(store.removeCollaborator('u1')).toBe('A workflow needs at least one owner');
    expect(store.setCollaboratorRole('u1', 'viewer')).toBe('A workflow needs at least one owner');
    // Con un segundo Owner ya se puede.
    store.setCollaboratorRole('u2', 'owner');
    expect(store.removeCollaborator('u1')).toBeNull();
  });

  it('un documento sin colaboradores carga con lista vacía, no revienta', () => {
    localStorage.setItem(
      'tvf.workflow.v1',
      JSON.stringify({
        id: 'wf',
        name: 'Old',
        updatedAtIso: new Date().toISOString(),
        steps: [{ id: 'a', typeId: 'schedule', title: 'a', subtitle: '', config: {} }],
        connections: [],
      }),
    );

    expect(freshStore().collaborators()).toEqual([]);
  });

  // ---------- Datos ----------

  it('sabe qué datos le llegan a una carta y cuáles le faltan', () => {
    const form = store.addStep('form-submitted', null);
    const mail = store.addStep('send-email', form);
    store.select(mail);

    // `form-submitted` produce `email`, que es justo lo que `send-email` pide.
    expect(store.selectedAvailableFields().map(f => f.key)).toContain('email');
    expect(store.selectedMissingInputs()).toEqual([]);

    // Suelta, la misma carta se queda sin ese dato.
    const alone = store.addStep('send-email', null);
    store.select(alone);
    expect(store.selectedMissingInputs().map(f => f.key)).toContain('email');
  });

  // ---------- Historial ----------

  it('un arrastre completo deja UN solo paso en el historial', () => {
    const target = store.steps()[1];

    store.beginMove();
    store.moveStepLive(target.id, 500, 400);
    store.moveStepLive(target.id, 520, 420);
    store.endMove();

    store.undo();
    const restored = store.steps().find(step => step.id === target.id)!;
    expect(restored.x).toBe(target.x);
  });

  it('un clic sin desplazamiento no ensucia el historial', () => {
    store.beginMove();
    store.endMove();
    expect(store.canUndo()).toBe(false);
  });

  it('deshacer restaura también los hilos', () => {
    const before = store.connections().length;
    const a = store.addStep('delay', null);
    const b = store.addStep('send-sms', a);
    expect(store.connections().length).toBeGreaterThan(before);

    store.undo();
    store.undo();
    expect(store.connections().length).toBe(before);
    void b;
  });

  it('tidyLayout devuelve las cartas al layout automático', () => {
    const id = store.addStepAt('delay', null, 700, 500);
    expect(store.steps().find(step => step.id === id)!.x).toBe(700);

    store.tidyLayout();
    expect(store.steps().every(step => step.x === undefined && step.y === undefined)).toBe(true);
  });
});
