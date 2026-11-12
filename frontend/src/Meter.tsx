import { cx } from "./cx";

type MeterTone = "success" | "danger";

interface MeterProps {
  /** The parts of the bar, in order, each a share of the whole in percent. */
  segments: { percent: number; tone: MeterTone }[];
  className?: string;
}

/**
 * A thin bar showing how much of something is done (see .meter in controls.css).
 * Hidden from assistive technology: put the same figure in text beside it.
 */
export function Meter({ segments, className }: MeterProps) {
  return (
    <span aria-hidden="true" className={cx("meter", className)}>
      {segments.map((segment) => (
        <span
          className={`meter__fill meter__fill--${segment.tone}`}
          key={segment.tone}
          style={{ width: `${segment.percent}%` }}
        />
      ))}
    </span>
  );
}
