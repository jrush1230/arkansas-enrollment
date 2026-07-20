import {
  loadDistricts,
  loadCharterPoints,
  districtShapeSentence,
  mapStrokeFor,
  CHARTER_POINT_STYLE,
  charterPointAriaLabel,
  charterPointEnrollmentText,
  districtTrajectoryText,
  districtEnrollmentText,
  formatSignedPct,
  pctChangeColor,
  PCT_CLIP,
} from "./shared.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const VB_W = 880, VB_H = 620;
const TOPOJSON_URL = new URL("./data/arkansas_districts.topojson", import.meta.url);

function el(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// Signed ring area via the shoelace formula -- positive = counter-
// clockwise, negative = clockwise.
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

// Normalizes ring winding in place. NOT an RFC 7946 CCW-exterior fix --
// tried that first and it broke all 234 districts instead of the original
// 5, which is what exposed the real problem: this pipeline's every
// single-Polygon district (229 of them, all rendering fine) came out of
// pyshp/topojson.feature() with a CLOCKWISE exterior, so CW, not CCW, is
// this pipeline's working convention (confirmed by checking Pottsville,
// Little Rock, Marvell -- all negative/CW signed area). The actual bug is
// narrower: the 5 broken MultiPolygon districts (Bentonville, Blevins,
// County Line, Gentry, Mulberry Pleasant View Bi-County) have parts whose
// winding DISAGREES with each other -- e.g. Bentonville's main shape is
// CW but its two small detached parts came out CCW, the `topojson`
// Python package's arc-topology construction apparently not preserving a
// consistent direction across a MultiPolygon's independently-built parts.
// d3-geo's rendering only breaks when a feature's parts point opposite
// ways; it's fine with globally-CW *or* globally-CCW as long as every
// part of a given feature agrees. So: normalize every part of a
// MultiPolygon to match its exterior ring's own convention (CW), leaving
// already-consistent single-Polygon features untouched in practice.
function fixRingWinding(geometry) {
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const isExterior = i === 0;
      const isCW = ringArea(ring) < 0;
      if (isExterior !== isCW) ring.reverse();
    });
  }
}

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// pctChangeColor()/PCT_CLIP now live in shared.js -- the ranked list's row
// swatch dot uses the same magnitude-gradient channel as this map's fill,
// so the color logic itself is shared rather than duplicated per view.

// CSS linear-gradient stops for the legend bar -- samples the same
// pctChangeColor() the map itself uses, so the legend can never drift
// out of sync with the actual fill logic.
function gradientCssStops(mode) {
  const steps = 12;
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 - 1; // -1..1
    const pct = t * PCT_CLIP;
    const pos = (i / steps) * 100;
    stops.push(`${pctChangeColor(pct, mode)} ${pos.toFixed(1)}%`);
  }
  return stops.join(", ");
}

function fmtPct(v) {
  return typeof v === "number" ? `${formatSignedPct(v)}%` : "—";
}

// Continuous gradient bar (replaces the 12-chip categorical legend --
// the fill itself is no longer categorical, so a discrete swatch-per-
// typology legend would now describe a channel the map isn't using).
// Charter point and boundary-change marks are still genuinely discrete,
// so they stay as separate chip items alongside the bar, in the same
// swatch+label visual the ranked list established, rather than being
// folded into the gradient itself.
function renderLegend(mode) {
  const bar = document.getElementById("gradient-bar");
  bar.style.background = `linear-gradient(to right, ${gradientCssStops(mode)})`;

  const container = document.getElementById("marker-legend");
  container.textContent = "";

  const charterChip = document.createElement("span");
  charterChip.className = "legend-chip charter";
  const charterSw = document.createElement("span");
  charterSw.className = "chip-swatch";
  charterChip.appendChild(charterSw);
  charterChip.appendChild(document.createTextNode("Charter school (point)"));
  container.appendChild(charterChip);

  const boundaryChip = document.createElement("span");
  boundaryChip.className = "legend-chip boundary";
  const boundarySw = document.createElement("span");
  boundarySw.className = "chip-swatch";
  boundaryChip.appendChild(boundarySw);
  boundaryChip.appendChild(document.createTextNode("Boundary changed since 2013"));
  container.appendChild(boundaryChip);
}

