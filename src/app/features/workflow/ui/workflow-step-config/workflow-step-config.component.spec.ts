import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowStepConfigComponent, StepConfigPatch } from './workflow-step-config.component';
import { WorkflowStep } from '../../data-access/workflow.model';

const step: WorkflowStep = {
  id: 'a',
  typeId: 'ai-agent',
  title: 'Lead Qualifier',
  subtitle: 'Score',
  config: { onError: 'retry' },
  processId: 'p',
};

describe('WorkflowStepConfigComponent', () => {
  let fixture: ComponentFixture<WorkflowStepConfigComponent>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WorkflowStepConfigComponent] }).compileComponents();
    fixture = TestBed.createComponent(WorkflowStepConfigComponent);
  });

  function open(extra: Partial<WorkflowStepConfigComponent> = {}): void {
    fixture.componentInstance.step = step;
    Object.assign(fixture.componentInstance, extra);
    fixture.detectChanges();
  }

  const tab = (label: string) =>
    [...host().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(el => el.textContent?.trim() === label)!;

  it('sin paso seleccionado pide elegir uno', () => {
    fixture.detectChanges();
    expect(host().textContent).toContain('Select a step to configure it');
  });

  it('abre en Setup y enseña dónde está el paso', () => {
    open({ position: { index: 1, total: 4, processName: 'Intake' } });

    expect(tab('Setup').getAttribute('aria-selected')).toBe('true');
    expect(host().textContent).toContain('Step 2 of 4 · Intake');
    expect(host().textContent).toContain('Title');
  });

  it('Data enseña lo que recibe y lo que manda, y avisa de lo que falta', () => {
    open({
      availableFields: [{ key: 'email', label: 'Email', type: 'string' }],
      missingFields: [{ key: 'name', label: 'Name', type: 'string' }],
    });
    tab('Data').click();
    fixture.detectChanges();

    expect(host().textContent).toContain('Email');
    expect(host().textContent).toContain('Nothing before this step provides');
    expect(host().textContent).toContain('Lead score');
  });

  it('Settings avisa de los pasos que dependen de lo que este manda', () => {
    open({
      dependents: [{ step: { ...step, id: 'c', title: 'Condition' }, fields: ['Lead score', 'Intent'] }],
    });
    tab('Settings').click();
    fixture.detectChanges();

    expect(host().textContent).toContain('Condition');
    expect(host().textContent).toContain('needs Lead score and Intent');
  });

  it('guarda "If this step fails" dentro de config.onError', () => {
    open();
    let saved: StepConfigPatch | null = null;
    fixture.componentInstance.save.subscribe(patch => (saved = patch));

    // El valor guardado se recupera al abrir el paso.
    expect(fixture.componentInstance.onError()).toBe('retry');
    fixture.componentInstance.onError.set('continue');
    fixture.componentInstance.onSave();

    expect(saved!.config['onError']).toBe('continue');
  });
});
