# Frontend

React, TypeScript, and Vite frontend for KukGrade.

## Authentication state

`useAuth()` exposes four states, not three:

| Status | Meaning |
| --- | --- |
| `loading` | The first session check, or a retry after it failed, is in flight. |
| `authenticated` | A user is signed in. |
| `anonymous` | The server answered that nobody is signed in. |
| `error` | The session is **unknown** - the request failed to complete. |

`anonymous` requires a genuine answer from the server: a 401, or a 403 carrying
`authentication_required`. A dropped connection, a 5xx, or a CORS rejection is
not evidence about the viewer's session and produces `error` instead, with a
retry. Collapsing the two would sign people out mid-grading whenever the
backend hiccupped.

Once a user is known, a background re-check (TanStack Query refetches the
current user when the network reconnects) keeps the status `authenticated`
whether it succeeds or fails, so the screen and anything typed on it stay
mounted. Only a genuine "not signed in" answer ends the session.

For the same reason, signing out clears local state only after the server has
confirmed the session ended; a failed sign-out leaves the viewer signed in
rather than showing a signed-out UI backed by a still-valid cookie.

## API errors

`ApiError` carries `status`, `code`, and `fields`. Use `messagesFor(field)` for
per-field validation messages and `nonFieldMessages` for errors raised against
the request as a whole. A validation failure with a single message also
promotes it to `error.message`, so domain-rule failures work as a toast without
inspecting `fields`. See `docs/api_contract.md` for the envelope.

## Commands

Install dependencies:

```sh
npm install
```

Run checks:

```sh
npm run test
npm run lint
npm run typecheck
```

Run the development server:

```sh
npm run dev
```

Set `VITE_API_BASE_URL` to the backend origin when it is not running on `http://localhost:8000`.
