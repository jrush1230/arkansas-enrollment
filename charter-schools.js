// Standalone charter-school list -- deliberately NOT a district-style
// typology view. Charters get the same PRESENTATIONAL tools districts do
// (the shared sparkline, a simple signed percentage) but none of the
// analytical machinery built for districts (typology classification,
// baseline-vs-EFA-era CAGR split, the magnitude bucket filter, the
// three-icon caveat-mark system) -- that machinery assumes decades of
// stable, boundary-consistent history most charters don't have. Sort
// mechanics (COLUMNS array, compareRows/renderHead/renderBody) mirror
// school-districts.js's own pattern as closely as this page's much smaller
// column set allows; compareRows() itself isn't exported from that file
// (a local, not shared, function), so this is a parallel copy adapted to
// this page's own columns, not an import.
import {
  loadCharterPoints,
  sparklineSvg,
  formatSignedPct,
  glossaryAriaLabel,
  GLOSSARY,
  CHARTER_POINT_COLOR,
  efaYearOverYear,
  efaEraChange,
  schoolYearLabel,
  makeCaveatsMark,
  multiCampusIcon,
} from "./shared.js";

// multiCampusIcon() moved to shared.js -- promoted once the Charter Schools
// preview candidate (index.js) became a second view needing the exact same
// glyph (this project's own established "promote once a second view needs
// it" rule; see shared.js's own comment on this icon for the full design
// writeup). No more local svgEl()/SVG_NS copy here either -- this file no
// longer builds any raw SVG of its own.

// IMBODEN (0500061) IS DELIBERATELY EXCLUDED, not an oversight. It's one
// of charter_points.json's 23 entries (rendered as an orange point on the
// map, same as every genuine charter, since it has no district boundary
// polygon), but per this project's own build_charter_points_enrollment.py
// finding, it is NOT a charter SIS row at all -- it's one of districts.json's
// 235 current-boundary districts (real typology, baseline/EFA CAGR,
// data_status "ok"), just rendered as a map point for lack of geometry.
// Its enrollment even comes from a different source (districts.json's own
// series, not the charter SIS-row classification every other entry here
// uses) -- see that script's own comment for the full writeup. Counting
// it as one of "Arkansas's public charter schools" here would misrepresent
// a district as a charter, exactly the kind of misclassification this
// project has already found and fixed once (the charter/predecessor SIS-row
// mixup). It already has full analytical treatment (typology, CAGR, etc.)
// in every district view -- ranked list, data table, drill-down, the map's
// own district polygon-adjacent point -- so nothing about it goes
// unrepresented by excluding it here. This matches the statewide totals'
// own charter_count (22 in 2025-26, confirmed against
// full_statewide_total_by_year.json when charter_points.json's enrollment
// fields were first built), not the raw 23-entry length of the JSON file.
const IMBODEN_ID = "0500061";

// COLUMNS_BEFORE_YOY / COLUMNS_AFTER_YOY split the same way
// school-districts.js's own COLUMNS_BEFORE_YOY/COLUMNS_AFTER_YOY do, for the
// same reason: the 3 year-over-year columns in between are built inside
// main() from real data, not hardcoded, so their headers can't live in a
// static array declared before that data loads.
const COLUMNS_BEFORE_YOY = [
  { key: "name", label: "Charter school", type: "string" },
  // Not sortable, same reasoning as school-districts.html's own Trajectory
  // column -- a sparkline has no derivable sort order a reader could
  // predict from the header alone.
  { key: "sparkline", label: "Trajectory", type: "sparkline", sortable: false },
];
// latest_enrollment's own column is built inside main() too, not listed
// here -- its header needs the confirmed-uniform latest_year baked in
// ("Enrollment (2025-26)"), the same "derive from real data, don't
// hardcode" rule the year-over-year headers already follow.
const COLUMNS_AFTER_YOY = [
  { key: "efa_era_change", label: "EFA-era change", type: "pct", term: "charterEfaEraChange" },
  { key: "has_map_caveat", label: "Notes", type: "bool" },
];

function fmtInt(n) {
  return n == null ? "—" : n.toLocaleString("en-US");
}
function fmtPct(v) {
  return v == null ? "—" : `${formatSignedPct(v)}%`;
}

