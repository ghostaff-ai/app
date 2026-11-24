import { describe, expect, it } from 'vitest';
import { isGuidePart } from '../src/chat';
import {
  agentEmail,
  fieldsFor,
  guidedProvider,
  normaliseBase,
  parseGuideStep,
  parseLanding,
} from '../src/guides';

const wordpress = {
  auth: 'basic',
  suffix: '/wp-json',
  check: { path: '/wp/v2/users/me?context=edit', expect: { field: 'roles', includes: 'editor' } },
};

describe('normaliseBase', () => {
  it('turns what people type into the https origin plus the suffix', () => {
    for (const input of [
      'miweb.com',
      'http://miweb.com'.replace('http', 'https'),
      'https://miweb.com/wp-admin/users.php',
      '  https://miweb.com  ',
    ]) {
      expect(normaliseBase(input, '/wp-json')).toEqual({ base: 'https://miweb.com/wp-json' });
    }
  });

  it('works without a suffix', () => {
    expect(normaliseBase('miweb.com')).toEqual({ base: 'https://miweb.com' });
  });

  it('refuses plain http, in Spanish: the person reads it', () => {
    expect(normaliseBase('http://miweb.com', '/wp-json')).toEqual({
      error: 'Tu web tiene que empezar por https',
    });
  });

  it('refuses what is not a web address', () => {
    expect(normaliseBase('', '/wp-json')).toHaveProperty('error');
    expect(normaliseBase('hola', '/wp-json')).toHaveProperty('error');
    expect(normaliseBase('ftp://miweb.com', '/wp-json')).toHaveProperty('error');
  });
});

describe('parseLanding', () => {
  it('accepts the WordPress landing', () => {
    expect(parseLanding(wordpress)).toEqual(wordpress);
  });

  it('header auth needs the header name; the others do not take one', () => {
    expect(parseLanding({ ...wordpress, auth: 'header' })).toHaveProperty('error');
    expect(parseLanding({ ...wordpress, auth: 'header', header: 'X-Api-Key' })).toMatchObject({
      auth: 'header',
      header: 'X-Api-Key',
    });
  });

  it('rejects an unknown auth, a check path outside the base and a bad suffix', () => {
    expect(parseLanding({ ...wordpress, auth: 'oauth' })).toHaveProperty('error');
    expect(parseLanding({ ...wordpress, check: { path: 'https://evil.com/x' } })).toHaveProperty('error');
    expect(parseLanding({ ...wordpress, suffix: 'wp-json' })).toHaveProperty('error');
    expect(parseLanding(null)).toHaveProperty('error');
  });
});

describe('fieldsFor', () => {
  it('lists what each auth may ask the person for', () => {
    expect(fieldsFor('basic')).toEqual(['base_url', 'username', 'password']);
    expect(fieldsFor('bearer')).toEqual(['base_url', 'token']);
    expect(fieldsFor('header')).toEqual(['base_url', 'key']);
  });

  it('a secret is allowed only for password with basic', () => {
    const secrets = ['password', 'token', 'key'] as const;
    for (const auth of ['basic', 'bearer', 'header'] as const) {
      for (const f of secrets) {
        expect(fieldsFor(auth).includes(f)).toBe(
          (auth === 'basic' && f === 'password') ||
            (auth === 'bearer' && f === 'token') ||
            (auth === 'header' && f === 'key'),
        );
      }
    }
    expect(fieldsFor('bearer')).not.toContain('password');
    expect(fieldsFor('basic')).not.toContain('token');
  });
});

