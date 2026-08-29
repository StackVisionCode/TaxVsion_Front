import { WorkflowStep } from '../data-access/workflow.model';
import { NODE_WIDTH, layoutWorkflow } from './workflow-layout.util';

function step(id: string, parentId: string | null, extra: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    typeId: 'send-email',
    title: id,
    subtitle: '',
    parentId,
    branch: null,
    config: {},
    ...extra,
  };
}

describe('layoutWorkflow', () => {
  it('sin raíz devuelve un layout vacío en vez de reventar', () => {
    expect(layoutWorkflow([]).nodes).toEqual([]);
    // Solo hijos huérfanos: tampoco hay por dónde empezar.
    expect(layoutWorkflow([step('a', 'ghost')]).nodes).toEqual([]);
  });

  it('alinea una cadena lineal en la misma columna', () => {
    const layout = layoutWorkflow([step('a', null), step('b', 'a'), step('c', 'b')]);

    const xs = layout.nodes.map(node => node.x);
    expect(new Set(xs).size).toBe(1);
    // Y cada paso queda por debajo del anterior.
    const ys = layout.nodes.map(node => node.y);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
  });

  it('coloca las ramas Yes/No a los lados y centradas sobre el padre', () => {
    const layout = layoutWorkflow([
      step('root', null, { typeId: 'condition' }),
      step('yes', 'root', { branch: 'yes' }),
      step('no', 'root', { branch: 'no' }),
    ]);

    const root = layout.nodes.find(n => n.step.id === 'root')!;
    const yes = layout.nodes.find(n => n.step.id === 'yes')!;
    const no = layout.nodes.find(n => n.step.id === 'no')!;

    expect(yes.x).toBeLessThan(root.x);
    expect(no.x).toBeGreaterThan(root.x);
    // El padre queda a la misma distancia de cada rama.
    const center = (x: number) => x + NODE_WIDTH / 2;
    expect(center(root.x) - center(yes.x)).toBeCloseTo(center(no.x) - center(root.x), 5);
  });

  it('etiqueta los conectores de un paso que bifurca', () => {
    const layout = layoutWorkflow([
      step('root', null, { typeId: 'condition' }),
      step('yes', 'root', { branch: 'yes' }),
      step('no', 'root', { branch: 'no' }),
    ]);

    const labels = layout.connectors.map(c => c.label).filter(Boolean);
    expect(labels).toContain('Yes');
    expect(labels).toContain('No');
  });

  it('un paso con pie más alto empuja a su hijo hacia abajo', () => {
    const withFooter = layoutWorkflow([
      step('a', null, { config: { form: 'Lead Generation Form' } }),
      step('b', 'a'),
    ]);
    const withoutFooter = layoutWorkflow([step('a', null), step('b', 'a')]);

    const childY = (layout: ReturnType<typeof layoutWorkflow>) =>
      layout.nodes.find(n => n.step.id === 'b')!.y;
    expect(childY(withFooter)).toBeGreaterThan(childY(withoutFooter));
  });

  it('deriva un END al final y conecta las hojas', () => {
    const layout = layoutWorkflow([
      step('root', null, { typeId: 'condition' }),
      step('yes', 'root', { branch: 'yes' }),
      step('no', 'root', { branch: 'no' }),
    ]);

    expect(layout.end).not.toBeNull();
    expect(layout.connectors.filter(c => c.id.endsWith('->END')).length).toBe(2);
  });

  /**
   * El documento vive en localStorage y se puede editar a mano: un ciclo no
   * debe colgar la pestaña.
   */
  it('no se cuelga con un documento que tiene un ciclo', () => {
    const cyclic: WorkflowStep[] = [step('a', null), step('b', 'a'), step('c', 'b')];
    // c pasa a ser padre de b: b → c → b.
    cyclic[1] = { ...cyclic[1], parentId: 'c' };

    const layout = layoutWorkflow(cyclic);
    expect(layout.nodes.length).toBeGreaterThan(0);
  });

  it('respeta la posición manual de un nodo y deja el resto automático', () => {
    const layout = layoutWorkflow([step('a', null), step('b', 'a', { x: 900, y: 640 })]);

    const moved = layout.nodes.find(n => n.step.id === 'b')!;
    expect(moved.x).toBe(900);
    expect(moved.y).toBe(640);
    // El padre, sin posición propia, lo sigue decidiendo el layout.
    expect(layout.nodes.find(n => n.step.id === 'a')!.x).not.toBe(900);
  });

  it('traza los conectores contra la posición final, no la automática', () => {
    const layout = layoutWorkflow([step('a', null), step('b', 'a', { x: 900, y: 640 })]);

    const edge = layout.connectors.find(c => c.id === 'a->b')!;
    // El punto medio tiene que caer entre padre e hijo movido.
    const parent = layout.nodes.find(n => n.step.id === 'a')!;
    expect(edge.midX).toBeGreaterThan(Math.min(parent.x, 900));
    expect(edge.midY).toBeGreaterThan(parent.y);
    expect(edge.path).toContain('M ');
  });

  it('el lienzo crece para dejar sitio más allá del último nodo', () => {
    const layout = layoutWorkflow([step('a', null), step('b', 'a', { x: 1200, y: 900 })]);

    expect(layout.width).toBeGreaterThan(1200);
    expect(layout.height).toBeGreaterThan(900);
  });

  it('mantiene todo el dibujo en coordenadas positivas', () => {
    const layout = layoutWorkflow([
      step('root', null, { typeId: 'condition' }),
      step('yes', 'root', { branch: 'yes' }),
      step('no', 'root', { branch: 'no' }),
    ]);

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
