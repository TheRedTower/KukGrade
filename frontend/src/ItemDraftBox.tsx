import { useState } from "react";

import { Button } from "./Button";
import { mediaMatches } from "./useMediaQuery";

/**
 * A box to write something that is kept as written: a comment on an item, or
 * the reason a mark is changing.
 *
 * It is saved on purpose, never by leaving the box. On a computer that means
 * Enter (Shift+Enter starts a new line). On a phone or tablet the Enter key is
 * how a line break is typed, and a stray tap on it must not save a half-typed
 * thought, so there only the button saves. The draft stays, and the box stays
 * open, until the server has it: a refused or failed save (too long, no
 * connection) must not cost the text, and nothing can be typed while it is
 * being sent that the clearing would then discard.
 */
export function ItemDraftBox({
  ariaLabel,
  placeholder,
  saveLabel,
  inputTestId,
  saveTestId,
  cancelTestId,
  onSubmit,
  onClose,
}: {
  ariaLabel: string;
  placeholder: string;
  saveLabel: string;
  inputTestId: string;
  saveTestId: string;
  cancelTestId?: string;
  /** Saves the text; rejecting keeps the box open with the text in it. */
  onSubmit: (text: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await onSubmit(text);
      setDraft("");
      onClose();
    } catch {
      // The screen says why it failed; the draft is left to correct or retry.
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    setDraft("");
    onClose();
  };

  return (
    <div className="caw-row-note-edit">
      <textarea
        aria-label={ariaLabel}
        rows={2}
        className="caw-row-note-input"
        placeholder={placeholder}
        value={draft}
        readOnly={saving}
        enterKeyHint="enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (!saving) cancel();
          } else if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            !mediaMatches("(pointer: coarse)")
          ) {
            e.preventDefault();
            void submit();
          }
        }}
        data-testid={inputTestId}
        autoFocus
      />
      <div className="caw-row-note-actions">
        <Button variant="secondary" onClick={cancel} disabled={saving} data-testid={cancelTestId}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!draft.trim() || saving} data-testid={saveTestId}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
