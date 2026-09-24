import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "./auth";
import {
  ApiError,
  deleteManagedUser,
  getAuditEvents,
  getManagedUser,
  resetManagedUserPassword,
  updateManagedUser,
  updateManagedUserAuthority,
  type ManagedUser,
  type UserAuthorityPayload,
  type UserRole,
} from "./api";
import { useDialogFocus } from "./useDialogFocus";
import "./UserManagement.css";

function formatDate(value: string | null, includeTime = false): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
  });
}

function AccountForm({
  user,
  isSelf,
  onSaved,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onSaved: (message: string) => void;
}): React.ReactElement {
  const [firstName, setFirstName] = useState(user.first_name ?? "");
  const [lastName, setLastName] = useState(user.last_name ?? "");
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<UserRole>(user.role ?? "instructor");
  const [isActive, setIsActive] = useState(user.is_active ?? true);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => updateManagedUser(user.id, {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      role,
      is_active: isActive,
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["managedUser", user.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["managedUsers"] });
      onSaved("Account details saved.");
    },
  });
  const error = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <form
      className="user-detail-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="users-form-grid">
        <label><span>First name</span><input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
        <label><span>Last name</span><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        <label className="users-form-wide">
          <span>Email address</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={(error?.messagesFor("email").length ?? 0) > 0}
            aria-describedby={(error?.messagesFor("email").length ?? 0) > 0 ? "account-email-error" : undefined}
          />
          {(error?.messagesFor("email").length ?? 0) > 0 && (
            <span id="account-email-error" role="alert">
              {error?.messagesFor("email").map((message, index) => (
                <small className="users-field-error" key={index}>{message}</small>
              ))}
            </span>
          )}
        </label>
        <label>
          <span>Role</span>
          <select value={role} disabled={isSelf} onChange={(event) => setRole(event.target.value as UserRole)}>
            <option value="instructor">Instructor</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        <label>
          <span>Account status</span>
          <select value={isActive ? "active" : "inactive"} disabled={isSelf} onChange={(event) => setIsActive(event.target.value === "active")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <p className="users-form-note">
        Roles control system access. Master authority is granted separately.
        {isSelf ? " You cannot change your own role or account status here." : ""}
      </p>
      {error && <div className="users-error" role="alert">{error.message}</div>}
      <button type="submit" className="users-primary-button" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save account details"}
      </button>
    </form>
  );
}

