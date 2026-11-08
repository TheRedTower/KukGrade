/**
 * Stylelint checks what tokenRules.test.ts and layoutRules.test.ts cannot:
 * that the CSS itself is valid (no unknown property, unit or value, no rule
 * written twice) and a few rules that hold everywhere with no exception.
 * Those tests keep the counted, shrinking checks (raw colours, spacing,
 * type outside the shared roles); this file holds only what is already at
 * zero, so a new breach fails at once.
 *
 * Only Stylelint's built-in rules: no shared config, so nothing here changes
 * when a preset does.
 */
export default {
  ignoreFiles: ["dist/**", "coverage/**", "playwright-report/**", "test-results/**"],
  rules: {
    // Valid CSS.
    "annotation-no-unknown": true,
    "at-rule-no-unknown": true,
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-block-no-duplicate-custom-properties": true,
    // A fallback line before a newer value (round(), say) is deliberate.
    "declaration-block-no-duplicate-properties": [
      true,
      { ignore: ["consecutive-duplicates-with-different-syntaxes"] },
    ],
    "declaration-block-no-shorthand-property-overrides": true,
    "declaration-property-value-no-unknown": true,
    "function-calc-no-unspaced-operator": true,
    "function-no-unknown": true,
    "keyframe-declaration-no-important": true,
    "media-feature-name-no-unknown": true,
    "no-duplicate-at-import-rules": true,
    "no-duplicate-selectors": true,
    "no-invalid-double-slash-comments": true,
    "no-invalid-position-at-import-rule": true,
    "property-no-unknown": true,
    "selector-pseudo-class-no-unknown": true,
    "selector-pseudo-element-no-unknown": true,
    "selector-type-no-unknown": [true, { ignore: ["custom-elements"] }],
    "string-no-newline": true,
    "unit-no-unknown": true,

    // Rules with no exception.
    // A colour is a token (theme.css), never a name.
    "color-named": "never",
    // A screen styles classes; an id is for a label or a link target.
    "selector-max-id": 0,
    "declaration-no-important": true,
    // Splitting a word between any two letters hides overflow instead of
    // fixing it: a long word wraps whole, or the layout gives it room.
    "declaration-property-value-disallowed-list": {
      "overflow-wrap": ["anywhere"],
      "word-break": ["break-all", "break-word"],
      "word-wrap": ["anywhere"],
    },
  },
};
