import { useState, type KeyboardEvent } from "react";

/**
 * One value of a row, typed into. The fix is saved when the field is left
 * (or Enter is pressed), and only if it changed; the server checks it. If
 * saving fails, what was typed stays to try again - the caller says why.
 */
export function ImportCellInput({
  value,
  label,
  invalid,
  changed,
  placeholder,
  disabled = false,
  onSave,
}: {
  value: string;
  label: string;
  invalid: boolean;
  changed: boolean;
  placeholder?: string;
  disabled?: boolean;
  onSave: (next: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (draft === null) return;
    if (draft === value) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setDraft(null);
    } catch {
      // Kept as typed; the caller shows the error.
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") setDraft(null);
  }

  return (
    <input
      aria-invalid={invalid}
      aria-label={label}
      className={`ix-cell-input${invalid ? " ix-cell-invalid" : changed ? " ix-cell-changed" : ""}`}
      disabled={disabled || saving}
      placeholder={placeholder}
      value={draft ?? value}
      onBlur={() => void commit()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
