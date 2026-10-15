import { TestBed } from '@angular/core/testing';
import { WorkflowStore } from './workflow.store';
import { WorkflowLibraryService } from './workflow-library.service';

/**
 * El store es hoy la única "persistencia" del módulo: no hay backend de
 * workflows. Estas pruebas cubren lo que rompería el trabajo del usuario —
 * perder el documento al recargar, perderlo al migrar de formato, o dejar el
 * grafo en un estado que el layout no sabe dibujar.
 */
/**
 * Store con un workflow NUEVO abierto. El store ya no carga solo un documento fijo al
 * construirse: la pantalla le dice cuál abrir, porque ahora hay una biblioteca.
 */
function freshStore(): WorkflowStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [WorkflowStore, WorkflowLibraryService] });
  const created = TestBed.inject(WorkflowStore);
  created.openNew();
  return created;
}

/** Store que abre un documento ya guardado en la biblioteca, por su id. */
function storeOpening(id: string): WorkflowStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [WorkflowStore, WorkflowLibraryService] });
  const created = TestBed.inject(WorkflowStore);
  created.open(id);
  return created;
}

/** Pasos de un proceso, por id de proceso. */
function inProcess(store: WorkflowStore, processId: string): string[] {
  return store.steps().filter(step => step.processId === processId).map(step => step.id);
}

