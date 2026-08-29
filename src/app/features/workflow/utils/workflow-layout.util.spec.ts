import { WorkflowConnection, WorkflowStep } from '../data-access/workflow.model';
import { NODE_WIDTH, layoutWorkflow } from './workflow-layout.util';

function step(id: string, typeId: WorkflowStep['typeId'] = 'send-email', extra: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, typeId, title: id, subtitle: '', config: {}, ...extra };
}

function link(id: string, fromStepId: string, toStepId: string, fromPort = 'main'): WorkflowConnection {
  return { id, fromStepId, fromPort, toStepId };
}

describe('layoutWorkflow', () => {
  it('sin pasos devuelve un layout vacío en vez de reventar', () => {
    const layout = layoutWorkflow([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.end).toBeNull();
  });

  it('coloca una cadena en niveles descendentes', () => {
    const layout = layoutWorkflow(
      [step('a'), step('b'), step('c')],
      [link('l1', 'a', 'b'), link('l2', 'b', 'c')],
    );

    const y = (id: string) => layout.nodes.find(n => n.step.id === id)!.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('c'));
  });

  /** Es lo que el modelo de árbol no podía representar. */
  it('deja que dos ramas vuelvan a unirse en la misma carta', () => {
    const steps = [step('root', 'condition'), step('yes'), step('no'), step('merge')];
    const connections = [
      link('l1', 'root', 'yes', 'yes'),
      link('l2', 'root', 'no', 'no'),
      link('l3', 'yes', 'merge'),
      link('l4', 'no', 'merge'),
    ];
    const layout = layoutWorkflow(steps, connections);

    const merge = layout.nodes.find(n => n.step.id === 'merge')!;
    expect(merge.inDegree).toBe(2);
    // Y queda por debajo de las dos ramas, no al lado.
    const yesY = layout.nodes.find(n => n.step.id === 'yes')!.y;
    expect(merge.y).toBeGreaterThan(yesY);
  });

  it('da a cada carta un anclaje por salida declarada', () => {
    const layout = layoutWorkflow([step('root', 'condition'), step('a')], [link('l1', 'root', 'a', 'yes')]);

    const root = layout.nodes.find(n => n.step.id === 'root')!;
    // `condition` declara dos salidas: los puertos se reparten a lo ancho.
    expect(root.outputs.length).toBe(2);
    expect(root.outputs[0].x).toBeLessThan(root.outputs[1].x);
    expect(root.outputs.every(port => port.y === root.y + root.height)).toBe(true);
  });

  it('los hilos conservan el id real de la conexión', () => {
    const layout = layoutWorkflow([step('a'), step('b')], [link('my-link', 'a', 'b')]);

    const connector = layout.connectors.find(c => c.id === 'my-link');
    expect(connector).toBeTruthy();
    expect(connector!.fromStepId).toBe('a');
    expect(connector!.toStepId).toBe('b');
    expect(connector!.path).toContain('M ');
  });

  it('etiqueta Yes/No solo cuando la carta tiene más de una salida', () => {
    const branched = layoutWorkflow(
      [step('root', 'condition'), step('a'), step('b')],
      [link('l1', 'root', 'a', 'yes'), link('l2', 'root', 'b', 'no')],
    );
    expect(branched.connectors.map(c => c.label).filter(Boolean).sort()).toEqual(['No', 'Yes']);

    const plain = layoutWorkflow([step('a'), step('b')], [link('l1', 'a', 'b')]);
    expect(plain.connectors[0].label).toBeNull();
  });

  /**
   * Antes, cada hoja generaba dos `+` superpuestos (el suyo y el del END) y
   * ganaba el del END, que insertaba en la raíz.
   */
  it('deja un solo punto de inserción por salida libre', () => {
    const layout = layoutWorkflow([step('a'), step('b')], [link('l1', 'a', 'b')]);

    // `a` tiene su salida ocupada; `b` no tiene ninguna conexión saliente.
    expect(layout.openEnds.map(open => open.stepId)).toEqual(['b']);
    expect(layout.openEnds.length).toBe(1);
  });

  it('una carta que necesita un dato que nadie manda queda marcada', () => {
    // `send-email` declara que consume `email`; suelta, nadie se lo da.
    const alone = layoutWorkflow([step('mail', 'send-email')], []);
    expect(alone.nodes[0].missing.map(f => f.key)).toContain('email');

    // Con un `form-submitted` delante, que sí produce `email`, deja de faltar.
    const fed = layoutWorkflow(
      [step('form', 'form-submitted'), step('mail', 'send-email')],
      [link('l1', 'form', 'mail')],
    );
    expect(fed.nodes.find(n => n.step.id === 'mail')!.missing).toEqual([]);
  });

  it('cuenta las conexiones de entrada y salida de cada carta', () => {
    const layout = layoutWorkflow(
      [step('a'), step('b'), step('c')],
      [link('l1', 'a', 'c'), link('l2', 'b', 'c')],
    );

    const c = layout.nodes.find(n => n.step.id === 'c')!;
    expect(c.inDegree).toBe(2);
    expect(c.outDegree).toBe(0);
    expect(layout.nodes.find(n => n.step.id === 'a')!.outDegree).toBe(1);
  });

  it('no se cuelga con un documento que tiene un ciclo', () => {
    const layout = layoutWorkflow(
      [step('a'), step('b')],
      [link('l1', 'a', 'b'), link('l2', 'b', 'a')],
    );
    expect(layout.nodes.length).toBe(2);
  });

  it('respeta la posición manual y deja el resto automático', () => {
    const layout = layoutWorkflow([step('a'), step('b', 'send-email', { x: 900, y: 640 })], [link('l1', 'a', 'b')]);

    const moved = layout.nodes.find(n => n.step.id === 'b')!;
    expect(moved.x).toBe(900);
    expect(moved.y).toBe(640);
    expect(layout.nodes.find(n => n.step.id === 'a')!.x).not.toBe(900);
  });

  it('mantiene el dibujo en coordenadas positivas y con sitio de sobra', () => {
    const layout = layoutWorkflow([step('a'), step('b')], [link('l1', 'a', 'b')]);

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.width).toBe(NODE_WIDTH);
    }
    expect(layout.width).toBeGreaterThan(NODE_WIDTH);
  });
});
