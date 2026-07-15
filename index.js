// Landing page -- builds the six view-card previews (see renderPreviews()
// below) from real, live data, via the same shared.js rendering functions
// every real view already uses (sparklineSvg(), pctChangeColor(), etc.) --
// never a static image or hand-copied snapshot, so these can't go stale the
// way a screenshot would. The search box that used to live in this page's
// hero has moved to its own page (find-a-district.html/.js) -- see
// shared.js's own search-related exports (buildSearchIndex(),
// wireSearchForm(), etc.), extracted from here so that page and this one
// (if it ever needs search again) share one implementation, not two that
// could drift.
import {
  loadDistricts,
  loadCharterPoints,
  loadFullStatewideTotals,
  shortName,
  sparklineSvg,
  pctChangeColor,
  districtShapeSentence,
  efaEraChange,
  formatSignedPct,
  formatCagr,
  CHARTER_POINT_COLOR,
  pickRandomDistricts,
  // CANDIDATE (Part B, appearance-improvement round) -- these four are only
  // used by the not-yet-committed candidate additions below (District
  // Rankings' notes+trajectory, District Detail's caveat badge, School
  // Districts' Notes column, Charter Schools' multi-campus mark, Map's
  // charter markers).
  thinBaselineIcon,
  boundaryChangedIcon,
  reversalIcon,
  makeCaveatsMark,
  multiCampusIcon,
  CHARTER_POINT_STYLE,
} from "./shared.js";

// Imboden is one of charter_points.json's 23 entries (rendered as a map
// point for lack of its own boundary polygon) but is actually one of
// districts.json's 235 real districts, not a charter SIS row -- same
// exclusion charter-schools.js's own IMBODEN_ID applies, for the same
// reason: it would otherwise show up as a "charter" in the charter preview
// below even though it's really one of the 235 districts. A local copy,
// not imported from shared.js's own SEARCH_IMBODEN_ID (that one is a
// private implementation detail of the search index, not meant to be
// reached from outside shared.js) -- same "small local constant per file"
// convention this exclusion already follows everywhere else it appears.
const IMBODEN_ID = "0500061";

// Local svgEl()/SVG_NS copy -- this file never needed to build raw SVG
// itself before (sparklineSvg() is imported wholesale from shared.js), so
// it didn't have one; every other view file that builds its own SVG
// (map.js, drill-down.js, statewide-line.js, school-districts.js, charter-
// schools.js, and shared.js itself) keeps its own tiny copy of this exact
// helper rather than importing one -- this follows that existing
// convention now that the map preview below needs it too.
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// ---------------------------------------------------------------------------
// Map preview geometry -- data/map_preview_geometry.json: { districtId:
// "M...L...Z" } for all 234 district polygons, in the real map's own
// 0..880 x 0..620 viewBox coordinate space.
//
// UNLIKE every other file this page loads, this one has NO live-data
// dependency for its geometry -- it holds only projected SHAPE (already
// run through d3-geo's Mercator projection + fitExtent, exactly as
// map.js's own real render produces), never color or any districts.json
// field. Color is applied at render time below, from real, live
// districts.json data, same as every other preview on this page -- only
// the boundary geometry itself is pre-computed and static. It needs
// regenerating only if Arkansas's district boundaries actually change (a
// real crosswalk.csv merger/split event, not a routine occurrence) --
// distinct from this page's other data files, which must never go stale
// because they change every SIS refresh.
//
// REGENERATION RECIPE (last run 2026-07-13, against the real map.html):
//   1. Serve this repo locally and open src/map.html in a browser; let it
//      fully render (confirms `document.querySelectorAll('a.district-poly-
//      link').length === 234`).
//   2. Extract each polygon's already-projected `d` attribute, keyed by
//      the district id parsed out of that link's own
//      `href="drill-down.html?id=<id>"`:
//        const geometry = {};
//        for (const link of document.querySelectorAll('a.district-poly-link')) {
//          const id = new URL(link.getAttribute('href'), location.href).searchParams.get('id');
//          geometry[id] = link.querySelector('path').getAttribute('d');
//        }
//   3. Simplify: each path is "M x,y L x,y ... Z" (one or more subpaths
//      for the rare MultiPolygon district) -- run per-subpath Douglas-
//      Peucker at tolerance=3 (in the map's own 880x620 units) and round
//      to integer coordinates. This is PER-POLYGON, not topology-aware
//      (unlike build_topojson.py's toposimplify, which simplifies shared
//      borders once, consistently) -- checked directly, not assumed: at
//      tolerance=3 this opens no visually detectable gaps between
//      neighboring districts at actual preview render size (~170px wide);
//      gaps do appear from tolerance=5 upward, checked side by side with
//      real per-district pctChangeColor() fills, not a flat test color
//      (a flat fill hides the seams and gives a false pass).
//   4. Imboden Charter is deliberately NOT included in this file (it has
//      no district polygon on the real map either -- see districts.json's
//      IMBODEN_ID). The real map also overlays 23 charter-school point
//      markers; this preview omits them too -- a single ~2px dot among
//      234 polygons is not meaningfully visible at preview scale, and
//      every other preview on this page already treats "compact peek, not
//      full replica" as the norm (e.g. the ranked list preview drops the
//      search/filter chrome, the district detail preview drops the
//      key-stats block).
//   5. Save as data/map_preview_geometry.json: { [districtId]: pathD }.
const MAP_PREVIEW_GEOMETRY_URL = new URL("./data/map_preview_geometry.json", import.meta.url);
let _mapGeometryCache = null;
async function loadMapPreviewGeometry() {
  if (_mapGeometryCache) return _mapGeometryCache;
  const res = await fetch(MAP_PREVIEW_GEOMETRY_URL);
  if (!res.ok) throw new Error(`Failed to load map_preview_geometry.json: ${res.status}`);
  _mapGeometryCache = await res.json();
  return _mapGeometryCache;
}

