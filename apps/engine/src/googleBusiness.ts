// Google reviews (docs/plans/ongoing/connectors.md, phase 1): the Google
// Business Profile APIs, through our OAuth client with business.manage. Google
// gives a project these APIs only after an access request; until then every
// call answers 403 and the agent says so.
//
// Resource names are checked against their exact shape before they reach a URL,
// so a model cannot point a call anywhere else.

import { GOOGLE_SCOPES, google, str } from './google';
import { clip, type Tool, ToolError } from './tools';

const LOCATION = /^accounts\/\d+\/locations\/\d+$/;
const REVIEW = /^accounts\/\d+\/locations\/\d+\/reviews\/[A-Za-z0-9_-]+$/;
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function googleBusinessTools(): Tool[] {
  const base = { provider: 'googlebusiness' as const, scope: GOOGLE_SCOPES.business };
  return [
    {
      ...base,
      name: 'google_business_list_locations',
      description:
        'Lista las fichas de Google (negocios) que gestiona la cuenta conectada, con el identificador que piden las demás herramientas de reseñas.',
      input_schema: { type: 'object', properties: {} },
      writes: false,
      step: 'Buscando tus fichas de Google',
      async run(ctx) {
        const accounts = await google(ctx, 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
        const out: Array<{ location: string; title: unknown; address?: unknown }> = [];
        for (const a of ((accounts.accounts as Array<{ name: string }> | undefined) ?? []).slice(0, 10)) {
          const id = a.name.replace(/^accounts\//, '');
          if (!/^\d+$/.test(id)) continue;
          const locs = await google(
            ctx,
            `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${id}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
          );
          for (const l of (locs.locations as Array<{ name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }> | undefined) ?? []) {
            out.push({
              location: `accounts/${id}/${l.name}`,
              title: l.title,
              address: [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality].filter(Boolean).join(', ') || undefined,
            });
          }
        }
        return clip(JSON.stringify({ locations: out }));
      },
    },
    {
      ...base,
      name: 'google_business_list_reviews',
      description:
        'Lista las reseñas más recientes de una ficha de Google, con su puntuación, su texto y la respuesta si ya la tiene. `location` sale de google_business_list_locations.',
      input_schema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'La ficha: accounts/<número>/locations/<número>.' },
          onlyUnanswered: { type: 'boolean', description: 'Solo las que aún no tienen respuesta.' },
          max: { type: 'integer', minimum: 1, maximum: 50, description: 'Cuántas como mucho (20 por defecto).' },
        },
        required: ['location'],
      },
      writes: false,
      step: 'Leyendo tus reseñas de Google',
      async run(ctx, input) {
        const location = str(input.location, 200);
        if (!location || !LOCATION.test(location)) throw new ToolError('`location` debe ser como accounts/123/locations/456; búscala con google_business_list_locations.');
        const max = Math.min(50, Math.max(1, Math.trunc(Number(input.max ?? 20)) || 20));
        const data = await google(ctx, `https://mybusiness.googleapis.com/v4/${location}/reviews?pageSize=${max}&orderBy=updateTime%20desc`);
        type Review = {
          name: string;
          reviewer?: { displayName?: string };
          starRating?: string;
          comment?: string;
          createTime?: string;
          reviewReply?: { comment?: string };
        };
        let reviews = ((data.reviews as Review[] | undefined) ?? []).map((r) => ({
          review: r.name,
          author: r.reviewer?.displayName,
          stars: STARS[r.starRating ?? ''],
          text: r.comment,
          date: r.createTime,
          reply: r.reviewReply?.comment ?? null,
        }));
        if (input.onlyUnanswered === true) reviews = reviews.filter((r) => r.reply === null);
        return clip(JSON.stringify({ averageRating: data.averageRating, total: data.totalReviewCount, reviews }));
      },
    },
    {
      ...base,
      name: 'google_business_reply_review',
      description:
        'Publica (o cambia) la respuesta del negocio a una reseña de Google. Es pública: úsala solo cuando la persona haya aprobado ese texto.',
      input_schema: {
        type: 'object',
        properties: {
          review: { type: 'string', description: 'La reseña: accounts/<n>/locations/<n>/reviews/<id>, de google_business_list_reviews.' },
          reply: { type: 'string', description: 'El texto de la respuesta, tal como se publicará.' },
        },
        required: ['review', 'reply'],
      },
      writes: true,
      step: 'Contestando la reseña',
      action: 'Contestar en público a una reseña de Google',
      async run(ctx, input) {
        const review = str(input.review, 300);
        if (!review || !REVIEW.test(review)) throw new ToolError('`review` debe ser el identificador completo de la reseña, de google_business_list_reviews.');
        const reply = str(input.reply, 4096);
        if (!reply) throw new ToolError('Falta el texto de la respuesta.');
        await google(ctx, `https://mybusiness.googleapis.com/v4/${review}/reply`, { method: 'PUT', body: JSON.stringify({ comment: reply }) });
        return JSON.stringify({ replied: true, review });
      },
    },
  ];
}