function AuthorityForm({
  user,
  isSelf,
  onSaved,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onSaved: (message: string) => void;
}): React.ReactElement {
  const [authority, setAuthority] = useState<UserAuthorityPayload>({
    can_make_final_grading_decision: user.can_make_final_grading_decision,
    can_promote_student: user.can_promote_student,
    can_override_locked_session: user.can_override_locked_session,
    can_view_grading_audit_log: user.can_view_grading_audit_log,
  });
  const queryClient = useQueryClient();
  const isAdministrator = user.role === "administrator";
  const mutation = useMutation({
    mutationFn: () => updateManagedUserAuthority(user.id, authority),
    onSuccess: (updated) => {
      queryClient.setQueryData(["managedUser", user.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["managedUsers"] });
      onSaved("Master authority saved.");
    },
  });
  const error = mutation.error instanceof ApiError ? mutation.error : null;

  const options: {
    key: keyof UserAuthorityPayload;
    label: string;
    description: string;
    disabled?: boolean;
  }[] = [
    {
      key: "can_make_final_grading_decision",
      label: "Make final grading decisions",
      description: "Allow this user to make final decisions on student gradings.",
      disabled: isAdministrator,
    },
    {
      key: "can_promote_student",
      label: "Promote students",
      description: "Allow this user to promote students to the next rank.",
    },
    {
      key: "can_override_locked_session",
      label: "Override locked sessions",
      description: "Allow this user to make authorised corrections after locking.",
    },
    {
      key: "can_view_grading_audit_log",
      label: "View grading audit log",
      description:
        "Allow this user to see grading, syllabus and assessment audit events (not user management).",
    },
  ];

  return (
    <form
      className="user-authority-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="user-authority-options">
        {options.map((option) => (
          <label key={option.key}>
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
            <input
              type="checkbox"
              checked={authority[option.key] ?? false}
              disabled={isSelf || option.disabled}
              onChange={(event) => setAuthority((current) => ({
                ...current,
                [option.key]: event.target.checked,
              }))}
            />
          </label>
        ))}
      </div>
      <div className="user-authority-footer">
        <p>
          {isSelf
            ? "You cannot change your own authority."
            : isAdministrator
              ? "Administrators cannot hold final-decision authority. Other authority changes are audited."
              : "Authority changes are recorded in the audit log."}
        </p>
        <button type="submit" className="users-primary-button" disabled={isSelf || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save authority"}
        </button>
      </div>
      {error && <div className="users-error" role="alert">{error.message}</div>}
    </form>
  );
}

function PasswordResetDialog({
  user,
  onClose,
  onSaved,
}: {
  user: ManagedUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.ReactElement {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [clientError, setClientError] = useState("");
  const mutation = useMutation({
    mutationFn: () => resetManagedUserPassword(user.id, password),
    onSuccess: () => {
      onSaved("Temporary password set. The user must change it at next sign-in.");
      onClose();
    },
  });
  const dialogRef = useDialogFocus<HTMLElement>({
    isOpen: true,
    onClose,
    canClose: !mutation.isPending,
  });

  const error = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <div className="users-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !mutation.isPending) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="users-dialog users-password-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
        <header>
          <div><p>Security action</p><h2 id="reset-password-title">Set a temporary password</h2></div>
          <button type="button" className="users-link-button" onClick={onClose} disabled={mutation.isPending}>Close</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault();
          setClientError("");
          if (password !== confirmation) {
            setClientError("The password confirmation does not match.");
            return;
          }
          mutation.mutate();
        }}>
          <p>Reset the password for <strong>{user.full_name}</strong>. The password itself is never written to the audit log.</p>
          <input
            className="visually-hidden"
            type="email"
            autoComplete="username"
            value={user.email}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <label>
            <span>Temporary password</span>
            <input
              data-dialog-autofocus
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={(error?.messagesFor("password").length ?? 0) > 0}
              aria-describedby={(error?.messagesFor("password").length ?? 0) > 0 ? "reset-password-error" : undefined}
            />
          </label>
          <label><span>Confirm password</span><input required type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          {(error?.messagesFor("password").length ?? 0) > 0 && (
            <span id="reset-password-error" role="alert">
              {error?.messagesFor("password").map((message, index) => (
                <small className="users-field-error" key={index}>{message}</small>
              ))}
            </span>
          )}
          {(clientError || error) && <div className="users-error" role="alert">{clientError || error?.message}</div>}
          <div className="users-dialog-actions">
            <button type="button" className="users-secondary-button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" className="users-primary-button" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Set password"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DeleteUserDialog({
  user,
  onClose,
}: {
  user: ManagedUser;
  onClose: () => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteManagedUser(user.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["managedUsers"] });
      navigate("/users");
    },
  });
  const error = mutation.error instanceof ApiError ? mutation.error : null;
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose: !mutation.isPending,
  });

  return (
    <div
      className="users-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !mutation.isPending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="users-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        tabIndex={-1}
      >
        <header>
          <div><p>Irreversible action</p><h2 id="delete-user-title">Delete this account</h2></div>
          <button
            type="button"
            className="users-link-button"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Close
          </button>
        </header>
        <p>
          Permanently delete <strong>{user.full_name}</strong>&apos;s account? This cannot be
          undone. Any grading history attributed to this account is kept and reassigned to a
          placeholder "Deleted User" account, not erased.
        </p>
        {error && <div className="users-error" role="alert">{error.message}</div>}
        <div className="users-dialog-actions">
          <button
            type="button"
            className="users-secondary-button"
            onClick={onClose}
            disabled={mutation.isPending}
            data-dialog-autofocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="users-danger-button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function UserDetailScreen(): React.ReactElement {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const passwordButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const query = useQuery({
    queryKey: ["managedUser", id],
    queryFn: () => getManagedUser(id),
    enabled: Boolean(id),
  });
  const activityQuery = useQuery({
    queryKey: ["userAuditEvents", id],
    queryFn: () => getAuditEvents({ entity_type: "User", entity_id: id, page_size: 4 }),
    enabled: Boolean(id),
  });

  if (query.isLoading) return <div className="users-state" role="status">Loading user…</div>;
  if (query.isError || !query.data) {
    return (
      <div className="users-state users-state-error" role="alert">
        <p>{query.error instanceof ApiError ? query.error.message : "This user could not be loaded."}</p>
        <button type="button" onClick={() => navigate("/users")}>Back to users</button>
      </div>
    );
  }

  const managedUser = query.data;
  const isSelf = managedUser.id === currentUser?.id;
  const formKey = [
    managedUser.id,
    managedUser.email,
    managedUser.first_name,
    managedUser.last_name,
    managedUser.role,
    managedUser.is_active,
    managedUser.can_make_final_grading_decision,
    managedUser.can_promote_student,
    managedUser.can_override_locked_session,
    managedUser.can_view_grading_audit_log,
  ].join(":");

  const closePassword = () => {
    setPasswordOpen(false);
    passwordButtonRef.current?.focus();
  };

  const closeDelete = () => {
    setDeleteOpen(false);
    deleteButtonRef.current?.focus();
  };

  return (
    <section className="user-detail-page" aria-labelledby="user-detail-heading">
      <Link className="users-back-link" to="/users">Users <span aria-hidden="true">/</span> {managedUser.full_name}</Link>
      <header className="user-detail-header">
        <div>
          <h1 id="user-detail-heading">{managedUser.full_name}</h1>
          <p>{managedUser.email} <span aria-hidden="true">·</span> <span className={`users-status ${managedUser.is_active ? "is-active" : "is-inactive"}`}>{managedUser.is_active ? "Active" : "Inactive"}</span></p>
        </div>
        <button ref={passwordButtonRef} type="button" className="users-secondary-button" onClick={() => setPasswordOpen(true)}>Set new password</button>
      </header>

      {notice && <div className="users-success" role="status">{notice}</div>}

      <div className="user-detail-layout">
        <main>
          <section className="user-detail-section">
            <h2>Account details</h2>
            <AccountForm key={`account-${formKey}`} user={managedUser} isSelf={isSelf} onSaved={setNotice} />
          </section>
          <section className="user-detail-section">
            <h2>Master authority</h2>
            <p>These permissions are independent of the user's role.</p>
            <AuthorityForm key={`authority-${formKey}`} user={managedUser} isSelf={isSelf} onSaved={setNotice} />
          </section>
          {!isSelf && (
            <section className="user-detail-section">
              <h2>Danger zone</h2>
              <p>
                Permanently delete this account. Grading history stays intact, reassigned to a
                placeholder account - use this for corruption or test-data cleanup, not routine
                offboarding (deactivate via account status instead).
              </p>
              <button
                ref={deleteButtonRef}
                type="button"
                className="users-danger-button"
                onClick={() => setDeleteOpen(true)}
              >
                Delete account
              </button>
            </section>
          )}
        </main>
        <aside className="user-detail-aside">
          <section>
            <h2>Account information</h2>
            <dl>
              <div><dt>Joined</dt><dd>{formatDate(managedUser.date_joined)}</dd></div>
              <div><dt>Last active</dt><dd>{formatDate(managedUser.last_login, true)}</dd></div>
              <div><dt>Role</dt><dd>{managedUser.role_display}</dd></div>
              <div><dt>Next sign-in</dt><dd>{managedUser.must_change_password ? "Password change required" : "Normal access"}</dd></div>
            </dl>
          </section>
          <section>
            <h2>Recent administrative activity</h2>
            {activityQuery.isLoading ? (
              <p role="status">Loading activity…</p>
            ) : activityQuery.data?.results.length ? (
              <ul className="user-activity-list">
                {activityQuery.data.results.map((event) => (
                  <li key={event.id}><strong>{event.action_display}</strong><span>{formatDate(event.occurred_at, true)}</span></li>
                ))}
              </ul>
            ) : (
              <p>No administrative activity recorded.</p>
            )}
            <Link className="users-audit-link" to={`/audit?search=${encodeURIComponent(id)}`}>View audit history <span aria-hidden="true">→</span></Link>
          </section>
        </aside>
      </div>

      {passwordOpen && <PasswordResetDialog user={managedUser} onClose={closePassword} onSaved={setNotice} />}
      {deleteOpen && <DeleteUserDialog user={managedUser} onClose={closeDelete} />}
    </section>
  );
}
