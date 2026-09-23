# Login page redesign

**Status:** approved 2026-09-23

## Goal

Make the sign-in pages look modern, borrowing the style of a shadcn "Spline scene +
Spotlight" reference, without adding anything that works against a self-hosted
device lab.

## Decisions

- **No Spline and no outside network calls.** The reference downloads a 3D scene from
  `prod.spline.design` at runtime. The pre-auth page would contact a third party and
  fail offline or behind a firewall. It would also add about 1–2 MB and show a
  generic robot. We draw a Xenon-specific scene in CSS/SVG instead.
- **No `framer-motion`.** Versions 7 and up need React 18, and the dashboard is on
  React 17. Every animation is CSS keyframes, turned off under
  `prefers-reduced-motion`.
- **No shadcn `card.tsx`.** It would clash with the existing `components/ui/Card.tsx`
  on macOS, where file names ignore case. The shell is plain markup.

## Scope

`AuthShell` is shared by login, forgot-password and reset-password, so all three get
the new hero. Only the login form is restyled. Auth logic (`login`, `refresh`, the
`next` redirect) does not change.

## Units

| File | Purpose |
|---|---|
| `web/src/components/ui/spotlight.tsx` | Mouse-follow glow over its parent. Uses CSS variables and named handlers, so cleanup removes the same functions it added (the reference removed new anonymous ones and leaked). |
| `web/src/pages/auth-hero.tsx` | Decorative picture: three phone frames, each with a LIVE dot and a scan line, plus a "selector healed" chip. Hidden from screen readers (`aria-hidden`). |
| `web/src/pages/auth.css` | Keyframes and a reduced-motion override. |
| `web/src/pages/auth-shell.tsx` | Two columns: the hero panel (spotlight beam, gradient headline, picture) and the form column. |
| `web/src/pages/login.tsx` | Fields with icons, labels linked by `htmlFor`, a show/hide password button, a `role="alert"` error box, and a spinner on submit. |

## Layout

The supported width is 1280–1440 px, so the page is always two columns at `md` and up.
Below `md` the hero is hidden, as it is today.

## Verification

- A vitest test that the spotlight removes the same listeners it added.
- A vitest test for the login form: labels are linked, the password toggle works, and
  errors are announced.
- `tsc --noEmit` and `vite build`.
- Screenshots in the browser at 1280 and 1440 px with no horizontal overflow.
