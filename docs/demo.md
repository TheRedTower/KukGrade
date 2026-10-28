# The demo site

A demo anyone can try, with made-up data and no consequences. It is the same image as a
real install, started with `KUKGRADE_DEMO_MODE=1`. A real club never uses this.

## What a visitor gets

The sign-in page offers three shared accounts, each one click away:

| Account | What it shows |
| --- | --- |
| **Instructor** | Building a grading, ticking and commenting on an assessment, recommending a verdict. Cannot make the final decision. |
| **Master** | The final decision on each candidate, promoting students, reopening a locked grading, the audit log. |
| **Administrator** | Students, staff accounts, the syllabus and the audit log. Cannot grade, and cannot grant themselves the Master's authority. |

None is a superuser, so the real permission boundaries are on show. The club is
made up (about fifty students, a school prefix of `123-4`) and is built through the same
services the application uses, so the audit log and the promotion ledger are genuine. It holds:

- two **completed** gradings, with promotions, a Fail, a Conditional and a Pass the Master
  gave against the instructor's recommendation;
- a **locked** grading whose instructors' recommended verdicts are waiting for the Master;
- an **open** grading today, some assessments finished, some part way (with comments), some
  not started, and one candidate withdrawn;
- a **planned** grading with a few candidates registered, and many students not yet in any
  grading so the cohort builder can be tried (including a Jo Kyo Nim candidate);
- some imported historical records, some linked to students and some waiting to be.

## What is closed

Everything works except what would hurt the other people using it, or outlive the next reset:
changing a password (it would sign everyone else out of that account), changing the accounts
themselves, and uploading files. The server refuses these; the page says so.

## Many people at once

Any number of people can be signed in to the same account: each sign-in has its own session.
Everyone shares one club, so you see each other's changes. The app runs one worker with 16
threads in demo mode, and the sign-in limit is raised to 60 a minute for each address, because
visitors share offices and schools.

## It resets itself

Every `KUKGRADE_DEMO_RESET_HOURS` (default 6, at whole hours from midnight club time) the club is
wiped and built again in one step, which takes a few seconds. Anything a visitor typed goes with
it. The accounts stay, so a visitor who is signed in stays signed in. The sign-in page and a
banner tell visitors when the next reset is.

The demo refuses to build or reset on a database that holds any account other than its own
three, so setting the flag on a real install stops it rather than wiping it.

## Running it

Use a machine of its own, with no route to anything you care about (for example a small VM
whose firewall refuses traffic to your other networks). The demo brings no tunnel or proxy of
its own; it expects the one you already run.

1. Start it: `KUKGRADE_HOST=demo.example.org docker compose -f deploy/compose.demo.yml up -d`
2. Connect your tunnel to the demo's network, once. If it is a plain container:
   `docker network connect kukgrade-demo <your-cloudflared-container>`. If it is in a Compose
   file, add the network to it instead:

   ```yaml
   services:
     cloudflared:
       networks: [default, kukgrade-demo]
   networks:
     kukgrade-demo:
       external: true
   ```

3. In Cloudflare, give the tunnel a public hostname whose service is `http://kukgrade-demo:6942`.

The file is built so that a taken-over app could reach nothing:

- the app is on a network with **no way out**, and the only thing on it is your tunnel, which
  keeps its own route to the internet. Nothing else on your machine can reach the demo, and the
  demo cannot reach them;
- it is read-only, has no privileges, and is limited in memory, processors and processes;
- it mounts nothing and publishes no port. The database, secret key and uploads live in memory
  and are gone when it restarts (and rebuilt from nothing, in a few seconds).

Then run `deploy/check-proxy-count.sh` against it once, to confirm the proxy count
(`DJANGO_NUM_PROXIES`, 1 by default here): a wrong count lets visitors share one sign-in limit,
or choose their own address. Consider a Cloudflare rate-limiting rule as well.

The demo follows `latest`, so a new release reaches it with two commands, run from the
repository folder on the demo's machine:

```sh
KUKGRADE_HOST=demo.example.org docker compose -f deploy/compose.demo.yml pull
KUKGRADE_HOST=demo.example.org docker compose -f deploy/compose.demo.yml up -d
```

The data is rebuilt on every start, so there is nothing to migrate or back up. Every release's
image is started in exactly this way (demo mode, read-only, in-memory data) by the release
workflow's smoke test before it is published. To try a release candidate first, set
`KUKGRADE_VERSION` to its tag (for example `0.2.0-rc.1`). Expect strangers to type silly things;
the next reset clears them.