function showTooltip(tooltip, root, xPix, yPix, buildContent) {
  tooltip.innerHTML = "";
  buildContent(tooltip);
  tooltip.style.opacity = 1;
  const rootRect = root.getBoundingClientRect();
  const px = (xPix / VB_W) * rootRect.width;
  const py = (yPix / VB_H) * rootRect.height;
  tooltip.style.left = Math.min(px + 12, rootRect.width - 250) + "px";
  // Clamp against the tooltip's own just-rendered height, not a guessed
  // constant (unlike the left clamp's "250", height varies a lot with
  // content -- typology label length, whether a boundary note is
  // present) -- confirmed 2026-07-20: southern-border districts (whose
  // centroid sits near the bottom of the map's projected shape) pushed
  // the tooltip up to 143px past its own container's bottom edge at
  // narrow viewport widths, overlapping the caption text below the map.
  // Only became visible at narrow widths because the container itself
  // is shorter there relative to a still-multi-line-wrapping tooltip.
  const maxTop = Math.max(8, rootRect.height - tooltip.offsetHeight - 8);
  tooltip.style.top = Math.min(Math.max(py - 10, 8), maxTop) + "px";
}

function hideTooltip(tooltip) {
  tooltip.style.opacity = 0;
}

async function main() {
  const [districts, charterPoints, topoRes] = await Promise.all([
    loadDistricts(),
    loadCharterPoints(),
    fetch(TOPOJSON_URL).then((r) => {
      if (!r.ok) throw new Error(`Failed to load arkansas_districts.topojson: ${r.status}`);
      return r.json();
    }),
  ]);

  const districtById = new Map(districts.map((d) => [d.id, d]));

  const geo = topojson.feature(topoRes, topoRes.objects.districts);
  for (const f of geo.features) fixRingWinding(f.geometry);
  // Attach the matching districts.json record to each feature up front --
  // every view in this tool reads typology/pct_change_efa_era/
  // boundary_change_within_series off the districts.json record, never
  // off the boundary file itself (which only ever carries GEOID + name,
  // per the build script). A feature with no match would mean the
  // boundary file and districts.json have drifted out of sync since Part
  // A's build-time check confirmed 234/235 -- fail loudly rather than
  // silently drop or mis-render a district.
  for (const f of geo.features) {
    const d = districtById.get(f.properties.GEOID);
    if (!d) throw new Error(`No districts.json match for boundary GEOID ${f.properties.GEOID}`);
    f.properties.district = d;
  }

  const svg = document.getElementById("map-svg");
  const tooltip = document.getElementById("tooltip");
  const mode = currentMode();

  // Derived from the actual loaded feature/point counts, not hardcoded --
  // a prior round had this as a static "258" in the HTML (235 districts +
  // 23 charter points), which was wrong: Imboden Charter is one of the
  // 235 districts.json entries but has no polygon of its own (it's one of
  // the 23 charter points instead, see the districtById match-check
  // above), so the real district-polygon count is geo.features.length
  // (234), not 235. Computing it here means a future data change (a new
  // charter with no polygon, a boundary fix) can't silently make this
  // text wrong again the way the hardcoded number did.
  const markCountEl = document.getElementById("focusable-mark-count");
  const districtMarkCount = geo.features.length;
  const charterMarkCount = charterPoints.length;
  markCountEl.textContent =
    `${districtMarkCount + charterMarkCount} (${districtMarkCount} districts + ${charterMarkCount} charter points)`;

  renderLegend(mode);
  renderMap(svg, tooltip, geo, charterPoints, mode);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderLegend(currentMode());
    renderMap(svg, tooltip, geo, charterPoints, currentMode());
  });
}

