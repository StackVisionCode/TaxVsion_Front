import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { TaskItem, TaskResponse, toTaskItem } from '../../data-access/task.model';
import { TaskListComponent } from './task-list.component';

function response(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 't1',
    title: 'Prepare return',
    description: null,
    status: 'NotStarted',
    priority: 'Normal',
    createdByUserId: 'u-creator',
    assigneeUserId: 'u-ana',
    customerId: null,
    taxYear: null,
    dueAtUtc: null,
    dueTimeZoneId: null,
    dueIsStatutory: false,
    startedAtUtc: null,
    completedAtUtc: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
    parentTaskId: null,
    depth: 0,
    openSubtaskCount: 0,
    openBlockerCount: 0,
    isBlocked: false,
    estimatedHours: null,
    actualHours: 0,
    expectedItems: null,
    clientDueAtUtc: null,
    clientRequestedByUserId: null,
    clientRequestedAtUtc: null,
    ...overrides,
  };
}

describe('toTaskItem — avatar del asignado', () => {
  it('iniciales del nombre y color por userId con la paleta compartida', () => {
    const item = toTaskItem(response(), new Map(), new Map([['u-ana', 'Ana María López']])) as TaskItem;
    expect(item.assigneeInitials).toBe('AL');
    expect(item.assigneeColor).toBe(avatarColorFor('u-ana'));
  });
});

/** La fila del asignado lee la foto del directorio de staff compartido; sin foto, iniciales. */
describe('TaskListComponent — foto del asignado', () => {
  const staff = {
    avatarUrlFor: (id: string | null | undefined) => (id === 'u-ana' ? 'https://api.test/storage/avatars/f-ana' : null),
  };

  function render(tasks: TaskItem[]) {
    TestBed.configureTestingModule({
      imports: [TaskListComponent],
      providers: [{ provide: StaffDirectoryStore, useValue: staff }],
    });
    const fixture = TestBed.createComponent(TaskListComponent);
    fixture.componentInstance.tasks = tasks;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pinta la foto del asignado', () => {
    const item = toTaskItem(response(), new Map(), new Map([['u-ana', 'Ana López']])) as TaskItem;
    const el = render([item]);
    expect(el.querySelector('app-avatar img')?.getAttribute('src')).toBe('https://api.test/storage/avatars/f-ana');
  });

  it('sin foto quedan las iniciales', () => {
    const item = toTaskItem(response({ assigneeUserId: 'u-bob' }), new Map(), new Map([['u-bob', 'Bob Stone']])) as TaskItem;
    const el = render([item]);
    expect(el.querySelector('app-avatar img')).toBeNull();
    expect(el.querySelector('app-avatar')?.textContent).toContain('BS');
  });
});