// CANDIDATE (Part B) -- charter points, projected LIVE from charter_points.json's
// own lon/lat at render time, NOT read from a static snapshot file. A prior
// version of this (data/map_preview_charter_points.json, a one-time browser
// extraction of the real map's rendered circle positions) was flagged and
// removed: unlike district boundaries (a rare, tracked merger event -- see
// MAP_PREVIEW_GEOMETRY_URL's own comment above), the charter roster genuinely
// churns year to year (a charter opening, closing, or getting a coordinate
// correction), so a frozen snapshot of PROJECTED POINTS would have silently
// gone stale the next time charter_points.json changed, with nothing to catch
// it.
//
// The fix reuses map.js's own projection, split into what's actually stable
// vs. what actually changes: the real map's projection is
// d3.geoMercator().fitExtent([[10,10],[870,610]], geo) against the district
// topology -- its scale/translate are a function of Arkansas's district
// boundaries (the same rare-change input map_preview_geometry.json already
// depends on), NOT of which charters currently exist. So scale/translate are
// frozen constants below (same one-time browser-extraction technique, same
// staleness profile as the district geometry), but the actual lon/lat -> x/y
// projection of each point happens here, every render, against whatever
// charterPoints array is currently loaded -- a charter add/remove/coordinate
// fix in charter_points.json is picked up automatically, no regeneration
// step required.
//
// Verified exact (not assumed): extracted scale/translate from the real
// map.html's live d3 projection object (projection.scale()/.translate()),
// then reproduced projectMercator() below in plain JS with zero d3-geo
// dependency and diffed its output against d3's own projection() calls for
// several real charter coordinates -- 0.0000 difference on every point
// (2026-07-14). center is d3.geoMercator()'s own default [0,0], which is why
// the formula below has no lambda0/phi0 offset term to carry.
const MAP_MERCATOR_SCALE = 95.49296585509717;
const MAP_MERCATOR_TRANSLATE = [440, 309.9999999998742];

function projectMercator(lon, lat, scale, translate) {
  const toRad = Math.PI / 180;
  const x = scale * (lon * toRad);
  const y = -scale * Math.log(Math.tan(Math.PI / 4 + (lat * toRad) / 2));
  return [translate[0] + x, translate[1] + y];
}