// Looks up a charter's own year-over-year pair by fromYear/toYear VALUES,
// not array position -- deliberate, not incidental. Charters' EFA-era
// coverage isn't uniform the way districts' is (4 of 22 opened in
// 2024-25 have only 2 EFA-era years), so efaYearOverYear() returns a
// LEFT-TRUNCATED array for those 4: a charter with only 2024-2025 data
// returns exactly one pair, {fromYear:2024,toYear:2025} -- which is the
// *last* of the 3 possible column pairs, not pairs[0]. Indexing
// positionally (the way school-districts.js safely does, since every
// district's array is the same length) would put that value under the
// wrong header for those 4 charters. Matching by the actual year values
// instead is correct regardless of how many pairs a given charter has.
function findYoyPair(charter, fromYear, toYear) {
  return efaYearOverYear(charter).find((p) => p.fromYear === fromYear && p.toYear === toYear);
}

// Explains a "—" year-over-year cell rather than leaving a reader to find
// the generic table-note before understanding why. Derives the opening
// year from the charter's own series data (series[0], the same
// first-year lookup trajectoryCellLabel() below already relies on), not
// a hardcoded "2024-25" -- stays correct if a future data refresh adds a
// charter that opened in some other year. Confirmed directly against
// charter_points.json that every "—" across all 22 charters today traces
// to exactly this cause (a charter's history starting after this
// column's fromYear) and not some other data gap, so "opened in" is a
// genuinely verified explanation here, not an assumption.
function yoyDashTitle(charter) {
  const firstYear = charter.series[0]?.year;
  return `No data — ${charter.name} opened in ${schoolYearLabel(firstYear)}.`;
}

// Flags EFA-era change for a charter whose figure rests on only 1
// year-over-year comparison instead of the 3 backing every other
// charter's -- same underlying cause and same data (efaYearOverYear())
// as yoyDashTitle() above, just phrased for this column: the number
// itself is real (not a dash), but visually identical to a
// fully-supported figure without this note. Only called for charters
// where efaYearOverYear() returns fewer than 3 pairs.
function thinEvidenceTitle(charter) {
  const pairs = efaYearOverYear(charter);
  const n = pairs.length;
  const range = `${schoolYearLabel(pairs[0].fromYear)} → ${schoolYearLabel(pairs[n - 1].toYear)}`;
  return `Based on only ${n} year-over-year comparison${n === 1 ? "" : "s"} (${range}), not the 3 most charters have — ` +
    `${charter.name} opened in ${schoolYearLabel(charter.series[0]?.year)}.`;
}

function compareRows(a, b, col, dir) {
  // efaYoy isn't a real field on the row object -- it's this specific
  // pair's pct, looked up fresh via findYoyPair() above (see that
  // function's own comment for why by-value, not by-index).
  if (col.type === "efaYoy") {
    const av = findYoyPair(a, col.fromYear, col.toYear)?.pct;
    const bv = findYoyPair(b, col.fromYear, col.toYear)?.pct;
    const aNull = av == null, bNull = bv == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp = av - bv;
    return dir === "asc" ? cmp : -cmp;
  }

  const av = a[col.key], bv = b[col.key];
  const aNull = av == null, bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls always sort last, regardless of direction -- same convention every numeric column in this project uses
  if (bNull) return -1;

  let cmp;
  if (col.type === "string") cmp = String(av).localeCompare(String(bv));
  else if (col.type === "bool") cmp = av === bv ? 0 : av ? 1 : -1;
  else cmp = av - bv;
  return dir === "asc" ? cmp : -cmp;
}

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Cell-scoped accessible label for the Trajectory sparkline -- same
// title-attribute + visually-hidden-span split every other decorative
// visual-plus-text cell in this project uses (school-districts.js's own
// Trajectory/Notes cells). The sparkline SVG itself is aria-hidden below;
// this is the real accessible content for keyboard/screen-reader users.
function trajectoryCellLabel(p) {
  const first = p.series[0], last = p.series[p.series.length - 1];
  if (!first || !last) return "No enrollment history available.";
  if (first.year === last.year) return `${first.enrollment.toLocaleString("en-US")} students in ${first.year}-${String(first.year + 1).slice(2)}, first year of data.`;
  return `${first.enrollment.toLocaleString("en-US")} students in ${first.year}-${String(first.year + 1).slice(2)} to ` +
    `${last.enrollment.toLocaleString("en-US")} in ${last.year}-${String(last.year + 1).slice(2)}.`;
}

