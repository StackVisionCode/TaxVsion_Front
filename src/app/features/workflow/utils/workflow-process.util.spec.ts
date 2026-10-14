import { WorkflowConnection, WorkflowStep } from '../data-access/workflow.model';
import {
  dependentsOf,
  firstStepOf,
  lastStepOf,
  migrateToProcesses,
  nextProcessName,
  stepsOfProcess,
  syncProcessLinks,
} from './workflow-process.util';

function step(id: string, typeId: WorkflowStep['typeId'], processId?: string): WorkflowStep {
  return { id, typeId, title: id, subtitle: '', config: {}, processId };
}

function link(id: string, from: string, to: string, port = 'main'): WorkflowConnection {
  return { id, fromStepId: from, fromPort: port, toStepId: to };
}

describe('syncProcessLinks', () => {
  it('enlaza cada paso con el siguiente dentro de su proceso, y solo eso', () => {
    const steps = [step('a', 'schedule', 'p'), step('b', 'delay', 'p'), step('c', 'send-sms', 'p')];
    const links = syncProcessLinks(steps, [link('stale', 'a', 'c')]);

    expect(links.map(l => `${l.fromStepId}>${l.toStepId}`)).toEqual(['a>b', 'b>c']);
  });

  it('conserva el id de un hilo interno que ya existía', () => {
    const steps = [step('a', 'schedule', 'p'), step('b', 'delay', 'p')];
    expect(syncProcessLinks(steps, [link('keep', 'a', 'b')])[0].id).toBe('keep');
  });

  it('los hilos entre procesos solo salen del último paso y entran por el primero', () => {
    const steps = [step('a', 'schedule', 'p1'), step('b', 'delay', 'p1'), step('x', 'send-sms', 'p2'), step('y', 'delay', 'p2')];
    const links = syncProcessLinks(steps, [link('c', 'b', 'x')]);
    expect(links.find(l => l.id === 'c')).toBeTruthy();

    // Un hilo que entra por el segundo paso se re-apunta al primero del proceso destino.
    const retargeted = syncProcessLinks(steps, [link('c', 'b', 'y')]);
    expect(retargeted.find(l => l.id === 'c')!.toStepId).toBe('x');
  });

  it('la salida main acompaña al final del proceso cuando se añade un paso detrás', () => {
    const steps = [step('a', 'schedule', 'p1'), step('b', 'delay', 'p1'), step('x', 'send-sms', 'p2')];
    const links = syncProcessLinks(steps, [link('c', 'a', 'x')]);
    expect(links.find(l => l.id === 'c')!.fromStepId).toBe('b');
  });

  it('una salida Yes/No de un paso que ya no es el último se descarta', () => {
    const steps = [step('a', 'condition', 'p1'), step('b', 'delay', 'p1'), step('x', 'send-sms', 'p2')];
    expect(syncProcessLinks(steps, [link('c', 'a', 'x', 'yes')]).some(l => l.id === 'c')).toBe(false);
  });

  it('descarta hilos hacia pasos que ya no existen', () => {
    const steps = [step('a', 'schedule', 'p1')];
    expect(syncProcessLinks(steps, [link('c', 'a', 'ghost')])).toEqual([]);
  });
});

describe('migrateToProcesses', () => {
  it('una cadena lineal es un solo proceso', () => {
    const steps = [step('a', 'schedule'), step('b', 'delay'), step('c', 'send-sms')];
    const result = migrateToProcesses(steps, [link('1', 'a', 'b'), link('2', 'b', 'c')]);

    expect(result.processes.length).toBe(1);
    expect(result.steps.map(s => s.id)).toEqual(['a', 'b', 'c']);
    expect(new Set(result.steps.map(s => s.processId)).size).toBe(1);
  });

  it('una bifurcación cierra su proceso y cada rama abre uno nuevo', () => {
    const steps = [step('t', 'form-submitted'), step('ai', 'ai-agent'), step('y', 'send-email'), step('n', 'create-record')];
    const result = migrateToProcesses(steps, [link('1', 't', 'ai'), link('2', 'ai', 'y', 'yes'), link('3', 'ai', 'n', 'no')]);

    expect(result.processes.length).toBe(3);
    const intake = result.steps.filter(s => s.processId === result.steps[0].processId).map(s => s.id);
    expect(intake).toEqual(['t', 'ai']);
    expect(result.connections.length).toBe(3);
  });

  it('un paso con dos entradas (unión) abre proceso propio', () => {
    const steps = [step('a', 'schedule'), step('b', 'delay'), step('end', 'update-record')];
    const result = migrateToProcesses(steps, [link('1', 'a', 'end'), link('2', 'b', 'end')]);

    expect(result.processes.length).toBe(3);
    expect(result.connections.length).toBe(2);
  });

  it('un paso suelto o en ciclo no se pierde', () => {
    const steps = [step('lone', 'schedule'), step('x', 'delay'), step('y', 'send-sms')];
    const result = migrateToProcesses(steps, [link('1', 'x', 'y'), link('2', 'y', 'x')]);

    expect(result.steps.map(s => s.id).sort()).toEqual(['lone', 'x', 'y']);
    expect(result.steps.every(s => !!s.processId)).toBe(true);
  });

  it('los procesos migrados se llaman Process N y ciclan el acento', () => {
    const steps = [step('a', 'schedule'), step('b', 'schedule'), step('c', 'schedule'), step('d', 'schedule')];
    const { processes } = migrateToProcesses(steps, []);
    expect(processes.map(p => p.name)).toEqual(['Process 1', 'Process 2', 'Process 3', 'Process 4']);
    expect(processes.map(p => p.colorIndex)).toEqual([0, 1, 2, 0]);
  });
});

describe('ayudantes', () => {
  const steps = [step('a', 'schedule', 'p1'), step('b', 'delay', 'p1'), step('c', 'send-sms', 'p2')];

  it('primero, último y pasos de un proceso, en orden', () => {
    expect(stepsOfProcess(steps, 'p1').map(s => s.id)).toEqual(['a', 'b']);
    expect(firstStepOf(steps, 'p1')!.id).toBe('a');
    expect(lastStepOf(steps, 'p1')!.id).toBe('b');
    expect(firstStepOf(steps, 'nope')).toBeNull();
  });

  it('nextProcessName salta los nombres ya usados', () => {
    expect(nextProcessName([{ id: '1', name: 'Process 2', x: 0, y: 0, colorIndex: 0 }])).toBe('Process 3');
  });

  it('dependentsOf dice qué pasos posteriores usan datos que manda este', () => {
    const flow = [step('form', 'form-submitted', 'p1'), step('mail', 'send-email', 'p1')];
    const dependents = dependentsOf(flow, [link('1', 'form', 'mail')], 'form');

    expect(dependents.map(d => d.step.id)).toEqual(['mail']);
    expect(dependents[0].fields).toContain('Email');
  });
});
