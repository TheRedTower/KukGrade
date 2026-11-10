import { BeltSwatch, RankBelt, type BeltRank } from "./Belt";
import { Badge } from "./Badge";
import { ArrowRightIcon } from "./Icons";

/** One end of a rank change: the rank (or its id, for records that carry only the id) and its name. */
export type RankEnd = { rank: BeltRank | number | null | undefined; name: string };

function Belt({ rank }: { rank: RankEnd["rank"] }) {
  return typeof rank === "number" ? <RankBelt rankId={rank} /> : <BeltSwatch rank={rank} />;
}

function End({ end, label, badge, strong }: { end: RankEnd; label?: string; badge: boolean; strong?: boolean }) {
  const inner = (
    <>
      <Belt rank={end.rank} />
      <span className={strong ? "item-title" : undefined}>
        {label ? `${label}: ` : null}
        {end.name}
      </span>
    </>
  );
  return badge ? <Badge tone="neutral">{inner}</Badge> : <span className="rank-transition__rank">{inner}</span>;
}

/**
 * From one rank to the next - held to tested for, or current to conferred - on one
 * line that wraps when it must (see .rank-transition in layout.css). The rank
 * arrived at reads a little stronger. With no `to`, the student is at the top.
 */
export function RankTransition({
  from,
  to,
  spoken = "next rank",
  fromLabel,
  toLabel,
  badges = false,
}: {
  from: RankEnd;
  to: RankEnd | null;
  /** What a screen reader hears between the two, for the arrow it cannot see. */
  spoken?: string;
  fromLabel?: string;
  toLabel?: string;
  /** Each rank as a badge, as a header does. */
  badges?: boolean;
}) {
  return (
    <span className="rank-transition">
      <End end={from} label={fromLabel} badge={badges} />
      <ArrowRightIcon className="rank-transition__arrow" size={15} />
      <span className="visually-hidden">, {spoken}: </span>
      {to ? (
        <End end={to} label={toLabel} badge={badges} strong />
      ) : (
        <span className="rank-transition__top meta">Highest rank</span>
      )}
    </span>
  );
}

/** A rank as one end of a change, or null when there is none (the top rank). */
// eslint-disable-next-line react-refresh/only-export-components
export function rankEnd(rank: BeltRank | null | undefined): RankEnd | null {
  return rank ? { rank, name: rank.name } : null;
}

type CandidateRankFields = {
  from_rank: number | null;
  from_rank_name: string;
  testing_for_rank: number | null;
  testing_for_rank_name: string;
};

/** A registration's change: the rank held when registered to the rank graded for. */
export function CandidateRanks({
  candidate,
  spoken = "grading for",
  ...options
}: { candidate: CandidateRankFields; spoken?: string; fromLabel?: string; toLabel?: string; badges?: boolean }) {
  return (
    <RankTransition
      from={{ rank: candidate.from_rank, name: candidate.from_rank_name }}
      to={{ rank: candidate.testing_for_rank, name: candidate.testing_for_rank_name }}
      spoken={spoken}
      {...options}
    />
  );
}
