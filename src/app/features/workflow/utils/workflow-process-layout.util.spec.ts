import { WorkflowConnection, WorkflowProcess, WorkflowStep } from '../data-access/workflow.model';
import {
  COLLAPSED_WIDTH,
  PROCESS_WIDTH,
  STEP_HEIGHT,
  STEP_OUTPUTS_HEIGHT,
  autoPlaceProcesses,
  layoutProcesses,
  processHeight,
} from './workflow-process-layout.util';

function step(id: string, typeId: WorkflowStep['typeId'], processId: string): WorkflowStep {
  return { id, typeId, title: id, subtitle: '', config: {}, processId };
}

function proc(id: string, x = 0, y = 0, extra: Partial<WorkflowProcess> = {}): WorkflowProcess {
  return { id, name: id, x, y, colorIndex: 0, ...extra };
}

function link(id: string, from: string, to: string, port = 'main'): WorkflowConnection {
  return { id, fromStepId: from, fromPort: port, toStepId: to };
}

const input = (over: Partial<Parameters<typeof layoutProcesses>[0]> = {}) => ({
  processes: [] as WorkflowProcess[],
  steps: [] as WorkflowStep[],
  connections: [] as WorkflowConnection[],
  missing: new Map(),
  selectedStepId: null,
  selectedProcessId: null,
  ...over,
});

describe('layoutProcesses', () => {
  const flow = () => ({
    processes: [proc('p1', 100, 100), proc('p2', 700, 80)],
    steps: [step('t', 'form-submitted', 'p1'), step('ai', 'ai-agent', 'p1'), step('mail', 'send-email', 'p2')],
    connections: [link('i', 't', 'ai'), link('yes', 'ai', 'mail', 'yes')],
  });

  it('coloca cada paso a una altura fija y deja el `+` entre pasos', () => {
    const layout = layoutProcesses(input(flow()));
    const box = layout.boxes[0];

    expect(box.steps.map(s => s.step.id)).toEqual(['t', 'ai']);
    expect(box.steps[1].y - box.steps[0].y).toBeGreaterThanOrEqual(STEP_HEIGHT);
    expect(box.joins.length).toBe(1);
    expect(box.joins[0].index).toBe(1);
    expect(box.startsWithTrigger).toBe(true);
  });

  it('un paso que bifurca enseña siempre sus dos salidas, y la conectada dice a dónde va', () => {
    const box = layoutProcesses(input(flow())).boxes[0];

    expect(box.exits.map(e => e.label)).toEqual(['Yes', 'No']);
    expect(box.exits[0].targetName).toBe('p2');
    expect(box.exits[1].connectionId).toBeNull();
  });

  it('dibuja un hilo desde la fila de salida hasta la entrada del otro proceso', () => {
    const layout = layoutProcesses(input(flow()));

    expect(layout.links.length).toBe(1);
    const link = layout.links[0];
    const [source, target] = layout.boxes;
    expect(link.path.startsWith(`M ${source.x + source.width} ${source.y + source.exits[0].y}`)).toBe(true);
    expect(link.path.endsWith(`${target.input.x} ${target.input.y}`)).toBe(true);
    expect(target.fed).toBe(true);
  });

  it('la carta seleccionada crece lo que ocupa su fila de datos', () => {
    const plain = layoutProcesses(input(flow())).boxes[0];
    const selected = layoutProcesses(input({ ...flow(), selectedStepId: 't' })).boxes[0];

    expect(selected.steps[0].showOutputs).toBe(true);
    expect(selected.height - plain.height).toBe(STEP_OUTPUTS_HEIGHT);
  });

  it('una salida única solo se ve si está conectada o el proceso está en uso', () => {
    const base = {
      processes: [proc('p1'), proc('p2', 600)],
      steps: [step('a', 'delay', 'p1'), step('b', 'send-sms', 'p2')],
      connections: [] as WorkflowConnection[],
    };
    expect(layoutProcesses(input(base)).boxes[0].exits.length).toBe(0);
    expect(layoutProcesses(input({ ...base, selectedProcessId: 'p1' })).boxes[0].exits.length).toBe(1);
    expect(layoutProcesses(input({ ...base, connections: [link('c', 'a', 'b')] })).boxes[0].exits.length).toBe(1);
  });

  it('una tarjeta plegada es más estrecha y su salida cae a la altura de su cuerpo', () => {
    const data = flow();
    data.processes[0] = proc('p1', 100, 100, { collapsed: true });
    const box = layoutProcesses(input(data)).boxes[0];

    expect(box.width).toBe(COLLAPSED_WIDTH);
    expect(box.steps).toEqual([]);
    expect(box.exits.every(e => e.y > 0 && e.y < box.height)).toBe(true);
  });

  it('el estado refleja si falta algún dato', () => {
    const data = flow();
    const missing = new Map([['ai', [{ key: 'email', label: 'Email', type: 'string' as const }]]]);
    expect(layoutProcesses(input({ ...data, missing })).boxes[0].status).toBe('needs-setup');
    expect(layoutProcesses(input(data)).boxes[0].status).toBe('ready');
    expect(layoutProcesses(input({ processes: [proc('e')] })).boxes[0].status).toBe('empty');
  });

  it('el lienzo siempre es más grande que el contenido', () => {
    const layout = layoutProcesses(input(flow()));
    expect(layout.width).toBeGreaterThan(layout.content.maxX);
    expect(layout.height).toBeGreaterThan(layout.content.maxY);
    expect(layout.content.minX).toBe(100);
  });
});

describe('processHeight', () => {
  it('crece con los pasos y con las filas de salida', () => {
    const base = { startsWithTrigger: false, exitRows: 0, selectedHasOutputs: false, collapsed: false };
    expect(processHeight({ ...base, stepCount: 3 })).toBeGreaterThan(processHeight({ ...base, stepCount: 2 }));
    expect(processHeight({ ...base, stepCount: 2, exitRows: 2 })).toBeGreaterThan(processHeight({ ...base, stepCount: 2 }));
  });
});

describe('autoPlaceProcesses', () => {
  it('una columna por nivel, de izquierda a derecha según las conexiones', () => {
    const processes = [proc('a'), proc('b'), proc('c')];
    const steps = [step('1', 'schedule', 'a'), step('2', 'delay', 'b'), step('3', 'send-sms', 'c')];
    const placed = autoPlaceProcesses(processes, steps, [link('x', '1', '2'), link('y', '2', '3')]);

    expect(placed[0].x).toBeLessThan(placed[1].x);
    expect(placed[1].x).toBeLessThan(placed[2].x);
    expect(placed[1].x - placed[0].x).toBeGreaterThanOrEqual(PROCESS_WIDTH);
  });

  it('los del mismo nivel se apilan sin solaparse', () => {
    const processes = [proc('a'), proc('b'), proc('c')];
    const steps = [step('1', 'ai-agent', 'a'), step('2', 'delay', 'b'), step('3', 'send-sms', 'c')];
    const placed = autoPlaceProcesses(processes, steps, [link('x', '1', '2', 'yes'), link('y', '1', '3', 'no')]);

    expect(placed[1].x).toBe(placed[2].x);
    expect(placed[2].y).toBeGreaterThan(placed[1].y);
  });

  it('un ciclo no cuelga el cálculo', () => {
    const processes = [proc('a'), proc('b')];
    const steps = [step('1', 'delay', 'a'), step('2', 'delay', 'b')];
    expect(() => autoPlaceProcesses(processes, steps, [link('x', '1', '2'), link('y', '2', '1')])).not.toThrow();
  });
});
