import {
  loadDistricts,
  typologyColor,
  typologyLabel,
  districtAriaLabel,
  districtShapeClause,
  formatCagr,
  formatSignedPct,
  eraOf,
  eraLabel,
  schoolYearLabel,
  shortName,
  COVID_YEARS,
  EFA_START,
  attachGlossaryNote,
} from "./shared.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARGIN = { top: 28, right: 20, bottom: 36, left: 56 };
const VB_W = 880, VB_H = 420;
const PLOT_W = VB_W - MARGIN.left - MARGIN.right;
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom;

// Predecessor names/merger years for the 7 boundary-change districts --
// districts.json only carries current_boundary_since (a year), not who was
// absorbed. Sourced from the upstream pipeline's crosswalk.csv
// (predecessor_leaid -> successor_leaid, effective_year >= 2013) joined to
// lea_panel_arkansas.csv for the predecessor's name, as of 2026-07-12.
// Static: these are historical mergers, not expected to change, so this
// isn't derived at build time the way districts.json's own fields are.
const PREDECESSOR_BY_ID = {
  "0512510": { predecessor: "Norphlet", year: 2014 },  // Smackover Norphlet
  "0506060": { predecessor: "Stephens", year: 2014 },  // Camden Fairview
  "0500044": { predecessor: "Stephens", year: 2014 },  // Magnolia
  "0500030": { predecessor: "Stephens", year: 2014 },  // Nevada
  "0507170": { predecessor: "Hartford", year: 2015 },  // Hackett
  "0508040": { predecessor: "Hughes", year: 2015 },    // West Memphis
  "0500026": { predecessor: "Dollarway", year: 2021 }, // Pine Bluff
};

function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

function fmtPct(v) {
  return typeof v === "number" ? `${formatSignedPct(v)}%` : "—";
}

function fmtBool(v) {
  return v == null ? "—" : v ? "Yes" : "No";
}

function fmtMagnitude(v) {
  return v ? v[0].toUpperCase() + v.slice(1) : "";
}

function summarySentence(d) {
  let s = `${shortName(d.name)} ${districtShapeClause(d)}.`;
  if (!d.typology) return s;
  if (d.reversal_magnitude) {
    s += ` This was a ${d.reversal_magnitude} reversal.`;
  }
  if (typeof d.covid_drop_pct === "number" && Math.abs(d.covid_drop_pct) >= 0.03) {
    const pctText = Math.abs(Math.round(d.covid_drop_pct * 100));
    if (d.covid_drop_pct < 0) {
      s += ` Enrollment dropped ${pctText}% during the COVID shock and ` +
        (d.recovered_from_covid ? "has since recovered to its pre-COVID level." : "has not yet recovered to its pre-COVID level.");
    } else {
      s += ` Enrollment rose ${pctText}% during the COVID shock years.`;
    }
  }
  return s;
}

