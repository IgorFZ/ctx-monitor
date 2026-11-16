/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from 'solid-js';
import type { TuiPlugin, TuiPluginModule } from '@opencode-ai/plugin/tui';
import {
  extractUrlsFromParts,
  formatUsageBar,
  readAiMemorySummary,
  readMachineStats,
  summarizeSessionUsage,
} from './telemetry.mjs';

const tui: TuiPlugin = async (api) => {
  const [tick, setTick] = createSignal(0);
  const timer = setInterval(() => setTick((n) => n + 1), 5000);
  onCleanup(() => clearInterval(timer));
  api.lifecycle.onDispose(() => clearInterval(timer));

  const currentSessionId = () =>
    api.route.current.name === 'session' ? (api.route.current.params?.sessionID as string | undefined) : undefined;

  const getSnapshot = () => {
    tick();
    const sessionId = currentSessionId();
    const messages = sessionId ? api.state.session.messages(sessionId) : [];
    const usage = summarizeSessionUsage(messages as any, api.state.provider as any);
    const aimem = readAiMemorySummary(sessionId ?? 'opencode');
    const machine = readMachineStats();
    const diffs = sessionId ? api.state.session.diff(sessionId) : [];
    const parts = messages.flatMap((m) => api.state.part(m.id) as any[]);
    const urls = extractUrlsFromParts(parts);
    return { sessionId, usage, aimem, machine, diffs, urls };
  };

  api.slots.register({
    order: 200,
    slots: {
      app_bottom(ctx) {
        const snap = getSnapshot();
        const theme = ctx.theme.current;
        const pct = snap.usage.percentage;
        const barColor = pct == null ? theme.textMuted : pct >= 85 ? theme.error : pct >= 60 ? theme.warning : theme.success;
        const branch = api.state.vcs?.branch;
        return (
          <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1}>
            <text fg={theme.info}>{snap.usage.model}</text>
            <text fg={barColor}>{formatUsageBar(pct)}</text>
            {snap.aimem && (
              <text fg={snap.aimem.online ? theme.success : theme.warning}>
                {snap.aimem.online
                  ? `ai-memory ${snap.aimem.pages}p${snap.aimem.queue ? ` · q${snap.aimem.queue}` : ''}`
                  : `ai-memory offline${snap.aimem.queue ? ` · q${snap.aimem.queue}` : ''}`}
              </text>
            )}
            {branch && <text fg={theme.textMuted}>{branch}</text>}
          </box>
        );
      },

      sidebar_content(ctx) {
        const snap = getSnapshot();
        const theme = ctx.theme.current;
        return (
          <box flexDirection="column" paddingTop={1} paddingBottom={1}>
            <text fg={theme.primary}>ctx-monitor</text>
            <text fg={theme.text}>
              {`ctx: ${formatUsageBar(snap.usage.percentage)}`}
            </text>
            <text fg={theme.textMuted}>
              {`cpu load ${snap.machine.cpuLoad}/${snap.machine.cpus} · ram ${snap.machine.memUsedPct}%`}
            </text>
            <text fg={theme.textMuted}>
              {`links: ${snap.urls.length} · files: ${snap.diffs.length}`}
            </text>
            {snap.aimem && (
              <text fg={snap.aimem.online ? theme.success : theme.warning}>
                {snap.aimem.online ? `ai-memory: ${snap.aimem.pages} pages` : 'ai-memory: offline'}
              </text>
            )}
          </box>
        );
      },
    },
  });

  api.command?.register(() => [
    {
      title: 'ctx-monitor: Session Links',
      value: 'ctx-monitor.links',
      description: 'Show URLs captured in the current session',
      slash: { name: 'ctx-links' },
      onSelect: (dialog) => {
        const snap = getSnapshot();
        if (!dialog) return;
        if (!snap.urls.length) {
          api.ui.toast({ variant: 'info', message: 'No URLs found in this session yet.' });
          return;
        }
        dialog.replace(() => (
          <api.ui.DialogSelect
            title={`Session Links (${snap.urls.length})`}
            options={snap.urls.map((url) => ({ title: url, value: url }))}
          />
        ));
      },
    },
    {
      title: 'ctx-monitor: Environment',
      value: 'ctx-monitor.env',
      description: 'Show machine, workspace, and ai-memory telemetry',
      slash: { name: 'ctx-env' },
      onSelect: (dialog) => {
        const snap = getSnapshot();
        if (!dialog) return;
        const lines = [
          `Workspace: ${api.state.path.worktree || api.state.path.directory}`,
          `Branch: ${api.state.vcs?.branch ?? 'n/a'}`,
          `CPU Load: ${snap.machine.cpuLoad} (${snap.machine.cpus} cores)`,
          `RAM: ${snap.machine.memUsedPct}% (${snap.machine.memUsedLabel})`,
          `ai-memory: ${snap.aimem ? (snap.aimem.online ? `${snap.aimem.pages} pages` : 'offline') : 'not installed'}`,
        ];
        dialog.replace(() => <api.ui.DialogAlert title="ctx-monitor Environment" message={lines.join('\n')} />);
      },
    },
  ]);
};

const plugin: TuiPluginModule = {
  id: 'ctx-monitor',
  tui,
};

export default plugin;