function makeTrajectoryCell(p, mode) {
  const td = document.createElement("td");
  td.className = "cell-trajectory";
  const label = trajectoryCellLabel(p);
  td.title = label;
  // strokeColor override (shared.js's sparklineSvg() third arg) -- a
  // charter has no `typology` field for that function's default
  // typologyColor()-based stroke to key off, so every charter's line
  // uses the project's existing charter identity color instead (the
  // same orange the map's charter points and the statewide line's
  // charter series already use) rather than falling through to
  // typologyColor(undefined, mode)'s "insufficient_history" gray, which
  // would make every single row look like a data problem.
  const svg = sparklineSvg(p, mode, CHARTER_POINT_COLOR[mode]);
  svg.setAttribute("aria-hidden", "true");
  td.appendChild(svg);
  const sr = document.createElement("span");
  sr.className = "visually-hidden";
  sr.textContent = label;
  td.appendChild(sr);
  return td;
}

// Same cell-level structure school-districts.js's own makeCaveatsCell() uses:
// a cell-level title + a cell-level .visually-hidden span (the real
// accessible-tree content for screen readers, since makeCaveatsMark()'s
// own wrapper is aria-hidden -- decorative, mouse-hover-only) wrapping
// one or more per-mark makeCaveatsMark() icons. Only one possible mark
// here (map_caveat present or not), unlike the district table's up-to-3,
// but the same structure keeps this consistent with that established
// pattern rather than a simpler one-off. Reuses map_caveat's own text
// verbatim for BOTH the title and the visually-hidden span -- that text
// already names the specific other campuses per charter (e.g. "also
// operates campuses in Maumelle..."), more useful than a generic
// "multi-campus" string would be, and this project's standing rule is
// to reuse existing specific text rather than write new generic text
// when the specific version already exists. Genuinely empty (no icon,
// no dash, no text) for a single-campus charter -- matches the district
// table's own Notes column precedent exactly (nothing renders for an
// inactive flag there either), not a placeholder omission.
function makeNotesCell(p) {
  const td = document.createElement("td");
  td.className = "cell-notes";
  if (p.map_caveat) {
    td.title = p.map_caveat;
    td.appendChild(makeCaveatsMark(multiCampusIcon(), p.map_caveat));
    const sr = document.createElement("span");
    sr.className = "visually-hidden";
    sr.textContent = p.map_caveat;
    td.appendChild(sr);
  }
  return td;
}