// ---------------------------------------------------------------------------
// View-card previews -- all 6 views (Statewide trend, Map, Ranked list,
// District detail, Data table, Charter schools). Each is decorative/
// illustrative: the real accessible content is the existing text
// description and the "View" link beside it, same as sparklines are
// already aria-hidden elsewhere in this project with their real content
// living in surrounding text/labels -- these preview containers are
// marked aria-hidden="true" in the HTML itself, nothing extra needed here.
// ---------------------------------------------------------------------------

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// statewide-line.js's own --series-all token (light/dark) -- reused here
// rather than re-picking a color, since this preview is literally a
// smaller draw of that same "All student enrollment" series.
const SERIES_ALL_COLOR = { light: "#2a78d6", dark: "#3987e5" };

function fmtPct(v) {
  return v == null ? "—" : `${formatSignedPct(v)}%`;
}

// Statewide trend preview -- reuses sparklineSvg() itself, not a parallel
// mini-chart implementation: full_statewide_total_by_year.json's rows are
// reshaped into the same { series: [{ year, enrollment }] } shape every
// other sparkline caller already builds from districts.json/
// charter_points.json, so the exact same function draws it. full_all_entities
// is the "All student enrollment" field (districts + charters + other +
// predecessor), matching statewide-line.js's own SERIES.all mapping.
function buildStatewidePreview(totals, mode) {
  const entity = { series: totals.map((t) => ({ year: t.year, enrollment: t.full_all_entities })) };
  // CANDIDATE (Part B) -- eraBands:true draws the real COVID/EFA shaded
  // bands behind the line (sparklineSvg()'s own opt-in branch, shared.js),
  // same tokens the full statewide chart uses. Purely a Part-1-audit-
  // motivated space-use improvement -- doesn't touch the line's own
  // deliberately-honest-proportions sizing below.
  const svg = sparklineSvg(entity, mode, SERIES_ALL_COLOR[mode], { eraBands: true });
  // sparklineSvg()'s own default size (72x20) is tuned for an inline table
  // cell. Scaled up to fill the preview zone's ~288px content width (the
  // zone is a full 320x320 square now, not a half-width split), at its
  // own natural 72:20 aspect ratio (no preserveAspectRatio override --
  // still deliberately NOT stretched taller to fill the zone's full
  // ~288px height: a sparkline's Y-axis is a real, if relative, magnitude
  // encoding, and exaggerating it vertically would overstate the actual
  // trend. Centered in the square zone with empty space above/below
  // instead -- honest proportions over a forced full-height fit.
  svg.setAttribute("width", "280");
  svg.setAttribute("height", "78");
  return svg;
}

// Ranked list preview -- N random districts (same pickRandomDistricts()
// mechanism District Detail's own pickRandomDistrict() now shares, see
// shared.js), re-sorted by pct_change_efa_era before rendering so the
// result still reads like an authentic slice of a ranked list (internally
// ordered, steepest decline first -- matching district-rankings.js's own
// default sort) even though WHICH 3 districts appear varies every real page
// load. Replaces the old deterministic "always the 3 steepest-decline
// districts statewide" behavior -- that never varied across reloads, unlike
// every other preview on this page.
//
// No exclusion/overlap logic against the data table preview's own
// independent pick below -- each card selects on its own; a shared district
// landing on both cards in the same page load is a real possibility, not a
// bug to prevent (this project's own "don't over-engineer coordination
// between independent picks" call, same reasoning pickRandomDistrict()
// already applies to the District Detail card).
//
// Cached per page load (not re-rolled on a dark/light-mode re-render) --
// same reasoning as randomDistrictPick below: renderPreviews() runs again
// on an OS theme change, and that re-render should only refresh this card's
// colors, not swap to a different 3 districts mid-view.
//
// No null-guard on pct_change_efa_era before sorting -- checked, not
// assumed: all 235 districts in the live data have a real (non-null) value
// for this field (same fact pickRandomDistrict()'s own comment below
// already established for typology/sparkline-eligibility), so a random
// pick can't land on a district that breaks this sort.
let randomRankedPick = null;
function pickRankedPreviewDistricts(districts, n) {
  if (!randomRankedPick) {
    randomRankedPick = pickRandomDistricts(districts, n)
      .sort((a, b) => a.pct_change_efa_era - b.pct_change_efa_era);
  }
  return randomRankedPick;
}

