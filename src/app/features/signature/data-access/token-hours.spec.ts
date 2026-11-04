import { TEST_EFFECTIVE_LIMITS } from '../testing/effective-limits.fixture';
import { tokenHoursForDueDate } from './signature.model';

/** Horas del enlace del firmante desde la fecha límite, siempre dentro de los límites vigentes. */
describe('tokenHoursForDueDate', () => {
  it('uses the office default when no date is picked', () => {
    expect(tokenHoursForDueDate(null, TEST_EFFECTIVE_LIMITS)).toBe(TEST_EFFECTIVE_LIMITS.defaultTokenHours);
  });

  it('never goes past the plan ceiling', () => {
    const limits = { ...TEST_EFFECTIVE_LIMITS, plan: { ...TEST_EFFECTIVE_LIMITS.plan, maxTokenHours: 48 } };
    const farAway = new Date(Date.now() + 30 * 86_400_000);
    const due = `${farAway.getFullYear()}-${`${farAway.getMonth() + 1}`.padStart(2, '0')}-${`${farAway.getDate()}`.padStart(2, '0')}`;

    expect(tokenHoursForDueDate(due, limits)).toBe(48);
  });
});
