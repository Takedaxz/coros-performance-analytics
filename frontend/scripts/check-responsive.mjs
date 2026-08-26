import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const trends = await readFile(new URL("../src/app/trends/page.tsx", import.meta.url), "utf8");
const heatmap = await readFile(new URL("../src/components/TrainingHeatmapPanel.tsx", import.meta.url), "utf8");

assert.match(sidebar, /aria-label="Primary navigation"/, "navigation must have an accessible label");
assert.match(layout, /viewportFit:\s*"cover"/, "viewport must support safe-area insets on notched devices");
assert.match(layout, /interactiveWidget:\s*"resizes-content"/, "the keyboard must resize the app viewport");
assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?--sidebar-width:\s*72px/, "tablet layout must collapse the sidebar");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.sidebar\s*\{[\s\S]*?position:\s*fixed/, "phone layout must move navigation out of the content flow");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.responsive-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/, "phone grids must collapse to one fluid column");
assert.match(css, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/, "phone layout must account for the iOS safe area");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.sidebar-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(8, minmax\(44px, 1fr\)\)[\s\S]*?overflow-x:\s*auto/, "phone navigation must retain 44px touch targets when the viewport is narrower than eight destinations");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?input,[\s\S]*?select,[\s\S]*?textarea\s*\{[\s\S]*?font-size:\s*max\(16px, 1rem\)/, "phone inputs must not trigger iOS zoom");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.training-pace-zone-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "pace zones must reflow before their text clips");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.activity-card-item\s*\{[\s\S]*?grid-template-columns:\s*40px minmax\(0, 1fr\)/, "activity cards must stack their date on narrow screens");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.metrics-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/, "metric cards must remain a single fluid column after the full cascade");
assert.match(dashboard, /className="activity-card-item dashboard-activity-card"/, "dashboard activities need their own compact mobile layout");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.dashboard-activity-card\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\) auto/, "dashboard activities must remain a compact row on mobile");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.activities-log-card\s*\{[\s\S]*?row-gap:\s*8px/, "activity log cards must use compact mobile row spacing");
assert.match(heatmap, /const heatmapScrollRef = useRef<HTMLDivElement>\(null\)/, "heatmap must own its horizontal timeline scroll container");
assert.match(heatmap, /ref=\{heatmapScrollRef\}[\s\S]*?overflowX: "auto"/, "month labels and cells must share one draggable timeline");
assert.match(heatmap, /heatmapScrollRef\.current\.scrollLeft\s*=\s*heatmapScrollRef\.current\.scrollWidth/, "load log must open at the newest week");
assert.match(heatmap, /minWidth: "725px"/, "heatmap timeline must retain readable cell widths on narrow screens");
assert.match(heatmap, /gridTemplateColumns: "repeat\(52, minmax\(11px, 1fr\)\)"/, "heatmap weeks must retain compact dimensions while scrolling");

assert.match(trends, /matchMedia\("\(max-width: 700px\)"\)[\s\S]*?trainingVolumeDateRange\(6, true\)/, "mobile training volume must start at the beginning of the month six months back");

console.log("Responsive layout contract passed");
