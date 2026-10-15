import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowProcessCardComponent } from './workflow-process-card.component';
import { WorkflowConnection, WorkflowProcess, WorkflowStep } from '../../data-access/workflow.model';
import { ProcessBox, layoutProcesses } from '../../utils/workflow-process-layout.util';

const steps: WorkflowStep[] = [
  { id: 't', typeId: 'form-submitted', title: 'New Lead', subtitle: 'Form', config: {}, processId: 'p1' },
  { id: 'ai', typeId: 'ai-agent', title: 'Qualifier', subtitle: '', config: {}, processId: 'p1' },
  { id: 'm', typeId: 'send-email', title: 'Welcome', subtitle: '', config: {}, processId: 'p2' },
];
const processes: WorkflowProcess[] = [
  { id: 'p1', name: 'Intake', x: 40, y: 60, colorIndex: 0 },
  { id: 'p2', name: 'Follow-up', x: 600, y: 60, colorIndex: 1 },
];
const connections: WorkflowConnection[] = [
  { id: 'i', fromStepId: 't', fromPort: 'main', toStepId: 'ai' },
  { id: 'yes', fromStepId: 'ai', fromPort: 'yes', toStepId: 'm' },
];

function box(over: Partial<WorkflowProcess> = {}, selectedStepId: string | null = null): ProcessBox {
  return layoutProcesses({
    processes: [{ ...processes[0], ...over }, processes[1]],
    steps,
    connections,
    missing: new Map(),
    selectedStepId,
    selectedProcessId: null,
  }).boxes[0];
}

describe('WorkflowProcessCardComponent', () => {
  let fixture: ComponentFixture<WorkflowProcessCardComponent>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WorkflowProcessCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(WorkflowProcessCardComponent);
  });

  function render(b: ProcessBox, extra: Record<string, unknown> = {}): void {
    fixture.componentRef.setInput('box', b);
    for (const [key, value] of Object.entries(extra)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  it('respeta el tamaño que impone el layout', () => {
    const b = box();
    render(b);
    const card = host().querySelector('.pc') as HTMLElement;

    expect(card.style.width).toBe(`${b.width}px`);
    expect(card.style.height).toBe(`${b.height}px`);
  });

  it('pinta el nombre, el recuento y los pasos en orden', () => {
    render(box());
    const titles = [...host().querySelectorAll('.pc-step-text strong')].map(el => el.textContent?.trim());

    expect(host().textContent).toContain('Intake');
    expect(host().textContent).toContain('Process · 2 actions');
    expect(titles).toEqual(['New Lead', 'Qualifier']);
    expect(host().textContent).toContain('STARTS WHEN');
  });

  it('enseña las salidas del paso que bifurca y a dónde va la conectada', () => {
    render(box());
    const pills = [...host().querySelectorAll('.pc-exit-pill')].map(el => el.textContent?.trim());

    expect(pills).toEqual(['Go to Follow-up', 'Connect exit']);
  });

  it('el paso seleccionado enseña lo que manda', () => {
    render(box({}, 't'), { selectedStepId: 't' });
    expect(host().querySelector('.pc-step-sends')).not.toBeNull();
  });

  it('plegada no pinta pasos, solo sus iconos', () => {
    render(box({ collapsed: true }));
    expect(host().querySelector('.pc-step')).toBeNull();
    expect(host().querySelectorAll('.pc-mini-icon').length).toBe(2);
  });

  it('emite insertar al pulsar el `+` entre pasos y "Add action"', () => {
    render(box());
    const events: unknown[] = [];
    fixture.componentInstance.insertAt.subscribe(event => events.push(event));

    (host().querySelector('.pc-join') as HTMLElement).click();
    (host().querySelector('.pc-add') as HTMLElement).click();

    expect(events).toEqual([
      { processId: 'p1', index: 1 },
      { processId: 'p1', index: null },
    ]);
  });

  it('elegir un destino en el menú de la salida emite el enlace', () => {
    render(box(), { targets: [{ id: 'p2', name: 'Follow-up', disabled: false }] });
    const events: unknown[] = [];
    fixture.componentInstance.connectExit.subscribe(event => events.push(event));

    (host().querySelectorAll('.pc-exit-pill')[1] as HTMLElement).click();
    fixture.detectChanges();
    (host().querySelector('.pc-menu button') as HTMLElement).click();

    expect(events).toEqual([{ stepId: 'ai', port: 'no', processId: 'p2' }]);
  });
});
