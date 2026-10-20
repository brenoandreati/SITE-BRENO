// Agenda Arvan no Cloudflare: /api/* passa por aqui; o resto são os arquivos do app.
import { tratarApi } from './api.mjs';
import { rodarAvisos } from './avisos.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return tratarApi(request, env);
    return env.ASSETS.fetch(request);
  },

  // A cada 5 minutos: manda os avisos que chegaram na hora
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(rodarAvisos(env, new Date(controller.scheduledTime)));
  }
};
