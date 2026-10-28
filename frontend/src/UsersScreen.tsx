import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  createManagedUser,
  getManagedUsers,
  type ManagedUser,
  type UserRole,
} from "./api";
import { TemporaryPasswordIssued } from "./TemporaryPasswordIssued";
import { useDialogFocus } from "./useDialogFocus";
import "./UserManagement.css";
import { formatShortDateTime } from "./dates";

const PAGE_SIZE = 10;

function authoritySummary(user: ManagedUser): string {
  const authorities = [
    user.can_make_final_grading_decision ? "Final decisions" : null,
    user.can_promote_student ? "Promotions" : null,
    user.can_override_locked_session ? "Locked-session override" : null,
    user.can_view_grading_audit_log ? "Audit log" : null,
  ].filter(Boolean);
  return authorities.length ? authorities.join(" · ") : "None";
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: ManagedUser) => void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  // gcTime 0: the response carries the temporary password, which should
  // leave memory with this dialog rather than linger in the mutation cache.
  const mutation = useMutation({
    mutationFn: createManagedUser,
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["managedUsers"] }),
  });
  const issued = mutation.data;
  const close = issued ? () => onCreated(issued) : onClose;
  const dialogRef = useDialogFocus<HTMLElement>({
    isOpen: true,
    onClose: close,
    canClose: !mutation.isPending,
  });

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <div
      className="users-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // Not once the password is showing: a stray click must not lose it.
        if (event.target === event.currentTarget && !mutation.isPending && !issued) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="users-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-title"
      >
        <header>
          <div>
            <p>Administrator action</p>
            <h2 id="create-user-title">{issued ? "Staff user added" : "Add staff user"}</h2>
          </div>
          <button type="button" className="users-link-button" onClick={close} disabled={mutation.isPending}>
            Close
          </button>
        </header>
        {issued ? (
          <TemporaryPasswordIssued issued={issued} onDone={close} />
        ) : (
          <form
            className="users-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              mutation.mutate({
                email: String(form.get("email") ?? "").trim(),
                first_name: String(form.get("first_name") ?? "").trim(),
                last_name: String(form.get("last_name") ?? "").trim(),
                role: String(form.get("role") ?? "instructor") as UserRole,
                is_active: true,
              });
            }}
          >
            <div className="users-form-grid">
              <label>
                <span>First name</span>
                <input data-dialog-autofocus name="first_name" autoComplete="off" />
              </label>
              <label>
                <span>Last name</span>
                <input name="last_name" autoComplete="off" />
              </label>
              <label className="users-form-wide">
                <span>Email address</span>
                <input
                  required
                  type="email"
                  name="email"
                  autoComplete="off"
                  aria-invalid={(apiError?.messagesFor("email").length ?? 0) > 0}
                  aria-describedby={(apiError?.messagesFor("email").length ?? 0) > 0 ? "cud-email-error" : undefined}
                />
                {(apiError?.messagesFor("email").length ?? 0) > 0 && (
                  <span id="cud-email-error" role="alert">
                    {apiError?.messagesFor("email").map((message, index) => (
                      <small className="users-field-error" key={index}>{message}</small>
                    ))}
                  </span>
                )}
              </label>
              <label className="users-form-wide">
                <span>Role</span>
                <select name="role" defaultValue="instructor">
                  <option value="instructor">Instructor</option>
                  <option value="administrator">Administrator</option>
                </select>
              </label>
            </div>
            <p className="users-form-note">
              A temporary password is created for them. They'll choose their own when they first
              sign in.
            </p>
            {apiError && (
              <div className="users-error" role="alert">
                {apiError.message}
              </div>
            )}
            <div className="users-dialog-actions">
              <button type="button" className="users-secondary-button" onClick={onClose} disabled={mutation.isPending}>
                Cancel
              </button>
              <button type="submit" className="users-primary-button" disabled={mutation.isPending}>
                {mutation.isPending ? "Adding…" : "Add user"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function UsersScreen(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const search = searchParams.get("search") ?? "";
  const role = (searchParams.get("role") ?? "") as UserRole | "";
  const status = searchParams.get("status") ?? "";

  const updateFilters = (updates: Record<string, string>, preservePage = false) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (!preservePage) next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ["managedUsers", page, search, role, status],
    queryFn: () => getManagedUsers({
      page,
      page_size: PAGE_SIZE,
      search: search || undefined,
      role: role || undefined,
      is_active: status ? status === "active" : undefined,
    }),
  });

  const users = query.data?.results ?? [];
  const count = query.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const closeCreate = () => {
    setCreateOpen(false);
    addButtonRef.current?.focus();
  };

  return (
    <section className="page page--wide users-page" aria-labelledby="users-heading">
      <header className="users-page-header">
        <div>
          <div className="users-title-row">
            <h1 id="users-heading">Users</h1>
            <span>Admin only</span>
          </div>
          <p>Manage staff access and authority</p>
        </div>
        <button
          ref={addButtonRef}
          type="button"
          className="users-primary-button"
          onClick={() => setCreateOpen(true)}
        >
          Add user
        </button>
      </header>

      <form
        className="users-filters"
        aria-label="User filters"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ search: searchRef.current?.value.trim() ?? "" });
        }}
      >
        <label className="users-search">
          <span className="visually-hidden">Search users</span>
          <input
            key={search}
            ref={searchRef}
            type="search"
            aria-label="Search users"
            defaultValue={search}
            placeholder="Search name or email"
          />
          <button type="submit">Search</button>
        </label>
        <label>
          <span>Role</span>
          <select value={role} onChange={(event) => updateFilters({ role: event.target.value })}>
            <option value="">All roles</option>
            <option value="instructor">Instructor</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => updateFilters({ status: event.target.value })}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <strong>{count} user{count === 1 ? "" : "s"}</strong>
      </form>

      <div className="users-info-note">
        <span aria-hidden="true">i</span>
        Master authority is granted separately from a user's role.
      </div>

      <div className="users-ledger" aria-live="polite">
        {query.isLoading ? (
          <div className="users-state" role="status">Loading users…</div>
        ) : query.isError ? (
          <div className="users-state users-state-error" role="alert">
            <p>{query.error instanceof ApiError ? query.error.message : "Users could not be loaded."}</p>
            <button type="button" onClick={() => void query.refetch()}>Try again</button>
          </div>
        ) : users.length === 0 ? (
          <div className="users-state">
            <strong>No users found</strong>
            <span>Try changing the filters or add a staff user.</span>
          </div>
        ) : (
          <>
            <div className="users-table-scroll">
              <table className="users-table">
                <caption className="visually-hidden">Staff user accounts</caption>
                <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Master authority</th><th scope="col">Status</th><th scope="col">Last active</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td><strong title={user.full_name}>{user.full_name}</strong><span title={user.email}>{user.email}</span></td>
                      <td>{user.role_display}</td>
                      <td className="users-authority-summary" title={authoritySummary(user)}>{authoritySummary(user)}</td>
                      <td><span className={`users-status ${user.is_active ? "is-active" : "is-inactive"}`}>{user.is_active ? "Active" : "Inactive"}</span></td>
                      <td>{formatShortDateTime(user.last_login, "Never")}</td>
                      <td><button type="button" className="users-manage-button" onClick={() => navigate(`/users/${user.id}`)}>Manage user</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="users-pagination" aria-label="User pages">
              <button type="button" disabled={page <= 1} onClick={() => updateFilters({ page: String(page - 1) }, true)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => updateFilters({ page: String(page + 1) }, true)}>Next</button>
            </nav>
          </>
        )}
      </div>

      {createOpen && (
        <CreateUserDialog
          onClose={closeCreate}
          onCreated={(user) => {
            setCreateOpen(false);
            navigate(`/users/${user.id}`);
          }}
        />
      )}
    </section>
  );
}
