import { describe, expect, it } from 'vitest';
import { repoDirs } from '../src/record/agents';

describe('repoDirs', () => {
  it('clones each repo into a folder named after it, and two of the same name apart', () => {
    expect([...repoDirs(['ordago-app/ordago-apps', 'ordago-app/ordago-reels'])]).toEqual([
      ['ordago-app/ordago-apps', 'ordago-apps'],
      ['ordago-app/ordago-reels', 'ordago-reels'],
    ]);
    expect([...repoDirs(['ordago-app/web', 'otro/Web'])]).toEqual([
      ['ordago-app/web', 'ordago-app-web'],
      ['otro/Web', 'otro-Web'],
    ]);
  });
});
