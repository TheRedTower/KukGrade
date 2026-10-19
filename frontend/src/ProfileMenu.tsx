import { useEffect, useRef, useState, type ReactNode } from "react";

import { type AuthUser, errorMessage } from "./api";
import { ChangePasswordForm } from "./ChangePasswordForm";

function CheckCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="capability-icon granted"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

function MinusCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="capability-icon not-granted"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      aria-hidden="true"
      className="action-icon"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

function ChevronDownIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`chevron-icon ${isOpen ? "open" : ""}`}
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const CAPABILITIES = [
  {
    key: "can_make_final_grading_decision",
    label: "Final grading decisions",
  },
  {
    key: "can_promote_student",
    label: "Promote students",
  },
  {
    key: "can_override_locked_session",
    label: "Override locked sessions",
  },
  {
    key: "can_view_grading_audit_log",
    label: "View grading audit log",
  },
] as const;

function getInitials(user: AuthUser): string {
  if (user.first_name && user.last_name) {
    return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
  }
  const parts = user.full_name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (user.full_name[0] || user.email[0] || "U").toUpperCase();
}

export interface ProfileMenuProps {
  user: AuthUser;
  onLogout: () => void;
  onUpdateName: (firstName: string, lastName: string) => Promise<void>;
  isLoggingOut?: boolean;
  themeToggle?: ReactNode;
}

/** Your own first and last name, edited in place in the account menu. */
function NameForm({
  user,
  onUpdateName,
  onDone,
}: {
  user: AuthUser;
  onUpdateName: (firstName: string, lastName: string) => Promise<void>;
  onDone: () => void;
}) {
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="profile-name-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);
        setError(null);
        try {
          await onUpdateName(firstName.trim(), lastName.trim());
          onDone();
        } catch (err) {
          setError(errorMessage(err, "Could not save your name."));
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <label>
        <span>First name</span>
        <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
      </label>
      <label>
        <span>Last name</span>
        <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="profile-name-actions">
        <button className="profile-name-button" disabled={isSaving} onClick={onDone} type="button">
          Cancel
        </button>
        <button className="profile-name-button primary" disabled={isSaving} type="submit">
          {isSaving ? "Saving…" : "Save name"}
        </button>
      </div>
    </form>
  );
}

export function ProfileMenu({
  user,
  onLogout,
  onUpdateName,
  isLoggingOut = false,
  themeToggle,
}: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const initials = getInitials(user);

  function closeForms() {
    setIsEditingName(false);
    setIsChangingPassword(false);
    setPasswordChanged(false);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        closeForms();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        closeForms();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="profile-menu-container" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${user.full_name}, ${user.role_display}`}
        className="profile-trigger"
        onClick={() => {
          setIsOpen((previous) => !previous);
          closeForms();
        }}
        type="button"
      >
        <div className="profile-trigger-info">
          <span className="profile-trigger-name">
            {user.full_name}
            <ChevronDownIcon isOpen={isOpen} />
          </span>
          <span className="profile-trigger-role">{user.role_display}</span>
        </div>
        <div aria-hidden="true" className="avatar-circle">
          {initials}
        </div>
      </button>

      {isOpen ? (
        <div
          aria-label="User account menu"
          className="profile-dropdown"
        >
          <div className="profile-dropdown-header">
            <div aria-hidden="true" className="avatar-circle large">
              {initials}
            </div>
            <div className="profile-dropdown-user">
              <p className="profile-dropdown-name">{user.full_name}</p>
              <p className="profile-dropdown-email">{user.email}</p>
              <span className="profile-dropdown-role">{user.role_display}</span>
            </div>
          </div>

          <div className="profile-dropdown-section">
            {isEditingName ? (
              <NameForm
                onDone={() => setIsEditingName(false)}
                onUpdateName={onUpdateName}
                user={user}
              />
            ) : (
              <button
                className="profile-name-button"
                onClick={() => setIsEditingName(true)}
                type="button"
              >
                Edit your name
              </button>
            )}
          </div>

          {/* Your own password, behind your current one. An administrator's
              "Set new password" is for other people's accounts only. */}
          <div className="profile-dropdown-section">
            {isChangingPassword ? (
              <ChangePasswordForm
                actionsClassName="profile-name-actions profile-password-actions"
                className="profile-name-form"
                currentPasswordLabel="Current password"
                onChanged={() => {
                  setIsChangingPassword(false);
                  setPasswordChanged(true);
                }}
                secondaryAction={(isSubmitting) => (
                  <button
                    className="profile-name-button"
                    disabled={isSubmitting}
                    onClick={() => setIsChangingPassword(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                )}
                submitClassName="profile-name-button primary"
                submitLabel="Change password"
                submittingLabel="Changing…"
              />
            ) : (
              <>
                {passwordChanged ? (
                  <p className="profile-password-changed" role="status">
                    Your password has been changed.
                  </p>
                ) : null}
                <button
                  className="profile-name-button"
                  onClick={() => {
                    setPasswordChanged(false);
                    setIsChangingPassword(true);
                  }}
                  type="button"
                >
                  Change password
                </button>
              </>
            )}
          </div>

          <div className="profile-dropdown-section">
            <p className="profile-dropdown-section-title">Master capabilities</p>
            <ul className="capabilities-list">
              {CAPABILITIES.map((cap) => {
                const isGranted = Boolean(user[cap.key]);
                return (
                  <li className="capability-item" key={cap.key}>
                    <div className="capability-item-info">
                      {isGranted ? <CheckCircleIcon /> : <MinusCircleIcon />}
                      <span>{cap.label}</span>
                    </div>
                    <span
                      className={`capability-badge ${isGranted ? "granted" : "not-granted"}`}
                    >
                      {isGranted ? "Granted" : "Not granted"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="capabilities-note">
              Capabilities are independent of your role.
            </p>
          </div>

          {themeToggle ? (
            <div className="profile-dropdown-section">
              <div className="profile-appearance-row">
                <span className="appearance-label">Appearance</span>
                {themeToggle}
              </div>
            </div>
          ) : null}

          <div className="profile-dropdown-footer">
            <button
              className="profile-sign-out-button"
              disabled={isLoggingOut}
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              type="button"
            >
              <LogoutIcon />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
