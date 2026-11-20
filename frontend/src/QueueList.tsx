import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Badge } from "./Badge";

export interface Queue {
  /** Where the queue's list is. */
  to: string;
  label: string;
  /** How many wait in it. */
  count?: number;
  /** Shown in place of the count, for a list of things rather than of queues. */
  badge?: ReactNode;
  /** One line on what it holds. */
  hint?: string;
}

/**
 * Queues of work, each a card that opens its own list, with how many wait in
 * it (see .queue-list in layout.css). A queue with nothing in it still shows,
 * so the whole of the work is in view.
 */
export function QueueList({ queues, label }: { queues: Queue[]; label: string }) {
  return (
    <ul aria-label={label} className="queue-list">
      {queues.map((queue) => (
        <li key={queue.to}>
          <Link className="queue-list__item" to={queue.to}>
            <span className="queue-list__text">
              <span className="item-title">{queue.label}</span>
              {queue.hint ? <span className="subtext">{queue.hint}</span> : null}
            </span>
            {queue.badge ??
              (queue.count !== undefined ? (
                <Badge tone={queue.count > 0 ? "info" : "neutral"}>{queue.count}</Badge>
              ) : null)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
