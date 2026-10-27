# Crowd Management

A responsive React and TypeScript dashboard with sign-in, live occupancy, footfall and dwell analytics, demographic charts, visit history and Socket.IO movement alerts.

## Run

Use Node.js 24+. Run `npm ci`, copy `.env.example` to `.env.local`, then run `npm run dev`. Set `VITE_API_BASE_URL` to the provided staging origin. Enter credentials through the login form.

## Check

Run `node --test tests/*.test.mjs`, `npm run lint` and `npm run build`. Serve the production build with `npm run preview`.

Optional isolated browser checks: install tools with `npm install --prefix .qa-tools --no-save --package-lock=false playwright`, then `npx --prefix .qa-tools playwright install chromium`. After building, run `npm run test:browser` with port 4173 free. The suite uses synthetic API/socket data; browser checks and the staging load-time target remain unverified in this environment.

## Notes

Site-local date filters use UTC milliseconds for API requests. Live presence is distinct from hourly averages; selected-site activity refreshes today's analytics at a bounded rate.

The supplied backend has no refresh-token endpoint. Sessions restore across reloads while valid; expiry requires sign-in. Branding assets are temporary and replaceable in `public/brand/`.
