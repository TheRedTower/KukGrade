import { Button } from "./Button";

interface PasswordToggleProps {
  shown: boolean;
  onToggle: () => void;
  /** What it shows or hides, for assistive technology: "password" or "passwords". */
  noun?: "password" | "passwords";
}

/** The Show / Hide button beside a password box (placed by .password-toggle in App.css). */
export function PasswordToggle({ shown, onToggle, noun = "password" }: PasswordToggleProps) {
  return (
    <Button
      aria-label={`${shown ? "Hide" : "Show"} ${noun}`}
      className="password-toggle"
      onClick={onToggle}
      small
      variant="link"
    >
      {shown ? "Hide" : "Show"}
    </Button>
  );
}