describe('WorkflowStore', () => {
  let store: WorkflowStore;

  beforeEach(() => {
    localStorage.clear();
    store = freshStore();
  });

  afterEach(() => localStorage.clear());

  // ---------- Ejemplo ----------

  it('arranca con el flujo de ejemplo: procesos, pasos e hilos', () => {
    expect(store.processes().length).toBe(3);
    expect(store.steps().length).toBeGreaterThan(0);
    expect(store.steps().every(step => !!step.processId)).toBe(true);
    expect(store.connections().length).toBeGreaterThan(0);
  });

  it('en el ejemplo, el paso que bifurca es el último de su proceso y sus salidas llevan a otros procesos', () => {
    const agent = store.steps().find(step => step.typeId === 'ai-agent')!;
    const own = inProcess(store, agent.processId!);
    expect(own[own.length - 1]).toBe(agent.id);

    const exits = store.connections().filter(link => link.fromStepId === agent.id);
    expect(exits.map(link => link.fromPort).sort()).toEqual(['no', 'yes']);
    for (const link of exits) {
      const target = store.steps().find(step => step.id === link.toStepId)!;
      expect(target.processId).not.toBe(agent.processId);
      // Entra por el PRIMER paso del otro proceso.
      expect(inProcess(store, target.processId!)[0]).toBe(target.id);
    }
  });

  // ---------- Procesos ----------

  it('añade un proceso vacío a la derecha de los demás y lo selecciona', () => {
    const before = store.processes();
    const rightmost = Math.max(...before.map(process => process.x));

    const id = store.addProcess();

    const created = store.processes().find(process => process.id === id)!;
    expect(created.x).toBeGreaterThan(rightmost);
    expect(created.name).toMatch(/^Process \d+$/);
    expect(store.selectedProcessId()).toBe(id);
    expect(inProcess(store, id)).toEqual([]);
  });

  it('renombra, pliega y duplica un proceso', () => {
    const [first] = store.processes();
    store.renameProcess(first.id, '  Intake v2  ');
    store.toggleProcessCollapsed(first.id);
    expect(store.processes()[0].name).toBe('Intake v2');
    expect(store.processes()[0].collapsed).toBe(true);

    const copyId = store.duplicateProcess(first.id)!;
    expect(inProcess(store, copyId).length).toBe(inProcess(store, first.id).length);
    // Los pasos copiados son otros (id nuevo), y no arrastran las salidas hacia otros procesos.
    expect(inProcess(store, copyId).some(id => inProcess(store, first.id).includes(id))).toBe(false);
    const copiedLast = inProcess(store, copyId).slice(-1)[0];
    expect(store.connections().some(link => link.fromStepId === copiedLast)).toBe(false);
  });

  it('borrar un proceso se lleva sus pasos y los hilos que lo tocaban', () => {
    const follow = store.processes().find(process => process.name === 'Follow-up')!;
    const ids = inProcess(store, follow.id);

    store.removeProcess(follow.id);

    expect(store.processes().some(process => process.id === follow.id)).toBe(false);
    expect(store.steps().some(step => ids.includes(step.id))).toBe(false);
    expect(store.connections().some(link => ids.includes(link.toStepId) || ids.includes(link.fromStepId))).toBe(false);
  });

  // ---------- Pasos ----------

  it('un paso nuevo va al final del proceso y se enlaza con el anterior', () => {
    const processId = store.addProcess();
    const a = store.addStep('schedule', { processId }).id!;
    const b = store.addStep('delay', { processId }).id!;
    const c = store.addStep('send-sms', { processId }).id!;

    expect(inProcess(store, processId)).toEqual([a, b, c]);
    expect(store.connections().some(l => l.fromStepId === a && l.toStepId === b)).toBe(true);
    expect(store.connections().some(l => l.fromStepId === b && l.toStepId === c)).toBe(true);
  });

  it('insertar en un índice mete el paso EN MEDIO y re-enlaza', () => {
    const processId = store.addProcess();
    const a = store.addStep('schedule', { processId }).id!;
    const c = store.addStep('send-sms', { processId }).id!;

    const b = store.addStep('delay', { processId, index: 1 }).id!;

    expect(inProcess(store, processId)).toEqual([a, b, c]);
    expect(store.connections().some(l => l.fromStepId === a && l.toStepId === c)).toBe(false);
    expect(store.connections().some(l => l.fromStepId === a && l.toStepId === b)).toBe(true);
    expect(store.connections().some(l => l.fromStepId === b && l.toStepId === c)).toBe(true);
  });

  it('sin destino explícito el paso va al proceso seleccionado', () => {
    const [first] = store.processes();
    store.selectProcess(first.id);
    const id = store.addStep('delay').id!;
    expect(store.steps().find(step => step.id === id)!.processId).toBe(first.id);
  });

  it('un trigger solo puede ser el primer paso de un proceso', () => {
    const processId = store.addProcess();
    store.addStep('delay', { processId });

    const result = store.addStep('schedule', { processId });
    expect(result.id).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('un trigger elegido sin destino abre un proceso nuevo si no cabe en el activo', () => {
    const before = store.processes().length;
    const first = store.processes()[0];
    store.selectProcess(first.id);

    const id = store.addStep('manual-trigger').id!;

    expect(store.processes().length).toBe(before + 1);
    expect(store.steps().find(step => step.id === id)!.processId).not.toBe(first.id);
  });

  it('un paso que bifurca va siempre el último; uno normal entra ANTES de la bifurcación', () => {
    const processId = store.addProcess();
    const branch = store.addStep('condition', { processId }).id!;
    const after = store.addStep('delay', { processId }).id!;

    expect(inProcess(store, processId)).toEqual([after, branch]);
    // Un segundo paso que bifurca no cabe: ya hay una bifurcación al final.
    expect(store.addStep('router', { processId }).error).toBeTruthy();
  });

  it('un paso que bifurca insertado en medio se coloca al final', () => {
    const processId = store.addProcess();
    const a = store.addStep('schedule', { processId }).id!;
    const b = store.addStep('delay', { processId }).id!;
    const branch = store.addStep('condition', { processId, index: 1 }).id!;

    expect(inProcess(store, processId)).toEqual([a, b, branch]);
  });

  it('borrar un paso recose a los vecinos', () => {
    const processId = store.addProcess();
    const a = store.addStep('schedule', { processId }).id!;
    const b = store.addStep('delay', { processId }).id!;
    const c = store.addStep('send-sms', { processId }).id!;

    store.removeStep(b);

    expect(inProcess(store, processId)).toEqual([a, c]);
    expect(store.connections().some(l => l.fromStepId === a && l.toStepId === c)).toBe(true);
    expect(store.connections().some(l => l.fromStepId === b || l.toStepId === b)).toBe(false);
  });

  it('borrar el último paso lleva la salida hacia otro proceso al nuevo último', () => {
    const source = store.addProcess();
    const a = store.addStep('schedule', { processId: source }).id!;
    const b = store.addStep('delay', { processId: source }).id!;
    const target = store.addProcess();
    const t = store.addStep('send-sms', { processId: target }).id!;
    expect(store.connectExit(b, 'main', target)).toBeNull();

    store.removeStep(b);

    expect(store.connections().some(l => l.fromStepId === a && l.toStepId === t)).toBe(true);
  });

  it('borrar el primer paso de un proceso alimentado re-apunta el hilo al nuevo primero', () => {
    const source = store.addProcess();
    const s = store.addStep('schedule', { processId: source }).id!;
    const target = store.addProcess();
    const t1 = store.addStep('send-sms', { processId: target }).id!;
    const t2 = store.addStep('create-record', { processId: target }).id!;
    expect(store.connectExit(s, 'main', target)).toBeNull();

    store.removeStep(t1);

    expect(store.connections().some(l => l.fromStepId === s && l.toStepId === t2)).toBe(true);
  });

  it('duplicar deja la copia justo detrás; un trigger o una bifurcación no se duplican', () => {
    const processId = store.addProcess();
    const trigger = store.addStep('schedule', { processId }).id!;
    const a = store.addStep('delay', { processId }).id!;
    const branch = store.addStep('condition', { processId }).id!;

    const copy = store.duplicateStep(a).id!;
    expect(inProcess(store, processId)).toEqual([trigger, a, copy, branch]);
    expect(store.duplicateStep(trigger).error).toBeTruthy();
    expect(store.duplicateStep(branch).error).toBeTruthy();
  });

  it('reordena respetando las reglas: el trigger primero, la bifurcación última', () => {
    const processId = store.addProcess();
    const trigger = store.addStep('schedule', { processId }).id!;
    const a = store.addStep('delay', { processId }).id!;
    const b = store.addStep('send-sms', { processId }).id!;
    const branch = store.addStep('condition', { processId }).id!;
    expect(inProcess(store, processId)).toEqual([trigger, a, b, branch]);

    expect(store.moveStep(b, -1)).toBeNull();
    expect(inProcess(store, processId)).toEqual([trigger, b, a, branch]);

    // Nada puede pasar por delante del trigger ni por detrás de la bifurcación.
    expect(store.moveStep(b, -1)).toBeTruthy();
    expect(store.moveStep(a, 1)).toBeTruthy();
    expect(store.moveStep(branch, -1)).toBeTruthy();
    expect(inProcess(store, processId)).toEqual([trigger, b, a, branch]);
  });

  // ---------- Salidas entre procesos ----------

  it('conecta la salida del último paso con el primer paso de otro proceso', () => {
    const from = store.addProcess();
    const a = store.addStep('schedule', { processId: from }).id!;
    const to = store.addProcess();
    const b = store.addStep('send-sms', { processId: to }).id!;

    expect(store.connectExit(a, 'main', to)).toBeNull();

    const link = store.connections().find(l => l.fromStepId === a && l.toStepId === b);
    expect(link).toBeTruthy();
    expect(link!.id).toBeTruthy();
  });

  it('una salida lleva a un solo sitio: reconectarla reemplaza el hilo anterior', () => {
    const from = store.addProcess();
    const a = store.addStep('schedule', { processId: from }).id!;
    const p1 = store.addProcess();
    const t1 = store.addStep('send-sms', { processId: p1 }).id!;
    const p2 = store.addProcess();
    const t2 = store.addStep('create-record', { processId: p2 }).id!;

    store.connectExit(a, 'main', p1);
    store.connectExit(a, 'main', p2);

    const exits = store.connections().filter(l => l.fromStepId === a);
    expect(exits.map(l => l.toStepId)).toEqual([t2]);
    void t1;
  });

  it('rechaza lo que no vale con su motivo', () => {
    const from = store.addProcess();
    const a = store.addStep('delay', { processId: from }).id!;
    const b = store.addStep('send-sms', { processId: from }).id!;
    const to = store.addProcess();
    const t = store.addStep('send-sms', { processId: to }).id!;
    const empty = store.addProcess();
    const triggerProcess = store.addProcess();
    store.addStep('manual-trigger', { processId: triggerProcess });

    expect(store.connectExit(a, 'main', to)).toBe('Only the last step of a process can lead to another process');
    expect(store.connectExit(b, 'main', from)).toBe("A process can't lead to itself");
    expect(store.connectExit(b, 'main', empty)).toBe('That process has no steps yet');
    expect(store.connectExit(b, 'main', triggerProcess)).toMatch(/trigger/);
    expect(store.connectExit(b, 'yes', to)).toBe('That exit does not exist');

    // Un ciclo entre procesos dejaría el flujo sin principio.
    store.connectExit(b, 'main', to);
    expect(store.connectExit(t, 'main', from)).toBe('That would create a loop');
  });

  it('borrar un hilo no borra los pasos', () => {
    const from = store.addProcess();
    const a = store.addStep('schedule', { processId: from }).id!;
    const to = store.addProcess();
    const b = store.addStep('send-sms', { processId: to }).id!;
    store.connectExit(a, 'main', to);
    const link = store.connections().find(c => c.fromStepId === a)!;

    store.disconnect(link.id);

    expect(store.connections().some(c => c.id === link.id)).toBe(false);
    expect(store.steps().some(step => step.id === a)).toBe(true);
    expect(store.steps().some(step => step.id === b)).toBe(true);
  });

  // ---------- Migración ----------

  /** Sin esto, quien ya tenía un workflow guardado lo perdería. */
  it('migra un documento del formato viejo (parentId) a procesos con sus hilos', () => {
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

    // La biblioteca migra la clave vieja al construirse; después se abre por su id.
    const revived = storeOpening('wf');

    expect(revived.name()).toBe('Legacy');
    expect(revived.steps().length).toBe(2);
    expect(revived.steps().every(step => !!step.processId)).toBe(true);
    const link = revived.connections().find(c => c.fromStepId === 'root' && c.toStepId === 'yes');
    expect(link).toBeTruthy();
    // La rama del hijo era, en la práctica, el puerto del padre.
    expect(link!.fromPort).toBe('yes');
  });

  it('un grafo guardado sin procesos se segmenta en cadenas', () => {
    localStorage.setItem(
      'tvf.workflow.v1',
      JSON.stringify({
        id: 'wf',
        name: 'Graph',
        updatedAtIso: new Date().toISOString(),
        steps: [
          { id: 'trigger', typeId: 'form-submitted', title: 't', subtitle: '', config: {} },
          { id: 'agent', typeId: 'ai-agent', title: 'a', subtitle: '', config: {} },
          { id: 'mail', typeId: 'send-email', title: 'm', subtitle: '', config: {} },
          { id: 'rec', typeId: 'create-record', title: 'r', subtitle: '', config: {} },
          { id: 'end', typeId: 'update-record', title: 'e', subtitle: '', config: {} },
        ],
        connections: [
          { id: '1', fromStepId: 'trigger', fromPort: 'main', toStepId: 'agent' },
          { id: '2', fromStepId: 'agent', fromPort: 'yes', toStepId: 'mail' },
          { id: '3', fromStepId: 'agent', fromPort: 'no', toStepId: 'rec' },
          { id: '4', fromStepId: 'mail', fromPort: 'main', toStepId: 'end' },
          { id: '5', fromStepId: 'rec', fromPort: 'main', toStepId: 'end' },
        ],
      }),
    );

    const revived = storeOpening('wf');
    const byProcess = new Map<string, string[]>();
    for (const step of revived.steps()) {
      byProcess.set(step.processId!, [...(byProcess.get(step.processId!) ?? []), step.id]);
    }
    // [trigger, agent] · [mail] · [rec] · [end]: la unión (2 entradas) abre proceso propio.
    expect([...byProcess.values()].sort((x, y) => y.length - x.length)[0]).toEqual(['trigger', 'agent']);
    expect(byProcess.size).toBe(4);
    expect(revived.processes().length).toBe(4);
    // El grafo de datos no cambia: todos los hilos siguen ahí.
    expect(revived.connections().length).toBe(5);
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

    expect(storeOpening('wf').connections()).toEqual([]);
  });

  it('con basura guardada vuelve al ejemplo en vez de romper la pantalla', () => {
    localStorage.setItem('tvf.workflow.v1', '{ not json');
    expect(freshStore().steps().length).toBeGreaterThan(0);
  });

  it('persiste el documento (con sus procesos) y lo recupera en un store nuevo', () => {
    store.rename('My automation');
    const processId = store.addProcess();
    const id = store.addStep('delay', { processId }).id!;

    // Reabrir el MISMO documento, no crear otro: es lo que hace la tabla al pulsarlo.
    const revived = storeOpening(store.doc().id);
    expect(revived.name()).toBe('My automation');
    expect(revived.steps().find(step => step.id === id)!.processId).toBe(processId);
    expect(revived.processes().some(process => process.id === processId)).toBe(true);
  });

  // ---------- Personas ----------

  it('añade colaboradores y persiste; el duplicado se ignora', () => {
    store.addCollaborator({ userId: 'u1', name: 'Ana Diaz', email: 'ana@x.com', role: 'owner' });
    store.addCollaborator({ userId: 'u1', name: 'Ana otra vez', email: 'ana@x.com', role: 'viewer' });

    expect(store.collaborators().length).toBe(1);
    expect(store.collaborators()[0].role).toBe('owner');

    const revived = storeOpening(store.doc().id);
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

  it('los datos viajan entre procesos: lo que manda un proceso le llega al siguiente', () => {
    const intake = store.addProcess();
    store.addStep('form-submitted', { processId: intake });
    const last = store.addStep('delay', { processId: intake }).id!;
    const follow = store.addProcess();
    const mail = store.addStep('send-email', { processId: follow }).id!;

    // Sin conectar, `send-email` no recibe el email del formulario.
    store.select(mail);
    expect(store.selectedMissingInputs().map(f => f.key)).toContain('email');

    store.connectExit(last, 'main', follow);
    store.select(mail);
    expect(store.selectedAvailableFields().map(f => f.key)).toContain('email');
    expect(store.selectedMissingInputs()).toEqual([]);
  });

  // ---------- Historial ----------

  it('un arrastre completo de un proceso deja UN solo paso en el historial', () => {
    const target = store.processes()[1];

    store.beginMove();
    store.moveProcessLive(target.id, 500, 400);
    store.moveProcessLive(target.id, 520, 420);
    store.endMove();
    expect(store.processes().find(p => p.id === target.id)!.x).toBe(520);

    store.undo();
    const restored = store.processes().find(p => p.id === target.id)!;
    expect(restored.x).toBe(target.x);
    expect(restored.y).toBe(target.y);
  });

  it('un clic sin desplazamiento no ensucia el historial', () => {
    store.beginMove();
    store.endMove();
    expect(store.canUndo()).toBe(false);
  });

  it('deshacer restaura también los hilos', () => {
    const before = store.connections().length;
    const processId = store.addProcess();
    store.addStep('delay', { processId });
    store.addStep('send-sms', { processId });
    expect(store.connections().length).toBeGreaterThan(before);

    store.undo();
    store.undo();
    expect(store.connections().length).toBe(before);
  });

  it('tidyLayout recoloca los procesos de izquierda a derecha según sus conexiones', () => {
    store.moveProcessLive(store.processes()[0].id, 3000, 2000);
    store.tidyLayout();

    const intake = store.processes().find(process => process.name === 'Intake')!;
    const follow = store.processes().find(process => process.name === 'Follow-up')!;
    expect(intake.x).toBeLessThan(follow.x);
    expect(intake.x).toBeLessThan(3000);
  });
});

describe('anotaciones del lienzo', () => {
  it('coloca una nota, la guarda en el documento y se puede deshacer', () => {
    const store = freshStore();
    const before = store.annotations().length;

    const id = store.addNote(300, 200, 'purple');
    const note = store.annotations().find(a => a.id === id)!;
    expect(note.kind).toBe('note');
    expect(note.color).toBe('purple');
    expect(note.text).toBe('');

    store.undo();
    expect(store.annotations().length).toBe(before);
  });

  it('nunca coloca en negativo: el lienzo empieza en 0,0 y lo de fuera sale recortado', () => {
    const store = freshStore();
    const id = store.addNote(-500, -40);
    const note = store.annotations().find(a => a.id === id)!;
    expect(note.x).toBe(0);
    expect(note.y).toBe(0);
  });

  it('acota el tamaño de dibujo de una imagen grande sin deformarla', () => {
    const store = freshStore();
    const id = store.addImage('data:image/png;base64,AAA', 0, 0, 1400, 700);
    const image = store.annotations().find(a => a.id === id)!;

    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(360);
    // La proporción original (2:1) se conserva.
    expect(image.width / image.height).toBeCloseTo(2, 1);
  });

  it('editar y borrar una nota queda reflejado en el documento', () => {
    const store = freshStore();
    const id = store.addNote(10, 10);

    store.updateAnnotation(id, { text: 'Revisar el trigger' });
    expect(store.annotations().find(a => a.id === id)!.text).toBe('Revisar el trigger');

    store.removeAnnotation(id);
    expect(store.annotations().some(a => a.id === id)).toBe(false);
  });
});
