import { useQuery } from "@tanstack/react-query";

import { type Rank, getRanks } from "./api";
import "./Belt.css";

type BeltRank = Pick<Rank, "name" | "belt_colour" | "stripe_colour">;

/** A rank's belt as the server describes it: belt colour, plus a stripe. */
export function BeltSwatch({ rank }: { rank: BeltRank | null | undefined }) {
  if (!rank) return null;
  const stripe = rank.stripe_colour;
  return (
    <span className={`belt belt-${rank.belt_colour.toLowerCase()}`} aria-hidden="true">
      {stripe ? <span className={`belt-stripe belt-${stripe.toLowerCase()}`} /> : null}
    </span>
  );
}

/** The belt for a rank id, for records that carry the id but not the rank. */
export function RankBelt({ rankId }: { rankId: number | null | undefined }) {
  const ranksQuery = useQuery({
    queryKey: ["ranks"],
    queryFn: () => getRanks({ page_size: 100 }),
  });
  const rank = ranksQuery.data?.results.find((candidate) => candidate.id === rankId);
  return <BeltSwatch rank={rank} />;
}
