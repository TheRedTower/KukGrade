import { useEffect, useState } from "react";

import { formatTime } from "./dates";

/** The time now on the club's clock ("10:42"), kept current while shown. */
export function useClubClock(): string {
  const read = () => formatTime(new Date().toISOString());
  const [time, setTime] = useState(read);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(read()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}
