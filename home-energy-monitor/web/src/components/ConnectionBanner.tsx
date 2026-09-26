import { formatRelativeTime } from "../lib/format.ts";
import type { ConnectionStatus } from "../lib/types.ts";

interface Props {
  status: ConnectionStatus | null | undefined;
  streaming: boolean;
}

/**
 * Says plainly when data has stopped flowing.
 *
 * A dashboard that silently freezes is worse than one that admits it, so
 * both halves of the path are reported: the app's link to Home Assistant,
 * and the browser's link to the app.
 */
export function ConnectionBanner({ status, streaming }: Props) {
  if (status && !status.connected) {
    return (
      <div className="banner warn" role="status">
        <span className="dot" />
        <span>
          Home Assistant connection lost. Retrying&hellip;
          {status.lastUpdate ? ` Last update ${formatRelativeTime(status.lastUpdate)}.` : ""}
        </span>
      </div>
    );
  }

  if (!streaming) {
    return (
      <div className="banner warn" role="status">
        <span className="dot" />
        <span>Reconnecting to live updates&hellip;</span>
      </div>
    );
  }

  return null;
}
