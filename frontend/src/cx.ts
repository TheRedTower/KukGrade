/** Class names joined into one, the empty and the false left out: cx("row", done && "row--done"). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