// Data table preview -- N random districts, same pickRandomDistricts()
// mechanism as the ranked list preview above, but its OWN independent pick
// (see that function's comment for why the two cards no longer share one
// set) and no particular sort -- matches the real table's own
// non-implied-order nature (school-districts.js's default sort is
// alphabetical by name, not by any of the numbers shown here).
let randomDatatablePick = null;
function pickDatatablePreviewDistricts(districts, n) {
  if (!randomDatatablePick) {
    randomDatatablePick = pickRandomDistricts(districts, n);
  }
  return randomDatatablePick;
}

// district-rankings.js's/school-districts.js's own local helper, same name
// same behavior -- used below by the CANDIDATE Notes-icon additions
// (reversalIcon()'s title text), which is the only place this preview
// needs it.
function fmtMagnitude(v) {
  return v ? v[0].toUpperCase() + v.slice(1) : "—";
}

// CANDIDATE (Part B) -- shared header-row builder for the two row-style
// preview cards (District Rankings, Charter Schools) below, matching
// School Districts' own .preview-table th treatment (see index.html's
// .preview-header-row). `cells` is [className, label] pairs -- label null
// for a slot with no header text (the icon-only columns: swatch, notes,
// trajectory on the District Rankings card), same "no all-clear
// placeholder" reasoning already applied to the icons themselves --
// mirrors the real district-rankings.html's own header row, which leaves
// its header-swatch/header-notes/header-trajectory spans equally empty.
function buildPreviewHeaderRow(cells) {
  const header = document.createElement("div");
  // Both classes -- .preview-row is what actually gives this row's cells
  // their column widths/flex behavior (see index.html's own comment on
  // why .preview-header-row alone isn't enough); .preview-header-row
  // layers the header-specific font/color treatment on top via a compound
  // selector.
  header.className = "preview-row preview-header-row";
  for (const [className, label] of cells) {
    const span = document.createElement("span");
    span.className = className;
    if (label) span.textContent = label;
    header.appendChild(span);
  }
  return header;
}

// Ranked list preview -- same swatch + shortened-name + signed-pct anatomy
// district-rankings.js's real rows use (pctChangeColor()/shortName()/
// formatSignedPct() all reused, not reimplemented), just 3 rows and no
// interactive chrome (no search box, filter, or sort control -- a static
// peek).
function buildRankedPreview(districts, mode) {
  const top = pickRankedPreviewDistricts(districts, 3);
  const list = document.createElement("div");
  list.className = "preview-list";
  // CANDIDATE (Part B) -- header row, added to close the Part-1-audit gap
  // this project already flagged (School Districts had column labels,
  // District Rankings didn't). "District"/"EFA chg" match School
  // Districts' own header wording exactly, for cross-card consistency;
  // the swatch/notes/trajectory slots stay label-less, same as the real
  // district-rankings.html page's own header row treats those same three
  // icon-only columns.
  list.appendChild(buildPreviewHeaderRow([
    ["p-swatch", null],
    ["p-name", "District"],
    ["p-notes", null],
    ["p-trajectory", null],
    ["p-pct", "EFA chg"],
  ]));
  const wrap = document.createElement("div");
  wrap.className = "preview-rows";
  for (const d of top) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const swatch = document.createElement("span");
    swatch.className = "p-swatch";
    swatch.style.background = pctChangeColor(d.pct_change_efa_era, mode);
    const name = document.createElement("span");
    name.className = "p-name";
    name.textContent = shortName(d.name);
    // CANDIDATE (Part B) -- the same three Notes-icon marks
    // (thinBaselineIcon()/reversalIcon()/boundaryChangedIcon(), via
    // makeCaveatsMark()) the real row's own .row-notes carries. Empty for a
    // clean row (177 of 235 districts have none), same "no all-clear
    // placeholder" convention every other caveat mark in this project
    // already follows -- not forced content, a real reflection of whether
    // this particular random pick has anything to flag.
    const notes = document.createElement("span");
    notes.className = "p-notes";
    if (d.baseline_years_thin) {
      notes.appendChild(makeCaveatsMark(thinBaselineIcon(), "Thin baseline"));
    }
    if (d.reversal_magnitude) {
      notes.appendChild(makeCaveatsMark(
        reversalIcon(d.reversal_magnitude),
        `${fmtMagnitude(d.reversal_magnitude)} reversal`
      ));
    }
    if (d.boundary_change_within_series) {
      notes.appendChild(makeCaveatsMark(boundaryChangedIcon(), `Boundary changed: ${d.current_boundary_since}`));
    }
    // CANDIDATE (Part B) -- the same trajectory sparkline the real row
    // carries (sparklineSvg(), default 72x20 size, not the 280x78 scale-up
    // the Statewide/District Detail previews use -- this is a small row
    // indicator, same reasoning school-districts.js's own Trajectory column
    // uses a small size, not the focal-graphic one).
    const trajectory = document.createElement("span");
    trajectory.className = "p-trajectory";
    trajectory.appendChild(sparklineSvg(d, mode));
    const pct = document.createElement("span");
    pct.className = "p-pct";
    pct.textContent = fmtPct(d.pct_change_efa_era);
    row.append(swatch, name, notes, trajectory, pct);
    wrap.appendChild(row);
  }
  list.appendChild(wrap);
  return list;
}

