import { useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";

/**
 * The search box of a list: its magnifier, its label (visually hidden when
 * the placeholder says enough), and type-to-search - the list follows as
 * you type, so there is no Search button. What is typed is handed on once
 * typing pauses, so a list kept in the address is rewritten once per
 * search, not once per keystroke; a value changed from outside (filters
 * cleared, Back) replaces what is in the box.
 */
export function SearchField({
  label,
  hideLabel = false,
  placeholder,
  value,
  onChange,
  className,
  id,
}: {
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}) {
  const [text, setText] = useState(value);
  // The value last given, so one changed from outside (filters cleared,
  // Back) replaces what is in the box.
  const [given, setGiven] = useState(value);
  if (value !== given) {
    setGiven(value);
    setText(value);
  }
  const settled = useDebouncedValue(text);
  // What was last handed on: each pause hands its words on once, however
  // often the list renders while the address catches up.
  const handed = useRef(value);
  useEffect(() => {
    handed.current = value;
  }, [value]);
  useEffect(() => {
    // Only once the pause has caught up with the box: a value just given
    // from outside is not overwritten by what was typed before it.
    if (settled === text && settled !== value && settled !== handed.current) {
      handed.current = settled;
      onChange(settled);
    }
  }, [settled, text, value, onChange]);

  return (
    <label className={`field field--search${className ? ` ${className}` : ""}`}>
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
      <input id={id} placeholder={placeholder} type="search" value={text} onChange={(event) => setText(event.target.value)} />
    </label>
  );
}
