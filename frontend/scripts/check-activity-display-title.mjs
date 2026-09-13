import { chromium } from "playwright";

const activities = [
  {
    id: "mock-ride",
    sport: "ride",
    title: "Activity",
    start_time: "2026-09-13T10:00:00+07:00",
    elapsed_time_s: 1800,
    distance_m: 10000,
    source_type: "API_OFFICIAL",
  },
  {
    id: "mock-run",
    sport: "run",
    title: "Long Run",
    start_time: "2026-09-12T10:00:00+07:00",
    elapsed_time_s: 3600,
    distance_m: 10000,
    source_type: "API_OFFICIAL",
  },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.route("http://localhost:8000/**", async (route) => {
  const { pathname } = new URL(route.request().url());
  let body = {};

  if (pathname === "/api/dashboard/summary") {
    body = { period_days: 7, activities, health: [], sleep: [], fitness: {} };
  } else if (pathname === "/api/dashboard/personal-records") {
    body = { groups: [] };
  } else if (pathname === "/api/activities/") {
    body = { activities, total_count: activities.length };
  } else if (pathname.endsWith("/records")) {
    body = { records: [] };
  } else if (pathname.startsWith("/api/activities/")) {
    const id = pathname.split("/").at(-1);
    body = { ...activities.find((activity) => activity.id === id), laps: [] };
  }

  await route.fulfill({ json: body });
});

const assertTitles = async (path, selectors) => {
  await page.goto(`http://localhost:3000${path}`);
  for (const [selector, expected] of selectors) {
    await page.locator(selector).filter({ hasText: expected }).waitFor();
  }
};

await assertTitles("/", [
  ['a[href^="/activities/mock-ride"]', "Cycling"],
  ['a[href^="/activities/mock-run"]', "Long Run"],
]);
await assertTitles("/activities", [
  ['a[href^="/activities/mock-ride"]', "Cycling"],
  ['a[href^="/activities/mock-run"]', "Long Run"],
]);
await assertTitles("/activities/mock-ride?sport=ride", [["h1", "Cycling"]]);
await assertTitles("/activities/mock-run?sport=run", [["h1", "Long Run"]]);

await browser.close();
console.log("Activity titles render correctly on dashboard, list, and detail pages.");
