import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  createManagedUser,
  getManagedUsers,
  type ManagedUser,
  type UserRole,
  errorMessage,
} from "./api";
import { TemporaryPasswordIssued } from "./TemporaryPasswordIssued";
import { Dialog } from "./Dialog";
import { Pagination } from "./Pagination";
import { ResponsiveTable } from "./ResponsiveTable";
import "./UserManagement.css";
import { formatShortDateTime } from "./dates";
import { Button } from "./Button";

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
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Dialog
      title={issued ? "Staff user added" : "Add staff user"}
      eyebrow="Administrator action"
      onClose={close}
      canClose={!mutation.isPending}
      closeOnBackdrop={!issued}
    >
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
              <label className="field">
                <span>First name</span>
                <input data-dialog-autofocus name="first_name" autoComplete="off" />
              </label>
              <label className="field">
                <span>Last name</span>
                <input name="last_name" autoComplete="off" />
              </label>
              <label className="field users-form-wide">
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
              <label className="field users-form-wide">
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
            <div className="action-row users-dialog-actions">
              <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={mutation.isPending}>
                {mutation.isPending ? "Adding…" : "Add user"}
              </Button>
            </div>
          </form>
        )}
    </Dialog>
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
    <section className="page page--wide" aria-labelledby="users-heading">
      <header className="action-row users-page-header">
        <div>
          <div className="users-title-row">
            <h1 id="users-heading">Users</h1>
            <span>Admin only</span>
          </div>
          <p>Manage staff access and authority</p>
        </div>
        <Button
          ref={addButtonRef}
          variant="primary"
          onClick={() => setCreateOpen(true)}
        >
          Add user
        </Button>
      </header>

      <form
        className="filter-bar users-filters"
        aria-label="User filters"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ search: searchRef.current?.value.trim() ?? "" });
        }}
      >
        <label className="field filter-bar__full">
          <span className="visually-hidden">Search users</span>
          <div className="field__row">
            <input
              key={search}
              ref={searchRef}
              type="search"
              aria-label="Search users"
              defaultValue={search}
              placeholder="Search name or email"
            />
            <button type="submit">Search</button>
          </div>
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(event) => updateFilters({ role: event.target.value })}>
            <option value="">All roles</option>
            <option value="instructor">Instructor</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => updateFilters({ status: event.target.value })}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <strong className="users-count">{count} user{count === 1 ? "" : "s"}</strong>
      </form>

      <div className="users-info-note">
        <span aria-hidden="true">i</span>
        Master authority is granted separately from a user's role.
      </div>

      <div className="users-ledger" aria-live="polite">
        {query.isLoading ? (
          <div className="card users-state" role="status">Loading users…</div>
        ) : query.isError ? (
          <div className="card users-state users-state-error" role="alert">
            <p>{errorMessage(query.error, "Users could not be loaded.")}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>Try again</Button>
          </div>
        ) : users.length === 0 ? (
          <div className="card users-state">
            <strong>No users found</strong>
            <span>Try changing the filters or add a staff user.</span>
          </div>
        ) : (
          <>
            <ResponsiveTable
              label="Staff user accounts"
              rows={users}
              rowKey={(user) => user.id}
              columns={[
                {
                  key: "user",
                  header: "User",
                  primary: true,
                  render: (user) => (
                    <>
                      <strong>{user.full_name}</strong>
                      <span className="users-email">{user.email}</span>
                    </>
                  ),
                },
                { key: "role", header: "Role", render: (user) => user.role_display },
                {
                  key: "authority",
                  header: "Master authority",
                  render: (user) => <span className="users-authority-summary">{authoritySummary(user)}</span>,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (user) => (
                    <span className={`users-status ${user.is_active ? "is-active" : "is-inactive"}`}>
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  ),
                },
                { key: "login", header: "Last active", render: (user) => formatShortDateTime(user.last_login, "Never") },
                {
                  key: "action",
                  header: "Action",
                  actions: "inline",
                  render: (user) => (
                    <Button variant="secondary" small onClick={() => navigate(`/users/${user.id}`)}>
                      Manage user
                    </Button>
                  ),
                },
              ]}
            />
            <Pagination
              label="User pages"
              page={page}
              totalPages={pages}
              onPage={(next) => updateFilters({ page: String(next) }, true)}
              summary={`Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, count)} of ${count} users`}
            />
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