function renderMap(svg, tooltip, geo, charterPoints, mode) {
  svg.textContent = "";
  hideTooltip(tooltip);

  // Fit the projection to Arkansas's actual extent (the boundary file's
  // own bounds), not a national projection -- geoFitSize scales/centers
  // a mercator projection so the whole FeatureCollection fills the
  // viewBox with a small margin.
  const margin = 10;
  const projection = d3.geoMercator().fitExtent(
    [[margin, margin], [VB_W - margin, VB_H - margin]],
    geo
  );
  const path = d3.geoPath(projection);

  const polyLayer = el("g", { class: "district-layer" });
  const markerLayer = el("g", { class: "boundary-marker-layer" });
  const charterLayer = el("g", { class: "charter-layer" });

  for (const f of geo.features) {
    const d = f.properties.district;
    const stroke = mapStrokeFor(d.typology);
    const fill = pctChangeColor(d.pct_change_efa_era, mode);
    const strokeColor = stroke.color[mode];

    // Built manually here (name -> enrollment -> shape/pct/CAGR detail ->
    // boundary note) rather than delegating to the shared
    // districtAriaLabel() (as before), which bakes the shape clause
    // directly onto "NAME:" with no room to insert an enrollment figure
    // between them -- districtAriaLabel() itself is used as-is by the
    // ranked list and drill-down and is untouched by this change, so
    // reordering here can't affect those two views' aria-labels.
    // districtTrajectoryText() (shared.js) supplies the shape+pct+CAGR
    // block in standalone-sentence form (capitalized, so it reads
    // correctly following the enrollment sentence rather than directly
    // after "NAME:"), reusing the same underlying formatting
    // districtAriaLabel() itself uses -- not a second, independently
    // hand-typed copy of that logic.
    const enrollmentText = districtEnrollmentText(d);
    const boundaryText = d.boundary_change_within_series
      ? ` Boundary changed ${d.current_boundary_since}.`
      : "";
    const ariaLabel =
      `${d.name}: ${enrollmentText ? `${enrollmentText} ` : ""}${districtTrajectoryText(d)}${boundaryText}`;
    const link = el("a", {
      class: "district-poly-link",
      href: `drill-down.html?id=${encodeURIComponent(d.id)}`,
      "aria-label": ariaLabel,
    });

    const dAttr = path(f);
    const poly = el("path", {
      class: "district-poly",
      d: dAttr,
      fill,
      stroke: strokeColor,
      "stroke-width": stroke.width,
      "stroke-opacity": stroke.opacity,
    });
    if (stroke.dasharray) poly.setAttribute("stroke-dasharray", stroke.dasharray);
    link.appendChild(poly);

    const showFor = () => showTooltip(tooltip, svg.parentElement, ...path.centroid(f), (t) => buildDistrictTooltip(t, d));
    link.addEventListener("mouseenter", showFor);
    link.addEventListener("focus", showFor);
    link.addEventListener("mouseleave", () => hideTooltip(tooltip));
    link.addEventListener("blur", () => hideTooltip(tooltip));

    polyLayer.appendChild(link);

    // Boundary-change indicator: a distinct dot at the polygon's
    // centroid, visible on the map itself (not just discoverable via
    // hover/tooltip) -- the map-appropriate equivalent of the ranked
    // list's "Boundary changed" badge. Deliberately NOT a dashed
    // outline on the polygon itself, since that pattern is already
    // reserved for NO_DATA_STROKE's "insufficient history to classify"
    // meaning -- reusing it here for a different meaning (boundary
    // changed, but fully classified) would conflate the two. r=4, one
    // pixel smaller than the charter markers' r=5, so the two are
    // distinguishable by size as well as by color (white fill here vs.
    // charter's orange) even before the fill-color difference registers.
    if (d.boundary_change_within_series) {
      const [cx, cy] = path.centroid(f);
      markerLayer.appendChild(el("circle", {
        class: "boundary-marker", cx, cy, r: 4,
      }));
    }
  }

  for (const p of charterPoints) {
    const [x, y] = projection([p.lon, p.lat]);
    const circle = el("circle", {
      class: "charter-point",
      cx: x, cy: y, r: CHARTER_POINT_STYLE.radius,
      fill: CHARTER_POINT_STYLE.color[mode],
      stroke: CHARTER_POINT_STYLE.strokeColor[mode],
      "stroke-width": CHARTER_POINT_STYLE.strokeWidth,
      tabindex: "0",
      role: "img",
      "aria-label": charterPointAriaLabel(p),
    });
    const showFor = () => showTooltip(tooltip, svg.parentElement, x, y, (t) => buildCharterTooltip(t, p));
    circle.addEventListener("mouseenter", showFor);
    circle.addEventListener("focus", showFor);
    circle.addEventListener("mouseleave", () => hideTooltip(tooltip));
    circle.addEventListener("blur", () => hideTooltip(tooltip));
    charterLayer.appendChild(circle);
  }

  svg.appendChild(polyLayer);
  svg.appendChild(markerLayer);
  svg.appendChild(charterLayer);
}

