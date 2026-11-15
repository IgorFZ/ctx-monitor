import type { Register } from 'claude-code';

import { bandEnvironment, completeTurnEnvironment, registerEnvironment, startEnvironment } from './environment/register';
import { bandLinks, completeTurnLinks, registerLinks, startLinks } from './links';

// A plugin loads a single hooks module, and an event without a matcher can only have one hook.
// The events both features use live here; everything else lives in each feature's module.
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    // A feature that fails to start must not stop the other.
    const failures = (await Promise.allSettled([startLinks($), startEnvironment($)])).filter(r => r.status === 'rejected');
    for (const failure of failures) $.ui.log(`ctx-monitor: failed to start: ${String(failure.reason)}`, { to: 'debug' });
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    await completeTurnEnvironment($);
    const result = await next(e);
    await completeTurnLinks($);
    return result;
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e);
    return bandLinks($, e, await bandEnvironment($, e, beneath));
  });

  registerLinks(on);
  registerEnvironment(on, options);
};