async function main() {
  const allPoints = await loadCharterPoints();
  // has_map_caveat/efa_era_change: real, sortable fields derived once
  // here rather than computed inline in compareRows() -- keeps
  // compareRows() itself mostly generic (plain a[col.key] lookup) for
  // everything except the 3 year-over-year columns, whose per-pair value
  // genuinely can't be a static field (see findYoyPair()'s own comment).
  const charters = allPoints
    .filter((p) => p.id !== IMBODEN_ID)
    .map((p) => ({ ...p, has_map_caveat: !!p.map_caveat, efa_era_change: efaEraChange(p) }));

  // Column headers for the 3 year-over-year pairs are built from a real
  // charter's own efaYearOverYear() output, not hardcoded -- same
  // approach school-districts.js uses (districts[0], "since the EFA-year range
  // is universal across all 235"), adapted here since charter coverage
  // ISN'T universal (4 of 22 have only 2 EFA years): explicitly finds a
  // charter with the full 3-pair/4-year window rather than assuming
  // charters[0] happens to be one, since which entry sorts first isn't
  // guaranteed to have full coverage in a future data refresh. Every
  // charter with full coverage produces identical pair years (2022-2025
  // is the same fixed EFA window for all of them), so any one of them is
  // an equally valid source for the header labels.
  const fullCoverageCharter = charters.find((c) => efaYearOverYear(c).length === 3);
  const yoyColumns = fullCoverageCharter
    ? efaYearOverYear(fullCoverageCharter).map((pair, i) => ({
        key: `efa_yoy_${i}`,
        label: `${schoolYearLabel(pair.fromYear).slice(2)} → ${schoolYearLabel(pair.toYear).slice(2)}`,
        type: "efaYoy",
        fromYear: pair.fromYear,
        toYear: pair.toYear,
      }))
    : [];

  // latest_year is confirmed uniform across all 22 charters today (2025
  // for every one, checked directly against charter_points.json before
  // this was written) -- moved into the header once ("25-26 Enrollment")
  // instead of repeated on all 22 rows. .slice(2) drops the "20" the
  // same way the year-over-year headers below already do ("22-23 →
  // 23-24," not "2022-23 → 2023-24") -- same shortening rule applied
  // consistently, not invented fresh for this one header. Computed as a
  // majority, not just charters[0].latest_year, so this degrades
  // sensibly rather than silently mislabeling everything if a future
  // data refresh ever breaks that uniformity: renderBody() below keeps
  // the parenthetical year on any row whose OWN latest_year doesn't
  // match the header's, so an outdated figure stays visibly flagged
  // instead of blending in under a header that no longer applies to it.
  const yearCounts = new Map();
  for (const c of charters) yearCounts.set(c.latest_year, (yearCounts.get(c.latest_year) ?? 0) + 1);
  const majorityYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const enrollmentColumn = {
    key: "latest_enrollment",
    label: `${schoolYearLabel(majorityYear).slice(2)} Enrollment`,
    type: "int",
  };

  const COLUMNS = [...COLUMNS_BEFORE_YOY, ...yoyColumns, enrollmentColumn, ...COLUMNS_AFTER_YOY];

  let sortKey = "name";
  let sortDir = "asc";

  function renderBody() {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const rows = [...charters].sort((a, b) => compareRows(a, b, col, sortDir));
    const mode = currentMode();
    const tbody = document.getElementById("charter-table-body");
    tbody.textContent = "";
    for (const p of rows) {
      const tr = document.createElement("tr");
      for (const c of COLUMNS) {
        let td = document.createElement("td");
        if (c.key === "name") {
          td.textContent = p.name;
        } else if (c.type === "sparkline") {
          td = makeTrajectoryCell(p, mode);
        } else if (c.type === "efaYoy") {
          const pair = findYoyPair(p, c.fromYear, c.toYear);
          td.textContent = fmtPct(pair?.pct);
          // Only the dash case gets an explanation -- a real value's own
          // meaning is already covered by the column header + its
          // glossary tooltip, same as every other populated cell in this
          // table.
          if (!pair) {
            const explanation = yoyDashTitle(p);
            td.title = explanation;
            const sr = document.createElement("span");
            sr.className = "visually-hidden";
            sr.textContent = explanation;
            td.appendChild(sr);
          }
        } else if (c.key === "latest_enrollment") {
          // Bare number when this row's own latest_year matches the
          // header's (true for all 22 today) -- the parenthetical only
          // reappears per-row for a charter whose year DIFFERS from the
          // header, so a stale figure doesn't silently read as current.
          td.textContent = p.latest_enrollment == null
            ? "—"
            : p.latest_year === majorityYear
              ? fmtInt(p.latest_enrollment)
              : `${fmtInt(p.latest_enrollment)} (${schoolYearLabel(p.latest_year)})`;
        } else if (c.type === "pct") {
          td.textContent = fmtPct(p[c.key]);
          // efa_era_change only -- flags rows where the figure rests on
          // fewer than the full 3 year-over-year comparisons (the same 4
          // charters the efaYoy dash cells above explain), so a reader
          // doesn't mistake thin evidence for the same footing as every
          // other charter's number.
          if (c.key === "efa_era_change" && efaYearOverYear(p).length < 3 && p[c.key] != null) {
            const explanation = thinEvidenceTitle(p);
            td.title = explanation;
            const sr = document.createElement("span");
            sr.className = "visually-hidden";
            sr.textContent = explanation;
            td.appendChild(sr);
          }
        } else if (c.key === "has_map_caveat") {
          td = makeNotesCell(p);
        } else {
          td.textContent = p[c.key] ?? "—";
        }
        if (c.key === sortKey) td.classList.add("col-sorted");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderHead() {
    const row = document.getElementById("table-head-row");
    row.textContent = "";
    for (const c of COLUMNS) {
      const th = document.createElement("th");
      th.textContent = c.label;

      if (c.sortable === false) {
        th.className = "col-header-static";
        row.appendChild(th);
        continue;
      }

      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.setAttribute("aria-label", glossaryAriaLabel(`Sort by ${c.label}`, c.term));
      if (c.term) th.title = GLOSSARY[c.term];
      const isActive = sortKey === c.key;
      if (isActive) th.classList.add("col-sorted");
      const arrow = document.createElement("span");
      arrow.className = isActive ? "sort-arrow active" : "sort-arrow";
      arrow.textContent = isActive ? (sortDir === "asc" ? "↑" : "↓") : "⇅";
      arrow.setAttribute("aria-hidden", "true");
      th.appendChild(arrow);
      const activate = () => {
        if (sortKey === c.key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = c.key; sortDir = "asc"; }
        renderHead();
        renderBody();
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); activate(); }
      });
      row.appendChild(th);
    }
  }

  renderHead();
  renderBody();

  // Sparkline strokes are JS-computed (CHARTER_POINT_COLOR[mode]), so a
  // live OS theme change needs a re-render to pick up the new mode --
  // same reasoning/pattern as school-districts.js's own listener.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderBody();
  });
}

main();
