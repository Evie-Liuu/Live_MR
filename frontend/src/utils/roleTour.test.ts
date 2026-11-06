import { describe, expect, it } from 'vitest';
import { roleTourStep } from './roleTour.ts';

const roles = [{ slotId: 'cashier', label: 'Staff A' }, { slotId: 'customer', label: 'Customer A' }];

describe('roleTourStep', () => {
  it('starts by opening the role panel', () => {
    const s = roleTourStep({ panelOpen: false, unassigned: roles, studentCount: 2 });
    expect(s).toMatchObject({ id: 'open-panel', target: '[data-tour="role-card"]', progress: { index: 1, total: 2 } });
  });

  it('points at the first unassigned role once the panel is open', () => {
    const s = roleTourStep({ panelOpen: true, unassigned: roles, studentCount: 2 });
    expect(s.id).toBe('assign');
    expect(s.target).toBe('[data-tour="role-assign"][data-slot="cashier"] .custom-select-trigger');
    expect(s.title).toContain('Staff A');
    expect(s.body).toContain('還有 1 個角色');
  });

  it('moves on to the next role by itself', () => {
    const s = roleTourStep({ panelOpen: true, unassigned: roles.slice(1), studentCount: 2 });
    expect(s.target).toContain('data-slot="customer"');
    expect(s.body).not.toContain('還有');
  });

  it('goes back to step one if the panel is closed midway', () => {
    expect(roleTourStep({ panelOpen: false, unassigned: roles.slice(1), studentCount: 2 }).id).toBe('open-panel');
  });

  it('explains what to do when no students have joined', () => {
    expect(roleTourStep({ panelOpen: true, unassigned: roles, studentCount: 0 }).body).toContain('還沒有學生加入');
  });

  it('finishes when every role has someone', () => {
    const s = roleTourStep({ panelOpen: true, unassigned: [], studentCount: 2 });
    expect(s).toMatchObject({ id: 'done', target: null, progress: null });
  });
});
