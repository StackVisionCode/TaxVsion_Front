import { WorkflowConnection, WorkflowStep } from './workflow.model';
import { WorkflowPreviewService } from './workflow-preview.service';

function step(id: string, typeId: WorkflowStep['typeId'] = 'send-sms'): WorkflowStep {
  return { id, typeId, title: id, subtitle: '', config: {} };
}

function link(id: string, fromStepId: string, toStepId: string): WorkflowConnection {
  return { id, fromStepId, fromPort: 'main', toStepId };
}

/**
 * El motor de la simulación: timers encadenados, cancelación limpia y el modo
 * sin movimiento. Sin TestBed — la clase no tiene dependencias, y así los
 * fake timers no pelean con nada.
 */
describe('WorkflowPreviewService', () => {
  let service: WorkflowPreviewService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new WorkflowPreviewService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const linear = () => ({
    steps: [step('a'), step('b')],
    connections: [link('l1', 'a', 'b')],
  });

  it('arranca corriendo con la primera carta en running', () => {
    const { steps, connections } = linear();
    service.start(steps, connections);

    expect(service.status()).toBe('running');
    expect(service.stepStates().get('a')!.status).toBe('running');
    expect(service.stepStates().get('b')!.status).toBe('pending');
    expect(service.runCount()).toBe(2);
  });

  it('encadena: al vencer el timer la carta termina y arranca la siguiente', () => {
    const { steps, connections } = linear();
    service.start(steps, connections);

    // send-sms se anima 1500 ms: a los 1600 la primera terminó y la segunda corre.
    vi.advanceTimersByTime(1600);

    expect(service.stepStates().get('a')!.status).toBe('done');
    expect(service.stepStates().get('b')!.status).toBe('running');
    expect(service.doneCount()).toBe(1);
    // El hilo hacia la carta en curso se marca activo (fluyendo).
    expect(service.edgeStates().get('l1')).toBe('active');
  });

  it('termina con todo en done y el total acumulado', () => {
    const { steps, connections } = linear();
    service.start(steps, connections);

    vi.advanceTimersByTime(10_000);

    expect(service.status()).toBe('finished');
    expect(service.stepStates().get('b')!.status).toBe('done');
    expect(service.doneCount()).toBe(2);
    expect(service.elapsedRealMs()).toBe(service.totalRealMs());
  });

  it('stop congela el estado y ningún timer pendiente lo pisa después', () => {
    const { steps, connections } = linear();
    service.start(steps, connections);
    service.stop();

    const frozen = service.stepStates().get('a')!.status;
    vi.advanceTimersByTime(10_000);

    expect(service.status()).toBe('stopped');
    expect(service.stepStates().get('a')!.status).toBe(frozen);
  });

  it('reset limpia el overlay por completo', () => {
    const { steps, connections } = linear();
    service.start(steps, connections);
    service.reset();

    expect(service.status()).toBe('idle');
    expect(service.stepStates().size).toBe(0);
    expect(service.edgeStates().size).toBe(0);
  });

  it('un grafo vacío no arranca nada', () => {
    service.start([], []);
    expect(service.status()).toBe('idle');
  });

  it('con "reducir movimiento" resuelve al instante, sin timers', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;

    try {
      const { steps, connections } = linear();
      service.start(steps, connections);

      // Sin avanzar ningún timer: ya está terminado.
      expect(service.status()).toBe('finished');
      expect(service.stepStates().get('b')!.status).toBe('done');
      expect(service.edgeStates().get('l1')).toBe('traversed');
      expect(service.elapsedRealMs()).toBe(service.totalRealMs());
    } finally {
      window.matchMedia = original;
    }
  });
});