describe('parseGuideStep', () => {
  const landing = parseLanding(wordpress) as Exclude<ReturnType<typeof parseLanding>, { error: string }>;

  it('accepts a valid WordPress step', () => {
    const raw = {
      blocks: [
        { type: 'title', text: 'Crea una contraseña de aplicación' },
        { type: 'bullets', items: ['Abre Usuarios', 'Pulsa en tu perfil'] },
        { type: 'field', field: 'username', label: 'Tu usuario' },
        { type: 'secret', field: 'password', label: 'La contraseña de aplicación' },
        { type: 'annotated_shot', mark: { x: 0.4, y: 0.2 }, caption: 'Aquí' },
        { type: 'copy_value', label: 'Correo del agente', value: 'ana@x.ghostaff.ai' },
        { type: 'confirm' },
        { type: 'check' },
      ],
      done: { undo: 'Borra la contraseña de aplicación en tu perfil' },
    };
    const r = parseGuideStep(raw, landing);
    expect(r).toHaveProperty('step');
    if ('step' in r) expect(r.step.blocks).toHaveLength(8);
    else expect(r.error).toBe('');
  });

  it('rejects a ninth block', () => {
    const blocks = Array.from({ length: 9 }, () => ({ type: 'confirm' }));
    expect(parseGuideStep({ blocks }, landing)).toHaveProperty('error');
  });

  it('rejects each limit with a readable error', () => {
    const bad = (blocks: unknown[], match: RegExp) => {
      const r = parseGuideStep({ blocks }, landing);
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toMatch(match);
    };
    bad([{ type: 'banner', text: 'x' }], /unknown block/i);
    bad([{ type: 'title', text: 'x'.repeat(61) }], /title/i);
    bad([{ type: 'bullets', items: ['a', 'b', 'c', 'd'] }], /bullets/i);
    bad([{ type: 'bullets', items: ['x'.repeat(91)] }], /bullets/i);
    bad([{ type: 'secret', field: 'token', label: 'Token' }], /secret/i);
    bad([{ type: 'secret', field: 'username', label: 'x' }], /secret/i);
    bad([{ type: 'field', field: 'password', label: 'x' }], /field/i);
    bad([{ type: 'field', field: 'token', label: 'x' }], /field/i);
    bad([{ type: 'annotated_shot', mark: { x: 1.2, y: 0.5 } }], /mark/i);
    bad([{ type: 'annotated_shot', mark: { x: 0.5, y: -0.1 } }], /mark/i);
    bad([{ type: 'use_connector', connector: 'nope' }], /connector/i);
    bad([], /blocks/i);
    expect(parseGuideStep('nope', landing)).toHaveProperty('error');
  });

  it('a field never asks for a secret: its label cannot name one', () => {
    const field = (label: string, f = 'username') => parseGuideStep({ blocks: [{ type: 'field', field: f, label }] }, landing);
    for (const label of [
      'Tu contraseña de WordPress',
      'CONTRASEÑA',
      'Tu contrasena',
      'Password',
      'La clave de tu web',
      'Tu token',
      'API key',
      'Tu PIN',
      'Código secreto',
      'Your secret',
    ]) {
      const r = field(label);
      expect(r, label).toHaveProperty('error');
      expect((r as { error: string }).error).toMatch(/secret block/);
    }
    expect(field('Nombre de usuario')).toHaveProperty('step');
    expect(field('Dirección de tu web', 'base_url')).toHaveProperty('step');
    expect(field('Tu usuario de la pintura')).toHaveProperty('step');
  });

  it('a choice image is one of the shipped drawings, never a URL', () => {
    const choice = (image: string) => ({
      blocks: [{ type: 'choice', question: '¿Qué ves?', options: [{ id: 'a', label: 'Menú', image }, { id: 'b', label: 'Otro' }] }],
    });
    expect(parseGuideStep(choice('sidebar-left'), landing)).toHaveProperty('step');
    for (const bad of ['https://evil.com/p.png', 'sidebar-right']) {
      const r = parseGuideStep(choice(bad), landing);
      expect((r as { error: string }).error).toMatch(/sidebar-left, menu-top, none/);
    }
  });

  it('accepts a connector from the catalogue', () => {
    expect(parseGuideStep({ blocks: [{ type: 'use_connector', connector: 'google' }] }, landing)).toHaveProperty('step');
  });
});

describe('guidedProvider', () => {
  it('is x plus the app name reduced to [a-z0-9]', () => {
    expect(guidedProvider('WordPress')).toBe('xwordpress');
    expect(guidedProvider('Mi Tienda Ñoña!')).toBe('xmitiendanona');
  });

  it('fits the database check at any length, even for a name with no letters', () => {
    const re = /^[a-z][a-z0-9]{1,30}$/;
    expect(guidedProvider('a'.repeat(80))).toHaveLength(31);
    for (const n of ['a'.repeat(80), '???', '', 'WordPress']) expect(guidedProvider(n)).toMatch(re);
  });
});

describe('agentEmail', () => {
  it('slugifies the name when the agent has no slug', () => {
    expect(agentEmail('panaderia-ana', { slug: null, name: 'Redes Sociales' })).toBe(
      'redes-sociales@panaderia-ana.ghostaff.ai',
    );
    expect(agentEmail('ana', { slug: null, name: 'Secretaría' })).toBe('secretaria@ana.ghostaff.ai');
    expect(agentEmail('ana', { slug: null, name: '  ¡Ventas & Co.! ' })).toBe('ventas-co@ana.ghostaff.ai');
  });

  it('treats an empty slug as none, and falls back when the name has no letters', () => {
    expect(agentEmail('ana', { slug: '', name: 'Redes' })).toBe('redes@ana.ghostaff.ai');
    expect(agentEmail('ana', { slug: null, name: '🙂' })).toBe('agente@ana.ghostaff.ai');
  });

  it('uses the slug when there is one', () => {
    expect(agentEmail('ana', { slug: 'ventas', name: 'Otro' })).toBe('ventas@ana.ghostaff.ai');
  });
});

describe('isGuidePart', () => {
  it('recognises a guide part by its type and guideId', () => {
    expect(isGuidePart({ type: 'guide', guideId: 'g1' })).toBe(true);
    expect(isGuidePart({ type: 'guide' })).toBe(false);
    expect(isGuidePart({ type: 'text', text: 'hi' })).toBe(false);
  });
});
