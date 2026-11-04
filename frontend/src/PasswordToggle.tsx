interface PasswordToggleProps {
  shown: boolean;
  onToggle: () => void;
  /** What it shows or hides, for assistive technology: "password" or "passwords". */
  noun?: "password" | "passwords";
}

/** The Show / Hide button beside a password box (see .password-toggle in App.css). */
export function PasswordToggle({ shown, onToggle, noun = "password" }: PasswordToggleProps) {
  return (
    <button aria-label={`${shown ? "Hide" : "Show"} ${noun}`} className="password-toggle" onClick={onToggle} type="button">
      {shown ? "Hide" : "Show"}
    </button>
  );
}
