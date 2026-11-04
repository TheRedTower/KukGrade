import { Link } from "react-router-dom";

import type { AuthUser, GradingSession } from "./api";
import { Button } from "./Button";
import type { SessionAction } from "./sessionDetail";
import type { useActionsMenu } from "./useActionsMenu";

interface SessionActionsMenuProps {
  session: GradingSession;
  user: AuthUser | null;
  menu: ReturnType<typeof useActionsMenu>;
  onAction: (action: SessionAction) => void;
}

function MenuItem({ danger, onClick, children }: { danger?: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" role="menuitem" className={`gsd-dropdown-item${danger ? " gsd-danger-text" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** What this viewer may still do to the session, as a menu under one button. */
export function SessionActionsMenu({ session, user, menu, onAction }: SessionActionsMenuProps) {
  const { open, setOpen, menuRef, buttonRef, onMenuKeyDown } = menu;

  return (
    <div className="gsd-dropdown-wrap" ref={menuRef} data-clip-ok>
      <Button
        ref={buttonRef}
        variant="ghost"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="gsd-actions-btn"
      >
        Session actions <span className="gsd-chevron-down" aria-hidden="true">⌵</span>
      </Button>

      {open && (
        <div className="gsd-dropdown-menu menu-panel" role="menu" onKeyDown={onMenuKeyDown}>
          {session.status === "DRAFT" && (
            <>
              <MenuItem onClick={() => onAction("OPEN")}>Open session</MenuItem>
              <MenuItem danger onClick={() => onAction("CANCEL")}>Cancel session</MenuItem>
            </>
          )}
          {session.status === "OPEN" && (
            <>
              <MenuItem onClick={() => onAction("LOCK")}>Lock session</MenuItem>
              <MenuItem danger onClick={() => onAction("CANCEL")}>Cancel session</MenuItem>
            </>
          )}
          {session.status === "LOCKED" && (
            <>
              <MenuItem onClick={() => onAction("COMPLETE")}>Complete session</MenuItem>
              {user?.can_override_locked_session && <MenuItem danger onClick={() => onAction("CANCEL")}>Cancel session</MenuItem>}
            </>
          )}
          {user?.can_read_audit_log && (
            <Link
              to={`/audit?entity_type=GradingSession&entity_id=${session.id}`}
              role="menuitem"
              className="gsd-dropdown-item"
              onClick={() => setOpen(false)}
            >
              View audit events
            </Link>
          )}
          {/* The server decides, for this user, by the delete's own rule. */}
          {session.can_be_deleted && <MenuItem danger onClick={() => onAction("DELETE")}>Delete session</MenuItem>}
        </div>
      )}
    </div>
  );
}
