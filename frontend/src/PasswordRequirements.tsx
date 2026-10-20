import { CheckIcon } from "./Icons";
import { useSiteSettingsQuery } from "./queries";

/**
 * The server's password policy, ticked off as a new password is typed.
 *
 * Every rule comes from `/api/site/` (accounts/password_policy.py on the
 * server), so this keeps no copy of its own: the length bounds as numbers,
 * each character rule as a pattern to test, and the rules only the server
 * can check listed as checked on save. It is a guide, not the check - the
 * server's answer when the password is submitted is what counts.
 */
export function PasswordRequirements({ password }: { password: string }) {
  const policy = useSiteSettingsQuery().data?.password_policy;
  if (!policy) return null;

  // Characters as the server counts them: code points, not UTF-16 units.
  const length = [...password].length;
  const rules = [
    {
      key: "length",
      label: `${policy.min_length} to ${policy.max_length} characters`,
      met: length >= policy.min_length && length <= policy.max_length,
    },
    ...policy.character_rules.map((rule) => ({
      key: rule.code,
      label: rule.label,
      met: new RegExp(rule.pattern).test(password),
    })),
  ];

  return (
    <div className="password-requirements">
      <ul aria-label="Password requirements">
        {rules.map((rule) => (
          <li className={rule.met ? "is-met" : undefined} key={rule.key}>
            <span aria-hidden="true" className="password-requirement-mark">
              {rule.met ? <CheckIcon size={13} /> : null}
            </span>
            {rule.label}
            <span className="visually-hidden">{rule.met ? " (done)" : " (not yet)"}</span>
          </li>
        ))}
      </ul>
      {policy.checked_on_save.length > 0 ? (
        <p className="password-requirements-on-save">
          Checked when you save: {policy.checked_on_save.join("; ").toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}
