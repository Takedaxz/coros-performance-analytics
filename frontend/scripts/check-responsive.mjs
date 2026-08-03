import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const sidebar = await readFile(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const heatmap = await readFile(new URL("../src/components/TrainingHeatmapPanel.tsx", import.meta.url), "utf8");

assert.match(sidebar, /aria-label="Primary navigation"/, "navigation must have an accessible label");
assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?--sidebar-width:\s*72px/, "tablet layout must collapse the sidebar");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.sidebar\s*\{[\s\S]*?position:\s*fixed/, "phone layout must move navigation out of the content flow");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.responsive-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/, "phone grids must collapse to one fluid column");
assert.match(css, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/, "phone layout must account for the iOS safe area");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.sidebar-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(8, minmax\(0, 1fr\)\)/, "phone navigation must show all eight destinations");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.training-pace-zone-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "pace zones must reflow before their text clips");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.activity-card-item\s*\{[\s\S]*?grid-template-columns:\s*40px minmax\(0, 1fr\)/, "activity cards must stack their date on narrow screens");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.metrics-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/, "metric cards must remain a single fluid column after the full cascade");
assert.match(dashboard, /className="activity-card-item dashboard-activity-card"/, "dashboard activities need their own compact mobile layout");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.dashboard-activity-card\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\) auto/, "dashboard activities must remain a compact row on mobile");
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.activities-log-card\s*\{[\s\S]*?row-gap:\s*8px/, "activity log cards must use compact mobile row spacing");
assert.match(heatmap, /heatmapScrollRef\.current\.scrollLeft\s*=\s*heatmapScrollRef\.current\.scrollWidth/, "heatmap must open at the current week");
assert.match(heatmap, /className="training-heatmap-months"/, "month labels must share the heatmap timeline");
assert.match(heatmap, /className="training-heatmap-scroll"/, "heatmap timeline must have an explicit scroll container");
assert.match(css, /\.training-heatmap-timeline\s*\{[\s\S]*?min-width:\s*max-content;[\s\S]*?width:\s*100%/, "heatmap timeline must fill wide cards and retain mobile overflow");
assert.match(css, /\.training-heatmap-grid[\s\S]*?grid-template-columns:\s*repeat\(52, minmax\(11px, 1fr\)\)/, "heatmap weeks must expand evenly across wide cards");
assert.match(css, /\.training-heatmap-week\s*\{[\s\S]*?align-items:\s*center/, "heatmap cells must remain centered in expanded week columns");
assert.match(css, /\.training-heatmap-cell\s*\{[\s\S]*?height:\s*11px;[\s\S]*?width:\s*11px/, "full-width heatmap cells must retain compact dimensions");

console.log("Responsive layout contract passed");
