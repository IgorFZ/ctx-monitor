import type { Register } from 'claude-code';

import { concluirTurnoAmbiente, faixaAmbiente, iniciarAmbiente, registerAmbiente } from './ambiente/register';
import { concluirTurnoLinks, faixaLinks, iniciarLinks, registerLinks } from './links';

// Um plugin carrega um único módulo de hooks, e cada evento sem matcher só pode ter um hook.
// Os eventos que os dois recursos usam ficam aqui; o resto mora no módulo de cada um.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    // Um recurso que falha ao iniciar não pode impedir o outro.
    const falhas = (await Promise.allSettled([iniciarLinks($), iniciarAmbiente($)])).filter(r => r.status === 'rejected');
    for (const falha of falhas) $.ui.log(`ctx-monitor: falha ao iniciar: ${String(falha.reason)}`, { to: 'debug' });
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    await concluirTurnoAmbiente($);
    const result = await next(e);
    await concluirTurnoLinks($);
    return result;
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e);
    return faixaLinks($, e, await faixaAmbiente($, e, beneath));
  });

  registerLinks(on);
  registerAmbiente(on, options);
};
