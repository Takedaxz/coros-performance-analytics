# COROS MCP Result Page Design

## Understanding

- Restyle both successful and failed COROS MCP OAuth callback pages.
- Match the light or dark theme selected in the COROS Analytics app.
- Preserve the existing authorization, token storage, polling, and close behavior.
- Keep the page responsive, accessible, and dependency-free.
- Treat new frontend routes and authentication changes as non-goals.

## Assumptions

- The Settings page opens the OAuth flow in a script-created popup.
- Theme is presentation metadata only and can travel in the temporary OAuth state.
- Direct callback visits without stored state may use the existing dark default.

## Decision Log

- Pass the selected app theme through the server-side OAuth state instead of relying on the
  operating-system theme.
- Use one backend HTML renderer for success and error states instead of duplicated templates.
- Use native CSS for the entrance animation and respect `prefers-reduced-motion`.
- Escape backend error messages before inserting them into HTML.
- Add no dependency and no frontend result route.

## Final Design

The Settings popup adds `theme=light` or `theme=dark` to the connect request. The backend
stores that value alongside the existing PKCE state and uses it after the callback. A shared
result-page renderer applies the app's surface, typography, border, and semantic status colors.
Success and failure differ only in copy, icon, and status accent. The card fits narrow popup and
mobile viewports, provides a visible keyboard focus state, and disables animation for users who
prefer reduced motion.
