import { BeltSwatch, type BeltRank } from "./Belt";

/** A belt and its name. */
function RankCell({ rank, fallback }: { rank: BeltRank | null | undefined; fallback: string }) {
  return (
    <div className="bgc-rank-cell">
      <BeltSwatch rank={rank} />
      <span className="bgc-rank-label">{rank?.name || fallback}</span>
    </div>
  );
}

/** From one rank to the next, on one line that wraps when it must. */
export function RankFlow({ from, to, fromFallback = "Unknown" }: {
  from: BeltRank | null | undefined;
  to: BeltRank | null | undefined;
  fromFallback?: string;
}) {
  return (
    <div className="bgc-rank-flow">
      <RankCell rank={from} fallback={fromFallback} />
      <span className="bgc-rank-arrow" aria-hidden="true">→</span>
      <span className="visually-hidden">, next rank: </span>
      {to ? <RankCell rank={to} fallback="—" /> : <span className="bgc-highest-rank">Highest rank</span>}
    </div>
  );
}
