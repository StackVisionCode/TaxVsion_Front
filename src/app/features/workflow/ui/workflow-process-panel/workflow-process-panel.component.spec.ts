import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowProcessPanelComponent } from './workflow-process-panel.component';
import { WorkflowProcess, WorkflowStep } from '../../data-access/workflow.model';

const process: WorkflowProcess = { id: 'p', name: 'Intake', x: 0, y: 0, colorIndex: 0 };
const steps: WorkflowStep[] = [
  { id: 'a', typeId: 'schedule', title: 'Daily', subtitle: '', config: {}, processId: 'p' },
  { id: 'b', typeId: 'delay', title: 'Wait', subtitle: '', config: {}, processId: 'p' },
];

describe('WorkflowProcessPanelComponent', () => {
  let fixture: ComponentFixture<WorkflowProcessPanelComponent>;
  const host = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WorkflowProcessPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(WorkflowProcessPanelComponent);
    fixture.componentRef.setInput('process', process);
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
  });

  it('lista las acciones en orden y deshabilita subir la primera y bajar la última', () => {
    expect(host().textContent).toContain('1 · Daily');
    expect(host().textContent).toContain('2 · Wait');
    const ups = host().querySelectorAll<HTMLButtonElement>('button[aria-label$="up"]');
    const downs = host().querySelectorAll<HTMLButtonElement>('button[aria-label$="down"]');
    expect(ups[0].disabled).toBe(true);
    expect(downs[downs.length - 1].disabled).toBe(true);
  });

  it('emite mover, añadir acción y borrar', () => {
    const moves: unknown[] = [];
    let added = 0;
    let deleted = 0;
    fixture.componentInstance.move.subscribe(event => moves.push(event));
    fixture.componentInstance.addAction.subscribe(() => added++);
    fixture.componentInstance.deleteProcess.subscribe(() => deleted++);

    host().querySelector<HTMLButtonElement>('button[aria-label="Move Daily down"]')!.click();
    const buttons = [...host().querySelectorAll<HTMLButtonElement>('button')];
    buttons.find(b => b.textContent?.includes('Add action'))!.click();
    buttons.find(b => b.textContent?.includes('Delete process'))!.click();

    expect(moves).toEqual([{ id: 'a', delta: 1 }]);
    expect(added).toBe(1);
    expect(deleted).toBe(1);
  });

  it('renombra al salir del campo, y un nombre vacío no emite nada', () => {
    const names: string[] = [];
    fixture.componentInstance.rename.subscribe(name => names.push(name));
    const input = host().querySelector<HTMLInputElement>('#wf-process-name')!;

    input.value = '  Onboarding ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));

    expect(names).toEqual(['Onboarding']);
  });
});
