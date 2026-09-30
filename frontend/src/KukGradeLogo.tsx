import logo from "./assets/kukgrade-logo.svg?raw";

/**
 * The logo, drawn inline rather than as an image so its black strokes take
 * the surrounding text colour: light on the ink rail, dark on a light page.
 * The markup is the repository's own asset, never user content.
 */
export function KukGradeLogo({ className }: { className: string }) {
  return (
    <span
      aria-label="KukGrade"
      className={`kukgrade-logo ${className}`}
      dangerouslySetInnerHTML={{ __html: logo }}
      role="img"
    />
  );
}
