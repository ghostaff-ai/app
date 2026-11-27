import { describe, expect, it } from 'vitest';
import { keyRows, type OrgSecret } from '../src';
import { agentSecretName, cleanSecretValue, pendingSecretName, secretLabelFromName, secretNameFromLabel, secretValueProblem } from '../src/record';

const ORG = '10000000-0000-0000-0000-000000000001';

describe('the vault names of an organisation key', () => {
  it('keeps a member’s waiting value apart from the one runs read', () => {
    expect(agentSecretName(ORG, 'elevenlabs')).toBe(`org-${ORG}-secret-elevenlabs`);
    expect(pendingSecretName(ORG, 'elevenlabs')).toBe(`org-${ORG}-pending-elevenlabs`);
  });

  it('never lets one key’s waiting value land on another key’s live name', () => {
    // A key named «x-pending» must not be where «x» waits.
    expect(pendingSecretName(ORG, 'x')).not.toBe(agentSecretName(ORG, 'x-pending'));
  });
});

describe('a key’s value', () => {
  it('drops the one newline a paste or a pipe adds, and nothing else', () => {
    expect(cleanSecretValue('hunter2hunter2\n')).toBe('hunter2hunter2');
    expect(cleanSecretValue('hunter2hunter2\r\n')).toBe('hunter2hunter2');
    expect(cleanSecretValue('  con espacios  ')).toBe('  con espacios  ');
  });

  it('is refused when the runner could not hide it or a variable could not hold it', () => {
    expect(secretValueProblem('corta')).toBe('too_short');
    expect(secretValueProblem('x'.repeat(65537))).toBe('too_long');
    expect(secretValueProblem('abcdefgh\0')).toBe('nul');
    expect(secretValueProblem('una-clave-buena')).toBeNull();
  });
});

describe('a key’s name from what a person calls it', () => {
  it('is lower case, without accents, with hyphens', () => {
    expect(secretNameFromLabel('Contraseña de info@ordago.club')).toBe('contrasena-de-info-ordago-club');
    expect(secretNameFromLabel('  ElevenLabs  ')).toBe('elevenlabs');
    expect(secretNameFromLabel('Token de Meta (Instagram)')).toBe('token-de-meta-instagram');
  });

  it('starts with a letter and fits the vault', () => {
    expect(secretNameFromLabel('2FA del banco')).toBe('k-2fa-del-banco');
    expect(secretNameFromLabel('a'.repeat(100))).toHaveLength(63);
    expect(secretNameFromLabel('—')).toBe('');
  });

  it('reads back as a label when nobody gave one', () => {
    expect(secretLabelFromName('correo-info')).toBe('Correo info');
    expect(secretLabelFromName('elevenlabs')).toBe('Elevenlabs');
  });
});

const secret = (name: string, label: string, extra: Partial<OrgSecret> = {}): OrgSecret => ({
  id: `id-${name}`,
  orgId: ORG,
  name,
  label,
  maker: null,
  storedByName: 'Ana',
  storedAt: '2026-11-27T10:00:00Z',
  lastUsedAt: null,
  status: 'ok',
  pendingByName: null,
  pendingAt: null,
  ...extra,
});

describe('keyRows', () => {
  const agents: { id: string; name: string; secrets: Record<string, string> }[] = [
    { id: 'a1', name: 'Correo', secrets: { CORREO_GMAIL_PASSWORD: 'correo-gmail', CORREO_INFO_PASSWORD: 'correo-info' } },
    { id: 'a2', name: 'Finanzas', secrets: { GMAIL_PASSWORD: 'correo-gmail' } },
    { id: 'a3', name: 'Productor', secrets: { ELEVENLABS_API_KEY: 'elevenlabs' } },
    { id: 'a4', name: 'Legal', secrets: {} },
  ];

  it('lists each stored key with the agents that use it, by label', () => {
    const rows = keyRows([secret('elevenlabs', 'ElevenLabs'), secret('correo-gmail', 'Contraseña de Gmail')], agents);
    expect(rows.map((r) => [r.name, r.agents.map((a) => a.name)])).toEqual([
      ['correo-gmail', ['Correo', 'Finanzas']],
      ['elevenlabs', ['Productor']],
      ['correo-info', ['Correo']],
    ]);
  });

  it('adds, last, a key an agent names that nobody stored: it is missing', () => {
    const rows = keyRows([secret('elevenlabs', 'ElevenLabs')], agents);
    const missing = rows.filter((r) => r.secret === null).map((r) => r.name);
    expect(missing).toEqual(['correo-gmail', 'correo-info']);
  });

  it('keeps a stored key nobody uses, with no agents', () => {
    const rows = keyRows([secret('meta-token', 'Token de Meta')], []);
    expect(rows).toEqual([{ name: 'meta-token', secret: expect.objectContaining({ label: 'Token de Meta' }), agents: [] }]);
  });

  it('counts a member’s waiting first value as there, not missing', () => {
    const rows = keyRows([secret('elevenlabs', 'ElevenLabs', { storedByName: null, storedAt: null, pendingByName: 'Berto', pendingAt: '2026-11-27T11:00:00Z' })], agents);
    expect(rows.find((r) => r.name === 'elevenlabs')?.secret?.pendingByName).toBe('Berto');
  });
});
