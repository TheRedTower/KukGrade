import { Meter } from "./Meter";

/**
 * How far through something a person is, in words and as a bar: "52 of 80
 * people sorted" (see .progress in layout.css). For a page's header, so
 * progress is always in view.
 */
export function Progress({ done, total, what }: { done: number; total: number; what: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <p className="progress">
      <span className="progress__count">
        {done} of {total} {what}
      </span>
      <Meter segments={[{ percent, tone: "success" }]} />
    </p>
  );
}