function el(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// "nice" tick step for a given rough range -- same helper as the
// statewide line's chart, single-district numbers just need their own
// call site since the range differs per district.
function niceStep(rangeSize, targetTicks) {
  const rough = rangeSize / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

function renderError(title, body) {
  document.getElementById("page-title").textContent = title;
  const root = document.getElementById("content-root");
  root.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "viz-root error-state";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;
  const link = document.createElement("a");
  link.href = "district-rankings.html";
  link.textContent = "Go to District Rankings";
  wrap.appendChild(h2);
  wrap.appendChild(p);
  wrap.appendChild(link);
  root.appendChild(wrap);
}

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderChart(svg, tooltip, d, boundary) {
  svg.textContent = "";
  const points = d.series
    .map((p) => ({ year: parseInt(p.year, 10), enrollment: p.enrollment, era: eraOf(parseInt(p.year, 10)) }))
    .sort((a, b) => a.year - b.year);

  const minYear = points[0].year, maxYear = points[points.length - 1].year;
  const values = points.map((p) => p.enrollment);
  const dataMin = Math.min(...values), dataMax = Math.max(...values);
  const pad = (dataMax - dataMin) * 0.15 || dataMax * 0.05;
  const step = niceStep(dataMax + pad - (dataMin - pad), 5);
  const yMin = Math.max(0, Math.floor((dataMin - pad) / step) * step);
  const yMax = Math.ceil((dataMax + pad) / step) * step;

  const x = (year) => MARGIN.left + ((year - minYear) / (maxYear - minYear || 1)) * PLOT_W;
  const y = (val) => MARGIN.top + PLOT_H - ((val - yMin) / (yMax - yMin)) * PLOT_H;
  const halfStep = points.length > 1 ? (x(minYear + 1) - x(minYear)) / 2 : 20;

  // --- era bands (same tokens/rendering as the statewide line) ---
  const bandRanges = [
    { era: "covid", from: Math.max(COVID_YEARS[0], minYear), to: Math.min(COVID_YEARS[COVID_YEARS.length - 1], maxYear) },
    { era: "efa", from: Math.max(EFA_START, minYear), to: maxYear },
  ];
  for (const b of bandRanges) {
    if (b.from > b.to) continue;
    const x0 = x(b.from) - halfStep;
    const x1 = x(b.to) + halfStep;
    svg.appendChild(el("rect", {
      x: x0, y: MARGIN.top, width: x1 - x0, height: PLOT_H,
      fill: b.era === "covid" ? "var(--band-covid)" : "var(--band-efa)",
    }));
    const label = svg.appendChild(el("text", { class: "band-label", x: x0 + 6, y: MARGIN.top + 14 }));
    label.textContent = eraLabel(b.era);
  }

  // --- gridlines + y ticks ---
  for (let v = yMin; v <= yMax + 1e-6; v += step) {
    svg.appendChild(el("line", {
      class: "gridline", x1: MARGIN.left, x2: VB_W - MARGIN.right, y1: y(v), y2: y(v),
    }));
    const t = svg.appendChild(el("text", {
      class: "axis-label", x: MARGIN.left - 8, y: y(v) + 4, "text-anchor": "end",
    }));
    t.textContent = fmtInt(v);
  }

  // --- x-axis baseline + year ticks ---
  svg.appendChild(el("line", {
    class: "baseline-rule",
    x1: MARGIN.left, x2: VB_W - MARGIN.right, y1: MARGIN.top + PLOT_H, y2: MARGIN.top + PLOT_H,
  }));
  for (const p of points) {
    const t = svg.appendChild(el("text", {
      class: "axis-label", x: x(p.year), y: MARGIN.top + PLOT_H + 18, "text-anchor": "middle",
    }));
    t.textContent = String(p.year);
  }

  // --- line, split at the merger year for boundary-change districts ---
  // A single unbroken line here would silently imply "this district just
  // grew" at the merger year, when really a second entity's students
  // joined all at once. The pre-merger segment gets a dashed/faded style
  // (it's a different, smaller boundary's numbers) and a vertical dashed
  // seam + label marks exactly where the merger happened, in addition to
  // the visual break in the line style itself.
  const lineColor = typologyColor(d.typology, currentMode());
  if (boundary) {
    const seamYear = boundary.year;
    const preIdx = points.findIndex((p) => p.year === seamYear);
    if (preIdx > 0) {
      // Segments share exactly the seamYear point (no gap, no double-draw).
      // The dashed segment runs through and includes the jump itself --
      // that jump IS the merger artifact, not organic growth, so it gets
      // the "this isn't what it looks like" treatment; the solid segment
      // starts at the merger and is the current entity's real trend line.
      const prePoints = points.slice(0, preIdx + 1); // minYear..seamYear inclusive
      const postPoints = points.slice(preIdx);        // seamYear..maxYear inclusive
      const preD = prePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p.enrollment)}`).join(" ");
      const postD = postPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p.enrollment)}`).join(" ");
      svg.appendChild(el("path", { class: "line-mark pre-merger", d: preD, stroke: lineColor }));
      svg.appendChild(el("path", { class: "line-mark", d: postD, stroke: lineColor }));
    } else {
      const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p.enrollment)}`).join(" ");
      svg.appendChild(el("path", { class: "line-mark", d: pathD, stroke: lineColor }));
    }

    const seamX = x(seamYear) - halfStep;
    svg.appendChild(el("line", {
      class: "seam-line", x1: seamX, x2: seamX, y1: MARGIN.top, y2: MARGIN.top + PLOT_H,
    }));
    const seamLabel = svg.appendChild(el("text", {
      class: "seam-label", x: seamX + 5, y: MARGIN.top + PLOT_H - 6,
    }));
    seamLabel.textContent = `Absorbed ${boundary.predecessor}, ${seamYear} →`;
  } else {
    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p.enrollment)}`).join(" ");
    svg.appendChild(el("path", { class: "line-mark", d: pathD, stroke: lineColor }));
  }

  // --- endpoint marker + direct label ---
  const last = points[points.length - 1];
  svg.appendChild(el("circle", { class: "end-dot", cx: x(last.year), cy: y(last.enrollment), r: 4, fill: lineColor }));
  const endLabel = svg.appendChild(el("text", {
    class: "end-label", x: x(last.year), y: y(last.enrollment) - 12, "text-anchor": "end",
  }));
  endLabel.textContent = fmtInt(last.enrollment);

  // --- crosshair + hover dot ---
  const crosshair = el("line", { class: "crosshair", x1: 0, x2: 0, y1: MARGIN.top, y2: MARGIN.top + PLOT_H });
  svg.appendChild(crosshair);
  const hoverDot = el("circle", { class: "hover-dot", r: 5, fill: lineColor });
  svg.appendChild(hoverDot);

  function showTooltip(p) {
    crosshair.setAttribute("x1", x(p.year));
    crosshair.setAttribute("x2", x(p.year));
    crosshair.style.opacity = 1;
    hoverDot.setAttribute("cx", x(p.year));
    hoverDot.setAttribute("cy", y(p.enrollment));
    hoverDot.style.opacity = 1;

    tooltip.innerHTML = "";
    const yearEl = document.createElement("div");
    yearEl.className = "t-year";
    yearEl.textContent = schoolYearLabel(p.year);
    const valEl = document.createElement("div");
    valEl.className = "t-value";
    valEl.textContent = fmtInt(p.enrollment) + " students";
    const eraEl = document.createElement("div");
    eraEl.className = "t-era";
    eraEl.textContent = eraLabel(p.era) + (boundary && p.year < boundary.year ? ` (pre-merger)` : "");
    tooltip.appendChild(yearEl);
    tooltip.appendChild(valEl);
    tooltip.appendChild(eraEl);
    tooltip.style.opacity = 1;

    const rootRect = svg.parentElement.getBoundingClientRect();
    const px = (x(p.year) / VB_W) * rootRect.width;
    tooltip.style.left = Math.min(px + 12, rootRect.width - 170) + "px";
    tooltip.style.top = "8px";
  }
  function hideTooltip() {
    crosshair.style.opacity = 0;
    hoverDot.style.opacity = 0;
    tooltip.style.opacity = 0;
  }

  const hitRect = el("rect", { x: MARGIN.left, y: MARGIN.top, width: PLOT_W, height: PLOT_H, fill: "transparent" });
  hitRect.addEventListener("pointermove", (evt) => {
    const rect = svg.getBoundingClientRect();
    const svgX = ((evt.clientX - rect.left) / rect.width) * VB_W;
    const yearFloat = minYear + ((svgX - MARGIN.left) / PLOT_W) * (maxYear - minYear || 1);
    const nearest = points.reduce((a, b) => Math.abs(b.year - yearFloat) < Math.abs(a.year - yearFloat) ? b : a);
    showTooltip(nearest);
  });
  hitRect.addEventListener("pointerleave", hideTooltip);
  svg.appendChild(hitRect);

  for (const p of points) {
    const hit = el("circle", {
      class: "hit-point", cx: x(p.year), cy: y(p.enrollment), r: 12, tabindex: "0",
      role: "img",
      "aria-label": `${schoolYearLabel(p.year)}: ${fmtInt(p.enrollment)} students, ${eraLabel(p.era)}` +
        (boundary && p.year < boundary.year ? `, before the ${boundary.year} merger with ${boundary.predecessor}` : ""),
    });
    hit.addEventListener("focus", () => showTooltip(p));
    hit.addEventListener("blur", hideTooltip);
    hit.addEventListener("pointerenter", () => showTooltip(p));
    svg.appendChild(hit);
  }
}

