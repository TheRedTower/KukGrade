import { Badge } from "./Badge";
import type { ManagedUser } from "./api";

/**
 * What an account made before names and ranks were required still lacks
 * ("Needs a name", "Needs a rank"), in the server's words, for an
 * administrator to fill in. Nothing when it lacks nothing.
 */
export function MissingDetails({ user }: { user: Pick<ManagedUser, "missing_details"> }) {
  if (user.missing_details.length === 0) return null;
  return (
    <span className="row row--inline row--wrap">
      {user.missing_details.map((detail) => (
        <Badge key={detail.value} tone="warning">
          {detail.label}
        </Badge>
      ))}
    </span>
  );
}