// Visual tooltip: same info set the ranked list shows for a row -- the
// raw latest-year enrollment figure, the plain-language shape sentence
// (not the raw typology category name -- same reasoning as the ranked
// list's tooltip and drill-down's summary paragraph), pct_change_efa_era,
// and the boundary-change badge treatment -- not a redesigned info set
// for the map specifically.
//
// Order: name -> enrollment -> shape sentence -> pct change -> boundary
// note. Enrollment sits immediately after the name/identity line, before
// any descriptive or caveat content -- mirroring the charter tooltip's
// own Name -> "Charter school" -> Enrollment -> caveat pattern
// (buildCharterTooltip() below), not the original order this had (name,
// shape, pct, THEN enrollment at the end), which buried the raw count
// behind two lines of description.
function buildDistrictTooltip(tooltip, d) {
  const name = document.createElement("div");
  name.className = "t-name";
  name.textContent = d.name;
  tooltip.appendChild(name);

  // Same .t-pct class the charter tooltip's own enrollment line uses
  // (buildCharterTooltip() below) -- "a numeric magnitude line" role, not
  // strictly percent-only, kept for visual/tonal consistency between the
  // map's two point types. Deliberately no year-over-year clause here,
  // unlike the charter version -- pct_change_efa_era (below) already
  // covers change for districts, so repeating it would duplicate
  // information already on screen.
  const enrollmentText = districtEnrollmentText(d);
  if (enrollmentText) {
    const enrollment = document.createElement("div");
    enrollment.className = "t-pct";
    enrollment.textContent = enrollmentText;
    tooltip.appendChild(enrollment);
  }

  const typo = document.createElement("div");
  typo.className = "t-typology";
  typo.textContent = districtShapeSentence(d);
  tooltip.appendChild(typo);

  const pct = document.createElement("div");
  pct.className = "t-pct";
  pct.textContent = `${fmtPct(d.pct_change_efa_era)} change in the EFA era`;
  tooltip.appendChild(pct);

  if (d.boundary_change_within_series) {
    const note = document.createElement("div");
    note.className = "t-note";
    note.textContent = `Boundary changed ${d.current_boundary_since}`;
    tooltip.appendChild(note);
  }
}

function buildCharterTooltip(tooltip, p) {
  const name = document.createElement("div");
  name.className = "t-name";
  name.textContent = p.name;
  const typo = document.createElement("div");
  typo.className = "t-typology";
  typo.textContent = "Charter school";
  tooltip.appendChild(name);
  tooltip.appendChild(typo);
  // Same wording/source as charterPointAriaLabel()'s own enrollment
  // clause (shared.js) -- reused, not hand-typed a second time, so the
  // visual tooltip and the keyboard/screen-reader label can't drift
  // apart. Same .t-pct class the district tooltip's own pct_change_efa_era
  // line uses, for the same "a numeric magnitude line" role.
  const enrollmentText = charterPointEnrollmentText(p);
  if (enrollmentText) {
    const pct = document.createElement("div");
    pct.className = "t-pct";
    pct.textContent = enrollmentText;
    tooltip.appendChild(pct);
  }
  if (p.map_caveat) {
    const note = document.createElement("div");
    note.className = "t-note";
    note.textContent = p.map_caveat;
    tooltip.appendChild(note);
  }
}

main();