function renderDistrict(d) {
  const boundary = d.boundary_change_within_series ? PREDECESSOR_BY_ID[d.id] : null;
  const mode = currentMode();

  // Full legal name here, deliberately NOT shortName() -- this is a
  // single-district detail page, not a dense list/table row, so there's
  // no space pressure or cross-row collision risk driving the shortened
  // form elsewhere. The full name (e.g. "WESTSIDE CONSOLIDATED SCHOOL
  // DISTRICT (Craighead)") also disambiguates immediately for a
  // first-time visitor in a way "WESTSIDE" alone wouldn't. The summary
  // paragraph below still uses shortName() for natural-reading prose
  // ("WESTSIDE grew through...") -- heading stays precise/complete, body
  // text reads naturally without repeating the full name every sentence.
  document.getElementById("page-title").textContent = d.name;
  // Was stuck on the static "District detail — Arkansas K-12 enrollment"
  // for every district (drill-down.html's <title> tag was never updated
  // at runtime) -- a real gap for anyone with several drill-down tabs
  // open, or bookmarking/sharing a specific district's tab. Matches the
  // suffix convention every other view's own <title> already uses.
  document.title = `${d.name} — Arkansas K-12 enrollment`;
  // years/minYear/maxYear feed the EFA-era legend label and the chart's own
  // aria-label further below (not just the removed page-subtitle line that
  // used to sit here) -- kept even though this function no longer sets any
  // subtitle text itself.
  const years = d.series.map((p) => parseInt(p.year, 10));
  const minYear = Math.min(...years), maxYear = Math.max(...years);

  const root = document.getElementById("content-root");
  root.textContent = "";
  const viz = document.createElement("div");
  viz.className = "viz-root";
  viz.id = "chart-root";

  // --- identity row ---
  const identity = document.createElement("div");
  identity.className = "identity-row";
  const swatch = document.createElement("span");
  swatch.className = "identity-swatch";
  swatch.style.background = typologyColor(d.typology, mode);
  const typo = document.createElement("span");
  typo.className = "identity-typology";
  typo.style.color = typologyColor(d.typology, mode);
  typo.textContent = typologyLabel(d.typology);
  // Lighter-weight than removing the raw category name (this is the one
  // place in the app it's still shown, which matters for anyone wanting
  // to cite a district's exact classification) -- just makes clear on
  // hover that its plain-language meaning is right below it, now that
  // the summary sentence sits immediately adjacent instead of scrolled
  // past the chart.
  typo.title = "Trajectory category: see the description alongside it";
  identity.appendChild(swatch);
  identity.appendChild(typo);
  // Order matches the ranked list/data table's established caveat order
  // (thin baseline, reversal magnitude, boundary changed) -- reversal
  // magnitude is new here (moved out of the key-stats row, see below);
  // the other two existed already but in a different order, reordered
  // to match now that all three sit side by side.
  if (d.baseline_years_thin) {
    const badge = document.createElement("span");
    badge.className = "caveat-badge";
    badge.textContent = "Thin baseline";
    identity.appendChild(badge);
  }
  if (d.reversal_magnitude) {
    const badge = document.createElement("span");
    badge.className = "caveat-badge";
    badge.textContent = `${fmtMagnitude(d.reversal_magnitude)} reversal`;
    identity.appendChild(badge);
  }
  if (d.boundary_change_within_series) {
    const badge = document.createElement("span");
    badge.className = "caveat-badge";
    badge.textContent = `Boundary changed ${d.current_boundary_since}`;
    identity.appendChild(badge);
  }
  identity.setAttribute("role", "img");
  identity.setAttribute("aria-label", districtAriaLabel(d));
  viz.appendChild(identity);

  // --- plain-language summary ---
  // Moved up to sit immediately adjacent to the identity row (was
  // previously appended after the chart and key stats, far enough below
  // the identity row that a reader saw the technical category name at
  // the top with its explanation scrolled well past the chart). Now a
  // reader sees the term and its meaning together, in one glance --
  // exactly the pairing districtShapeClause()/typologyLabel() are meant
  // to provide (see shared.js). summarySentence(d) doesn't depend on
  // `boundary` or anything computed further down, so nothing else needed
  // to move with it.
  const summary = document.createElement("p");
  summary.className = "summary-text";
  summary.textContent = summarySentence(d);
  viz.appendChild(summary);

  // --- legend ---
  // Year ranges use the same "drop the 20, arrow between the two-digit
  // pairs" convention school-districts.js's own dynamic column headers already
  // established (schoolYearLabel(year).slice(2)) -- not a new format
  // invented for this legend. Chosen after the full text ("Baseline
  // (2013-14 through 2019-20)") was measured to overflow the legend's
  // fixed-width container even at maximum desktop width, not just on
  // narrow viewports.
  const legend = document.createElement("div");
  legend.className = "legend";
  const legendItems = [
    ["baseline", `Baseline (${schoolYearLabel(2013).slice(2)} → ${schoolYearLabel(2019).slice(2)})`],
    ["covid", `COVID shock (${schoolYearLabel(2020).slice(2)} → ${schoolYearLabel(2021).slice(2)})`],
    ["efa", `EFA era (${schoolYearLabel(2022).slice(2)} → ${schoolYearLabel(maxYear).slice(2)})`],
  ];
  if (boundary) legendItems.push(["seam", `Boundary change (${boundary.year})`]);
  for (const [cls, text] of legendItems) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = `legend-swatch ${cls}`;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(text));
    legend.appendChild(item);
  }
  viz.appendChild(legend);

  // --- chart ---
  const chartWrap = document.createElement("div");
  chartWrap.style.position = "relative";
  const svg = el("svg", {
    class: "chart", viewBox: `0 0 ${VB_W} ${VB_H}`, role: "img",
    "aria-label": `Line chart of ${d.name}'s fall enrollment, ${minYear} to ${maxYear}`,
  });
  svg.setAttribute("id", "chart-svg");
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.id = "tooltip";
  chartWrap.appendChild(svg);
  chartWrap.appendChild(tooltip);
  viz.appendChild(chartWrap);
  renderChart(svg, tooltip, d, boundary);

  // --- key stats: one row of 5, labels reconciled against the data
  // table's own headers (the most recently-settled cross-view naming
  // convention) -- "Baseline CAGR" and "EFA CAGR" already matched;
  // "COVID-era change" -> "COVID drop" (covid_drop_pct is structurally
  // always <= 0, a peak-to-trough decline, so "drop" is more accurate,
  // not just shorter) and "EFA-era total change" -> "EFA change" (the
  // data table's REAL label -- it reads "EFA-era change" only until you
  // check school-districts.js, which shortened it to "EFA change" for its own
  // column-width reasons; adopted here too since a 5-cell single row
  // benefits from the same short, terse register for the same reason).
  // "Recovered from COVID" -> "COVID recovery": the only one of the 5
  // with no cross-view precedent (this field appears nowhere else in the
  // app), shortened for grammatical consistency with the other four
  // noun-phrase headings, not brevity for its own sake.
  //
  // reversal_magnitude (shown "if applicable" in the old stacked list)
  // is NOT a 6th column here -- these 5 are a fixed set every district
  // has a value for. Moved instead into the identity row's existing
  // caveat-badge pattern below, alongside boundary_change_within_series
  // and baseline_years_thin (the two caveats that already lived there),
  // using the exact "<Magnitude> reversal" wording the ranked list/data
  // table's reversal icon titles already established.
  // term keys into shared.js's GLOSSARY -- attachGlossaryNote() below
  // wires each dt's hover title + a visually-hidden definition span (dt
  // isn't an interactive/focusable element with its own aria-label the
  // way the data table's sortable <th> is, so the simpler "append hidden
  // text" mechanism applies here, not glossaryAriaLabel()'s aria-label
  // rewrite -- see shared.js for why those are two different cases).
  const statList = [
    ["Baseline CAGR", typeof d.baseline_cagr === "number" ? formatCagr(d.baseline_cagr) : "—", "cagr"],
    ["COVID drop", fmtPct(d.covid_drop_pct), "covidDrop"],
    ["COVID recovery", fmtBool(d.recovered_from_covid), "covidRecovery"],
    ["EFA CAGR", typeof d.efa_cagr === "number" ? formatCagr(d.efa_cagr) : "—", "cagr"],
    ["EFA change", fmtPct(d.pct_change_efa_era), "efaChange"],
  ];
  const dl = document.createElement("dl");
  dl.className = "stat-grid";
  for (const [label, value, term] of statList) {
    const stat = document.createElement("div");
    stat.className = "stat";
    const dt = document.createElement("dt");
    dt.textContent = label;
    attachGlossaryNote(dt, term);
    const dd = document.createElement("dd");
    dd.textContent = value;
    stat.appendChild(dt);
    stat.appendChild(dd);
    dl.appendChild(stat);
  }
  viz.appendChild(dl);

  // --- stat-row note: persistent, always-visible definitions for the 5
  // fields above -- this page had no persistent explanation of them at
  // all before this (only the per-dt hover tooltip just added), which
  // reaches mouse/keyboard/screen-reader users but not anyone viewing a
  // screenshot or on a touch device with no hover. Wording matches
  // shared.js's GLOSSARY (cagr/covidDrop/covidRecovery/efaChange) --
  // keep in sync if either changes.
  const statNote = document.createElement("p");
  statNote.className = "stat-note";
  statNote.textContent =
    "Baseline CAGR and EFA CAGR are each era's average yearly rate of change, accounting for " +
    "compounding, not the same as a simple total percentage. COVID drop is percent change from " +
    "the district's 2019-20 enrollment (the last year before the pandemic) to its lowest point " +
    "during the COVID shock (usually negative, but not always). COVID recovery is whether " +
    "enrollment had climbed back to within 2% of its 2019-20 enrollment by the first EFA year. " +
    "EFA change is the simple total percentage change across the EFA era, not an annualized rate like CAGR.";
  viz.appendChild(statNote);

  // --- boundary-change note ---
  if (boundary) {
    const note = document.createElement("p");
    note.className = "boundary-note";
    note.textContent =
      `This district absorbed ${boundary.predecessor} in ${boundary.year}. Enrollment before ${boundary.year} on the ` +
      `chart reflects ${shortName(d.name)}'s boundary as it existed before that merger. It does not include ` +
      `${boundary.predecessor}'s students. The jump at ${boundary.year} marks the merger itself, not a sudden ` +
      `change in the underlying population. See METHODOLOGY.md for the full list of boundary-change districts.`;
    viz.appendChild(note);
  }

  root.appendChild(viz);
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    renderError(
      "No district specified",
      "This page needs a district in the URL (e.g. drill-down.html?id=0511700). Pick one from the district rankings instead."
    );
    return;
  }

  let districts;
  try {
    districts = await loadDistricts();
  } catch (err) {
    renderError(
      "Couldn't load district data",
      "Something went wrong fetching the underlying data file. Try reloading, or go back to the district rankings."
    );
    return;
  }

  const d = districts.find((x) => x.id === id);
  if (!d) {
    renderError(
      "District not found",
      `No district matches id "${id}". Pick one from the district rankings instead.`
    );
    return;
  }

  renderDistrict(d);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderDistrict(d));
}

main();
