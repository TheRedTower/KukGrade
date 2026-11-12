import { useChoices } from "./choices";
import { useRef, useState } from "react";
import { ACCOUNT_FIELDS, splitServerErrors } from "./forms";
import { PageHeader } from "./PageHeader";
import { Badge } from "./Badge";
import { InfoIcon, UserPlusIcon } from "./Icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { type Choices, createManagedUser, getManagedUsers, type ManagedUser, type UserRole, errorMessage } from "./api";
import { EmptyState } from "./EmptyState";
import { Alert } from "./Alert";
import { Field } from "./Field";
import { LoadingState } from "./LoadingState";
import { TemporaryPasswordIssued } from "./TemporaryPasswordIssued";
import { Dialog } from "./Dialog";
import { Pagination } from "./Pagination";
import { ResponsiveTable } from "./ResponsiveTable";
import "./UserManagement.css";
import { formatShortDateTime } from "./dates";
import { Button } from "./Button";
import { EmailAddress } from "./EmailAddress";
import { keys } from "./queryKeys";
import { SearchField } from "./SearchField";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { counted } from "./plural";
import { MissingDetails } from "./MissingDetails";

const PAGE_SIZE = 10;

function authoritySummary(user: ManagedUser, authorities: Choices["authorities"]): string {
  const held = authorities.filter((authority) => user[authority.value]).map((authority) => authority.label);
  return held.length ? held.join(" · ") : "None";
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: ManagedUser) => void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const { roles, staff_ranks: ranks } = useChoices();
  // Only an instructor's account holds a rank; an administrator's has none.
  const [role, setRole] = useState<UserRole>("instructor");
  // gcTime 0: the response carries the temporary password, which should
  // leave memory with this dialog rather than linger in the mutation cache.
  const mutation = useMutation({
    mutationFn: createManagedUser,
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.managedUsers.all() }),
  });
  const issued = mutation.data;
  const close = issued ? () => onCreated(issued) : onClose;
  // Each field's error has its place beside its box; anything else the server says goes above the buttons.
  const errors = mutation.error
    ? splitServerErrors(mutation.error, ACCOUNT_FIELDS, "The user could not be added.")
    : null;
  const emailError = errors?.fields.email?.join(" ");
  const rankError = errors?.fields.rank?.join(" ");

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
          className="stack stack--4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            mutation.mutate({
              email: String(form.get("email") ?? "").trim(),
              first_name: String(form.get("first_name") ?? "").trim(),
              last_name: String(form.get("last_name") ?? "").trim(),
              role,
              ...(role === "instructor" ? { rank: Number(form.get("rank")) } : {}),
              is_active: true,
            });
          }}
        >
          <div className="users-form-grid">
            <Field error={errors?.fields.first_name?.join(" ")} label="First name" look="label">
              {(control) => <input {...control} required data-dialog-autofocus name="first_name" autoComplete="off" />}
            </Field>
            <Field error={errors?.fields.last_name?.join(" ")} label="Last name" look="label">
              {(control) => <input {...control} required name="last_name" autoComplete="off" />}
            </Field>
            <Field className="users-form-wide" error={emailError} label="Email address" look="label">
              {(control) => <input {...control} required type="email" name="email" autoComplete="off" />}
            </Field>
            <Field className="users-form-wide" label="Role" look="label">
              {(control) => (
                <select
                  {...control}
                  name="role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as UserRole)}
                >
                  {roles.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {role === "instructor" && (
              <Field className="users-form-wide" error={rankError} label="Rank" look="label">
                {(control) => (
                  <select {...control} required name="rank" defaultValue="">
                    <option value="" disabled>
                      Choose their rank
                    </option>
                    {ranks.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
          <p className="users-form-note meta">
            A temporary password is created for them. They'll choose their own when they first sign in.
          </p>
          {errors?.banner && <Alert>{errors.banner}</Alert>}
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
  const filters = useUrlFilters();
  const [createOpen, setCreateOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const page = filters.page;
  const search = filters.value("search");
  const searched = search.trim();
  const role = filters.value("role") as UserRole | "";
  const status = filters.value("status");
  const { roles, authorities } = useChoices();

  const paged = usePagedQuery({
    queryKey: keys.managedUsers.page(page, searched, role, status),
    queryFn: () =>
      getManagedUsers({
        page,
        page_size: PAGE_SIZE,
        search: searched || undefined,
        role: role || undefined,
        is_active: status ? status === "active" : undefined,
      }),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
  });
  const query = paged.query;
  const users = paged.results;
  const count = paged.count;

  const closeCreate = () => {
    setCreateOpen(false);
    addButtonRef.current?.focus();
  };

  return (
    <section className="page" aria-labelledby="users-heading">
      <PageHeader
        title="Users"
        titleId="users-heading"
        subtitle="Manage staff access and authority"
        tag={<Badge tone="neutral">Admin only</Badge>}
        actions={
          <Button ref={addButtonRef} variant="primary" onClick={() => setCreateOpen(true)}>
            <UserPlusIcon />
            <span>Add user</span>
          </Button>
        }
      />

      <div className="filter-bar" role="search" aria-label="User filters">
        <SearchField
          className="filter-bar__full"
          hideLabel
          label="Search users"
          placeholder="Search name or email"
          value={search}
          onChange={(value) => filters.set({ search: value })}
        />
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(event) => filters.set({ role: event.target.value })}>
            <option value="">All roles</option>
            {roles.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => filters.set({ status: event.target.value })}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <p className="filter-bar__count">{counted(count, "user", "users")}</p>
      </div>

      <div className="users-info-note meta">
        <span aria-hidden="true" className="mark mark--small">
          <InfoIcon size={12} />
        </span>
        Master authority is granted separately from a user's role.
      </div>

      <div className="stack stack--4" aria-live="polite">
        {query.isLoading ? (
          <LoadingState>Loading users…</LoadingState>
        ) : query.isError ? (
          <Alert
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, "Users could not be loaded.")}
          </Alert>
        ) : users.length === 0 ? (
          <EmptyState framed title="No users found">
            Try changing the filters or add a staff user.
          </EmptyState>
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
                      <strong>{[user.rank_name, user.full_name].filter(Boolean).join(" ")}</strong>
                      <span className="users-email meta">
                        <EmailAddress address={user.email} />
                      </span>
                      <MissingDetails user={user} />
                    </>
                  ),
                },
                { key: "role", header: "Role", render: (user) => user.role_display },
                {
                  key: "authority",
                  header: "Master authority",
                  render: (user) => (
                    <span className="users-authority-summary">{authoritySummary(user, authorities)}</span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (user) => (
                    <Badge dot tone={user.is_active ? "success" : "neutral"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  ),
                },
                {
                  key: "login",
                  header: "Last signed in",
                  render: (user) => formatShortDateTime(user.last_login, "Never"),
                },
                {
                  key: "action",
                  header: "Action",
                  actions: true,
                  render: (user) => (
                    <Button variant="secondary" small onClick={() => navigate(`/users/${user.id}`)}>
                      Manage user
                    </Button>
                  ),
                },
              ]}
            />
            <Pagination label="User pages" noun={["user", "users"]} {...paged.pager} />
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