// Data table preview -- its OWN independent random 3 districts (see
// pickDatatablePreviewDistricts() above; no longer the same 3 as the ranked
// list preview -- each card now picks on its own), as a real <table> rather
// than another set of swatch+name+pct rows: a real <table> reads as
// visually distinct from the ranked list's row style regardless of which
// districts either one happens to show. formatCagr() reused directly from
// shared.js (identical to how
// drill-down.js's own key-stats block formats the same field) rather than
// school-districts.js's own plainer per-cell fmtPct() -- this preview has no
// column header repeating "CAGR" as a rate the way the real table's
// header does, so the "/yr" suffix stays in the cell itself.
//
// Back to 4 columns (District/Traj./Baseline/EFA chg), Trajectory
// restored. Last round dropped it because the preview zone's content
// width was only ~135px (the left/right 50/50 split); this round's zone
// is a full 320x320 square (~288px content width), comfortably more room
// than even the original 200x110 landscape zone (~180px) that first
// prompted a 4-column layout. Trajectory sparkline sized small (36x13,
// an indicator, not a focal graphic) rather than at the real table's own
// default 72x20 -- this column only needs to be recognizable as "a
// shape," the same 3 other previews on this page (Statewide, District
// detail, Charter schools) already carry the full-size version.
function buildDataTablePreview(districts, mode) {
  const top = pickDatatablePreviewDistricts(districts, 3);
  const table = document.createElement("table");
  table.className = "preview-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  // CANDIDATE (Part B) -- "Notes" appended, same label/position
  // school-districts.html's real header row uses for its own Notes column.
  for (const label of ["District", "Traj.", "Baseline", "EFA chg", "Notes"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const d of top) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.className = "p-table-name";
    nameTd.textContent = shortName(d.name);
    const trajTd = document.createElement("td");
    const trajSvg = sparklineSvg(d, mode);
    trajSvg.setAttribute("width", "36");
    trajSvg.setAttribute("height", "13");
    trajTd.appendChild(trajSvg);
    const baselineTd = document.createElement("td");
    baselineTd.textContent = typeof d.baseline_cagr === "number" ? formatCagr(d.baseline_cagr) : "—";
    const efaTd = document.createElement("td");
    efaTd.textContent = fmtPct(d.pct_change_efa_era);
    // CANDIDATE (Part B) -- the same 3-icon Notes system
    // (thinBaselineIcon()/reversalIcon()/boundaryChangedIcon(), via
    // makeCaveatsMark()) school-districts.html's real Notes column uses.
    // Empty for a clean row, same convention every other caveat mark in
    // this project follows.
    const notesTd = document.createElement("td");
    notesTd.className = "p-table-notes";
    if (d.baseline_years_thin) {
      notesTd.appendChild(makeCaveatsMark(thinBaselineIcon(), "Thin baseline"));
    }
    if (d.reversal_magnitude) {
      notesTd.appendChild(makeCaveatsMark(
        reversalIcon(d.reversal_magnitude),
        `${fmtMagnitude(d.reversal_magnitude)} reversal`
      ));
    }
    if (d.boundary_change_within_series) {
      notesTd.appendChild(makeCaveatsMark(boundaryChangedIcon(), `Boundary changed: ${d.current_boundary_since}`));
    }
    tr.append(nameTd, trajTd, baselineTd, efaTd, notesTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// District detail preview -- a genuinely random district, freshly picked
// on each real page load (client-side, at render time, from the live
// districts array -- never a build-time/hardcoded choice). Replaces the
// prior fixed example (LAWRENCE COUNTY, id 0500082, hand-picked for a
// clean reversal_upward shape): a single static example doesn't
// communicate "235 real districts here to explore" the way a rotating
// one does. Delegates the actual random-index-and-remove mechanics to
// shared.js's pickRandomDistricts() (n=1) -- extracted there once the
// ranked list and data table previews below needed the exact same
// mechanism for N>1, rather than three independent copies of the same
// Math.random() index logic. No weighting or curated pool -- any of the
// 235 can appear.
//
// Cached per page load (not re-rolled on every renderPreviews() call) --
// renderPreviews() also runs again on an OS dark/light-mode change (see
// main()'s matchMedia listener), and that re-render should only refresh
// this card's COLORS for the new mode, same as every other preview on
// this page, not swap to a different district mid-view. A real reroll
// only happens on an actual page reload, when this module re-
// initializes and randomDistrictPick resets to null.
//
// No exclusion logic for thin-baseline/boundary-change districts --
// checked, not assumed unnecessary: every one of the 235 districts in
// the live data has a real typology (districtShapeClause()'s
// "insufficient baseline-era history" fallback text is defensive code,
// never actually triggered by today's data) and at least 2
// sparkline-eligible points even after boundary-change filtering (the 7
// boundary-change districts have 5-12 post-boundary points, not fewer),
// so no random pick can land on a district that renders a blank or
// broken-looking card.
let randomDistrictPick = null;
function pickRandomDistrict(districts) {
  if (!randomDistrictPick) {
    randomDistrictPick = pickRandomDistricts(districts, 1)[0];
  }
  return randomDistrictPick;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

function buildDistrictPreview(districts, mode) {
  const d = pickRandomDistrict(districts);
  if (!d) return null;
  const wrap = document.createElement("div");
  wrap.className = "preview-district";
  const spark = sparklineSvg(d, mode);
  // Sized to the zone's ~288px content width (a full 320x320 square, not
  // a half-split), same natural-ratio-only rule as the statewide/map
  // previews above.
  spark.setAttribute("width", "280");
  spark.setAttribute("height", "78");
  wrap.appendChild(spark);
  const name = document.createElement("div");
  name.className = "p-district-name";
  name.textContent = shortName(d.name);
  wrap.appendChild(name);
  const shape = document.createElement("div");
  shape.className = "p-shape";
  // The zone is a full 320x320 square (~288px content) now -- room for
  // the full sentence (longest of the 10 real typology sentences is 92
  // chars; this call still defensively caps at 110 in case a future data
  // refresh ever features a different, longer one) rather than an
  // artificial cut.
  shape.textContent = truncate(districtShapeSentence(d), 110);
  wrap.appendChild(shape);
  // CANDIDATE (Part B) -- one real stat (EFA change, drill-down.html's own
  // "EFA change" key-stat field) plus, only when this random pick actually
  // has one, the same caveat-badge pill drill-down.html's identity row
  // uses (Thin baseline / <Magnitude> reversal / Boundary changed <year>,
  // same order that row already establishes) -- real content the drill-
  // down page already shows for this exact district, not new/decorative
  // text invented for the preview.
  const statLine = document.createElement("div");
  statLine.className = "p-stat-line";
  const efaStat = document.createElement("span");
  efaStat.className = "p-efa-stat";
  efaStat.appendChild(document.createTextNode("EFA change: "));
  const efaValue = document.createElement("b");
  efaValue.textContent = fmtPct(d.pct_change_efa_era);
  efaStat.appendChild(efaValue);
  statLine.appendChild(efaStat);
  if (d.baseline_years_thin) {
    const badge = document.createElement("span");
    badge.className = "p-caveat-badge";
    badge.textContent = "Thin baseline";
    statLine.appendChild(badge);
  }
  if (d.reversal_magnitude) {
    const badge = document.createElement("span");
    badge.className = "p-caveat-badge";
    badge.textContent = `${fmtMagnitude(d.reversal_magnitude)} reversal`;
    statLine.appendChild(badge);
  }
  if (d.boundary_change_within_series) {
    const badge = document.createElement("span");
    badge.className = "p-caveat-badge";
    badge.textContent = `Boundary changed ${d.current_boundary_since}`;
    statLine.appendChild(badge);
  }
  wrap.appendChild(statLine);
  return wrap;
}

// Charter schools preview -- same name + metric anatomy as the ranked
// list preview, but each charter's own sparkline in place of a swatch dot
// (charters have no typology-based color to key a dot to -- same reason
// charter-schools.js's own row uses a sparkline instead), and
// efaEraChange() for the metric (reused from shared.js, identical to how
// charter-schools.js computes its own EFA-era change column). Sorted by
// current enrollment, largest first -- charter-schools.html's own default
// sort is alphabetical, not particularly meaningful for a 3-row preview,
// so this picks the most substantial/recognizable networks instead of
// whichever 3 happen to sort first by name. Imboden excluded -- see
// IMBODEN_ID's own comment above.
function buildCharterPreview(charterPoints, mode) {
  const top = charterPoints
    .filter((c) => c.id !== IMBODEN_ID)
    .map((c) => ({ ...c, efa_era_change: efaEraChange(c) }))
    .sort((a, b) => (b.latest_enrollment ?? 0) - (a.latest_enrollment ?? 0))
    .slice(0, 3);
  const list = document.createElement("div");
  list.className = "preview-list";
  // CANDIDATE (Part B) -- header row, same School-Districts-matching
  // treatment as the ranked list preview above (buildPreviewHeaderRow()).
  // "Traj."/"Charter"/"EFA chg" mirror School Districts' own abbreviated
  // header wording ("Traj."/"District"/"EFA chg"); the notes slot stays
  // label-less -- at 16px it's too narrow for even "NOTES" to fit
  // legibly, same reasoning the District Rankings header above already
  // applies to its own icon-only slots.
  list.appendChild(buildPreviewHeaderRow([
    ["p-charter-traj-label", "Traj."],
    ["p-name", "Charter"],
    ["p-charter-notes", null],
    ["p-pct", "EFA chg"],
  ]));
  const wrap = document.createElement("div");
  wrap.className = "preview-rows";
  for (const c of top) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const svg = sparklineSvg(c, mode, CHARTER_POINT_COLOR[mode]);
    // Back up from the last round's 24x11 (shrunk to fit a ~135px-wide
    // zone) -- the zone is ~288px wide now, real room for the sparkline
    // to be a recognizable shape rather than a barely-there sliver, while
    // still leaving the name and pct figure their own space in the row.
    svg.setAttribute("width", "44");
    svg.setAttribute("height", "16");
    const name = document.createElement("span");
    name.className = "p-name";
    name.textContent = shortName(c.name);
    // CANDIDATE (Part B) -- multiCampusIcon() (promoted to shared.js, see
    // its own comment there), shown only for a charter that actually has
    // charter_points.json's own real map_caveat (2 of these 3 do today) --
    // same "no all-clear placeholder" convention every other caveat mark in
    // this project follows, not a fixed slot forced onto every row.
    const notes = document.createElement("span");
    notes.className = "p-charter-notes";
    if (c.map_caveat) {
      notes.appendChild(makeCaveatsMark(multiCampusIcon(), c.map_caveat));
    }
    const pct = document.createElement("span");
    pct.className = "p-pct";
    pct.textContent = fmtPct(c.efa_era_change);
    row.append(svg, name, notes, pct);
    wrap.appendChild(row);
  }
  list.appendChild(wrap);
  return list;
}

// Map preview -- static pre-projected shape (mapPreviewGeometry, see its
// own loader/comment above) filled with real, live color: pctChangeColor()
// against each district's own current pct_change_efa_era, read from the
// same districts.json every other preview on this page already uses. No
// d3-geo/topojson-client/CDN script -- the geometry is already projected,
// so this is just plain SVG <path> elements at a smaller viewBox scale.
function buildMapPreview(districts, mapGeometry, charterPoints, mode) {
  const byId = new Map(districts.map((d) => [d.id, d]));
  // Arkansas is genuinely wider than tall (real aspect 880:620 = 1.42:1),
  // and the preview zone is a square (~288px content) -- the two don't
  // match, and stretching the shape to fill the square would distort
  // real geography into something that no longer reads as Arkansas. Kept
  // undistorted instead: sized to the zone's ~288px content width at the
  // map's own true ratio (280 / 1.42 = 197, trimmed slightly for margin),
  // vertically centered by the zone's own flex centering, empty space
  // above/below rather than a stretched fit.
  const svg = svgEl("svg", {
    viewBox: "0 0 880 620", width: 280, height: 197, class: "preview-map-svg",
  });
  for (const [id, pathD] of Object.entries(mapGeometry)) {
    const d = byId.get(id);
    if (!d) continue;
    svg.appendChild(svgEl("path", {
      d: pathD, fill: pctChangeColor(d.pct_change_efa_era, mode), stroke: "none",
    }));
  }
  // CANDIDATE (Part B) -- charter points, projected LIVE from each entry's
  // own real lon/lat (projectMercator(), see its own comment above for why
  // this replaced an earlier static-snapshot version), same
  // CHARTER_POINT_STYLE (shared.js) the real map's own .charter-point
  // circles use for color/stroke, just a larger radius (11 vs the real
  // map's 5) -- checked, not assumed: 5 real-map units scales down to well
  // under 2 preview pixels at this ~0.32x preview scale, effectively
  // invisible; 11 was the smallest radius that still read as a clear dot
  // against a preview district-polygon fill.
  // All 23 points, Imboden included -- matching the real map.js exactly,
  // which draws every charter_points.json entry here with no IMBODEN_ID
  // filter (unlike the district/charter search index and the charter
  // preview below, which do exclude it -- see this file's own IMBODEN_ID
  // comment). Without Imboden here, this preview would show it as neither
  // a polygon (map_preview_geometry.json excludes it, same as the real
  // map -- it has no boundary) NOR a point, a real fidelity gap against
  // the actual map view this preview represents.
  const PREVIEW_CHARTER_RADIUS = 11;
  for (const c of charterPoints) {
    const [x, y] = projectMercator(c.lon, c.lat, MAP_MERCATOR_SCALE, MAP_MERCATOR_TRANSLATE);
    svg.appendChild(svgEl("circle", {
      class: "preview-charter-point",
      cx: x, cy: y, r: PREVIEW_CHARTER_RADIUS,
      fill: CHARTER_POINT_STYLE.color[mode],
      stroke: CHARTER_POINT_STYLE.strokeColor[mode],
      "stroke-width": CHARTER_POINT_STYLE.strokeWidth,
    }));
  }
  return svg;
}

function renderPreviews(districts, charterPoints, totals, mapGeometry, mode) {
  const slots = {
    "preview-statewide": () => buildStatewidePreview(totals, mode),
    // charterPoints reused as-is (the same array loadCharterPoints() already
    // returned for the Charter Schools preview below) -- buildMapPreview()
    // projects each one's own real lon/lat itself, no separate
    // preview-specific charter data needed.
    "preview-map": () => buildMapPreview(districts, mapGeometry, charterPoints, mode),
    "preview-ranked": () => buildRankedPreview(districts, mode),
    "preview-district": () => buildDistrictPreview(districts, mode),
    "preview-datatable": () => buildDataTablePreview(districts, mode),
    "preview-charter": () => buildCharterPreview(charterPoints, mode),
  };
  for (const [id, build] of Object.entries(slots)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = "";
    const content = build();
    if (content) el.appendChild(content);
  }
}

async function main() {
  const [districts, charterPoints, totals, mapGeometry] = await Promise.all([
    loadDistricts(),
    loadCharterPoints(),
    loadFullStatewideTotals(),
    loadMapPreviewGeometry(),
  ]);

  renderPreviews(districts, charterPoints, totals, mapGeometry, currentMode());

  // Preview colors (pctChangeColor/CHARTER_POINT_COLOR/typologyColor, all
  // JS-computed) don't track a live OS theme change via CSS alone -- same
  // reasoning/pattern as every other view's own listener (e.g.
  // charter-schools.js's).
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderPreviews(districts, charterPoints, totals, mapGeometry, currentMode());
  });
}

main();
