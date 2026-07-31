import assert from "node:assert/strict";
import { cartoBasemapUrl, nextTheme } from "../src/lib/theme.ts";

assert.equal(nextTheme("dark"), "light");
assert.equal(nextTheme("light"), "dark");
assert.match(cartoBasemapUrl("dark"), /\/dark_all\//);
assert.match(cartoBasemapUrl("light"), /\/light_all\//);
