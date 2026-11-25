import { describe, expect, it } from 'vitest';
import { agentFromRow } from '../src/services';
import { AGENT_JOBS, MAIN_AGENT_JOB } from '../src/models';
import { agentJob, isMainAgent } from '../src/services/settings';

const ROW = {
  id: 'a1',
  org_id: 'o1',
  name: 'Secretaría',
  ghost: 'secretaria' as const,
  department: 'direccion' as const,
  member_default: 'talk' as const,
  runner: 'chat' as const,
  description: null,
  schedule: null,
  accounts: null,
  created_at: '2026-11-24T00:00:00Z',
};

describe('the main agent is a role, not a ghost', () => {
  it('isMainAgent is true only for isMain === true', () => {
    expect(isMainAgent({ isMain: true })).toBe(true);
    expect(isMainAgent({ isMain: false })).toBe(false);
    expect(isMainAgent({})).toBe(false);
    expect(isMainAgent({ isMain: null })).toBe(false);
  });

  it('agentJob gives the main agent its own line and every other agent its ghost’s', () => {
    expect(agentJob({ ghost: 'secretaria', isMain: true })).toBe(MAIN_AGENT_JOB);
    expect(agentJob({ ghost: 'secretaria', isMain: false })).toBe(AGENT_JOBS.secretaria.job);
    expect(agentJob({ ghost: 'finanzas' })).toBe(AGENT_JOBS.finanzas.job);
    expect(AGENT_JOBS.secretaria.job).not.toBe(MAIN_AGENT_JOB);
  });

  it('agentFromRow reads is_main, whatever the ghost', () => {
    expect(agentFromRow({ ...ROW, is_main: false }).isMain).toBe(false);
    expect(agentFromRow({ ...ROW, is_main: true }).isMain).toBe(true);
  });
});
