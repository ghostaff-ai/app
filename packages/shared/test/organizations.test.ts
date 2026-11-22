import { describe, expect, it } from 'vitest';
import type { MyOrganization } from '../src/models';
import { sortSpaces } from '../src/services';

const space = (name: string, kind: MyOrganization['kind']): MyOrganization => ({
  id: name,
  slug: name.toLowerCase(),
  name,
  kind,
  role: 'owner',
  displayName: 'Jaime',
});

describe('your spaces, in the order the switcher shows them', () => {
  it('puts your personal space first, then the rest by name', () => {
    const sorted = sortSpaces([space('Órdago', 'company'), space('Personal', 'personal'), space('Factotum', 'company')]);
    expect(sorted.map((s) => s.name)).toEqual(['Personal', 'Factotum', 'Órdago']);
  });
});
