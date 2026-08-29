import { WorkflowConnection, WorkflowStep } from '../data-access/workflow.model';
import { formatDuration, planSimulation } from './workflow-simulation.util';

function step(id: string, typeId: WorkflowStep['typeId'] = 'send-sms', extra: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, typeId, title: id, subtitle: '', config: {}, ...extra };
}

function link(id: string, fromStepId: string, toStepId: string, fromPort = 'main'): WorkflowConnection {
  return { id, fromStepId, fromPort, toStepId };
}

/** random sembrado: la primera decisión de rama es determinista. */
const alwaysYes = () => 0.1;
const alwaysNo = () => 0.9;

describe('planSimulation', () => {
  const branched = () => ({
    steps: [step('root', 'condition'), step('a'), step('b'), step('merge', 'update-record')],
    connections: [
      link('l-yes', 'root', 'a', 'yes'),
      link('l-no', 'root', 'b', 'no'),
      link('l-am', 'a', 'merge'),
      link('l-bm', 'b', 'merge'),
    ],
  });

  it('recorre solo la rama elegida y marca la otra como skipped', () => {
    const { steps, connections } = branched();
    const plan = planSimulation(steps, connections, alwaysYes);

    expect(plan.entries.map(e => e.stepId)).toContain('a');
    expect(plan.skippedStepIds).toContain('b');
    expect(plan.traversedConnectionIds).toContain('l-yes');
    expect(plan.skippedConnectionIds).toContain('l-no');
  });

  it('la otra semilla toma la otra rama', () => {
    const { steps, connections } = branched();
    const plan = planSimulation(steps, connections, alwaysNo);

    expect(plan.entries.map(e => e.stepId)).toContain('b');
    expect(plan.skippedStepIds).toContain('a');
  });

  /** Con AND-join el merge del ejemplo se bloquearía siempre. */
  it('OR-join: el merge corre una vez aunque solo llegue una rama', () => {
    const { steps, connections } = branched();
    const plan = planSimulation(steps, connections, alwaysYes);

    const mergeRuns = plan.entries.filter(e => e.stepId === 'merge');
    expect(mergeRuns.length).toBe(1);
    // El hilo de la rama muerta hacia el merge queda sin recorrer.
    expect(plan.skippedConnectionIds).toContain('l-bm');
  });

  it('registra el puerto elegido en la carta que bifurca', () => {
    const { steps, connections } = branched();
    const plan = planSimulation(steps, connections, alwaysYes);

    expect(plan.entries.find(e => e.stepId === 'root')!.chosenPort).toBe('yes');
    expect(plan.entries.find(e => e.stepId === 'a')!.chosenPort).toBeNull();
  });

  it('un Delay de 2 horas dura 2 h reales pero se anima comprimido', () => {
    const plan = planSimulation(
      [step('wait', 'delay', { config: { duration: '2', unit: 'Hours' } })],
      [],
      alwaysYes,
    );

    const entry = plan.entries[0];
    expect(entry.realMs).toBe(7_200_000);
    expect(entry.animMs).toBe(2400);
    expect(plan.totalRealMs).toBe(7_200_000);
  });

  it('un Delay sin configurar cae a un valor razonable, no a cero', () => {
    const plan = planSimulation([step('wait', 'delay')], [], alwaysYes);
    expect(plan.entries[0].realMs).toBe(5 * 60_000);
  });

  it('marca con warning la carta que necesita un dato que nadie manda', () => {
    // send-email consume `email`; sola, nadie se lo da.
    const alone = planSimulation([step('mail', 'send-email')], [], alwaysYes);
    expect(alone.entries[0].missingLabels).toContain('Email');

    // Alimentada por un form-submitted (que produce email), el warning desaparece.
    const fed = planSimulation(
      [step('form', 'form-submitted'), step('mail', 'send-email')],
      [link('l1', 'form', 'mail')],
      alwaysYes,
    );
    expect(fed.entries.find(e => e.stepId === 'mail')!.missingLabels).toEqual([]);
  });

  it('el total es la suma de lo ejecutado, no de todo el grafo', () => {
    const { steps, connections } = branched();
    const plan = planSimulation(steps, connections, alwaysYes);

    const executedSum = plan.entries.reduce((sum, e) => sum + e.realMs, 0);
    expect(plan.totalRealMs).toBe(executedSum);
    // La carta skipped no aporta al total.
    expect(plan.entries.some(e => e.stepId === 'b')).toBe(false);
  });

  it('un grafo vacío da un plan vacío', () => {
    const plan = planSimulation([], [], alwaysYes);
    expect(plan.entries).toEqual([]);
    expect(plan.totalRealMs).toBe(0);
  });
});

describe('formatDuration', () => {
  it('elige la unidad legible', () => {
    expect(formatDuration(800)).toBe('800 ms');
    expect(formatDuration(2000)).toBe('2 s');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration(7_200_000)).toBe('2 h');
    expect(formatDuration(3 * 86_400_000)).toBe('3 d');
  });
});
