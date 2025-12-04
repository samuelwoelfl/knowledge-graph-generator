/* ========================= GLOBALE ZUSTANDSVERWALTUNG ========================= */

let globalData = { entities: [], relations: [] };
let activeClickedEntityFilter = [];

// --- Globale Zustände für Zoom/Pan ---
let transform = { x: 0, y: 0, scale: 1 };
let isPanning = false;
let startPan = { x: 0, y: 0 };
const SCALE_STEP = 0.1;
const SCALE_MAX = 3;
const SCALE_MIN = 0.5;

/* ========================= DATENLADUNG ========================= */

async function loadData() {
    const response = await fetch("data.json");
    // Initialisiere zufällige Positionen, falls sie fehlen
    const data = await response.json();
    data.entities.forEach(e => {
        if (e.x === undefined || e.y === undefined) {
            e.x = `${Math.random() * 800}px`;
            e.y = `${Math.random() * 600}px`;
        }
    });
    return data;
}

/* ========================= HELPERS / UTILS ========================= */

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Konvertiert eine CSS-Positions-Angabe (z.B. "50%", "120px" oder "120")
// in Pixel relativ zur gegebenen Container-Größe.
function cssPosToPixels(value, containerSize) {
    if (!value && value !== 0) return 0;
    const str = String(value).trim();
    if (str.endsWith('%')) {
        const p = parseFloat(str.slice(0, -1));
        if (Number.isFinite(p)) return containerSize * p / 100;
        return 0;
    }
    // Entferne 'px' falls vorhanden
    const px = parseFloat(str.replace('px',''));
    return Number.isFinite(px) ? px : 0;
}

/* ========================= TAG COLORS ========================= */

const tagColors = {};
const palette = [
    "#E63946", "#457B9D", "#2A9D8F",
    "#F4A261", "#9C89B8", "#F67E7D",
    "#6B705C", "#CB997E"
];

function getTagColor(tag) {
    if (!tagColors[tag]) {
        tagColors[tag] = palette[Object.keys(tagColors).length % palette.length];
    }
    return tagColors[tag];
}

/* ========================= SVG MARKERS (ARROWS) ========================= */

function ensureColoredMarker(svg, color) {
    const colorHex = color.replace("#", "");
    const markerId = `arrow-${colorHex}`;

    let marker = svg.querySelector(`#${markerId}`);
    if (marker) {
        // Wenn Marker bereits existiert, wiederverwenden (kein Neustarten nötig)
        return markerId;
    }

    if (!marker) {
        let defs = svg.querySelector("defs");
        if (!defs) {
            defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            svg.prepend(defs);
        }

        marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.id = markerId;
        marker.setAttribute("viewBox", "0 0 10 10");
        // Marker-Größe in SVG-Einheiten; lasse Marker mit dem Graphen mitskalieren
        const markerSize = 6;
        marker.setAttribute("markerWidth", markerSize);
        marker.setAttribute("markerHeight", markerSize);
        marker.setAttribute("refX", 9);

        marker.setAttribute("refY", "5"); 
        
        marker.setAttribute("orient", "auto-start-reverse");

        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", "M 0 2 L 10 5 L 0 8 z");
        p.setAttribute("fill", color);

        marker.appendChild(p);
        defs.appendChild(marker);
    }

    return markerId;
}


/* ========================= NODES (VISUALS & CLICK LOGIC) ========================= */

function toggleEntitySelection(entityId) {
    const index = activeClickedEntityFilter.indexOf(entityId);
    
    if (index > -1) {
        activeClickedEntityFilter.splice(index, 1);
    } 
    else {
        activeClickedEntityFilter.push(entityId);
    }
    
    redraw();
}

function updateEntityVisuals(filter) {
    const nodes = document.querySelectorAll('.node');
    const showAll = filter.length === 0;
    
    nodes.forEach(node => {
        if (filter.includes(node.id)) {
            node.classList.add('clicked-active');
        } else {
            node.classList.remove('clicked-active');
        }

        if (showAll || filter.includes(node.id)) {
            node.classList.remove("inactive");
        } else {
            node.classList.add("inactive");
        }
    });
}

function drawNodes(entities) {
    const container = document.getElementById("nodes");
    container.innerHTML = "";

    entities.forEach(e => {
        const div = document.createElement("div");
        div.className = "node";
        div.id = e.id;
        div.dataset.x = e.x;
        div.dataset.y = e.y;
        div.style.left = e.x;
        div.style.top = e.y;
        div.textContent = e.label;
        
        div.addEventListener('click', (event) => { 
            // Verhindere, dass der Klick den Pan-Modus startet
            event.stopPropagation();
            toggleEntitySelection(e.id);
        });
        
        container.appendChild(div);
    });
}


/* ========================= LINES & LABELS ========================= */

// Hilfsfunktion für Schnittpunktberechnung (Unverändert)
function lineIntersectsRect(x1, y1, x2, y2, rect) {
    const pad = 3;
    const edges = [
        { x1: rect.left-pad, y1: rect.top-pad, x2: rect.right+pad, y2: rect.top-pad },     // top
        { x1: rect.left-pad, y1: rect.bottom+pad, x2: rect.right+pad, y2: rect.bottom+pad }, // bottom
        { x1: rect.left-pad, y1: rect.top-pad, x2: rect.left-pad, y2: rect.bottom+pad },     // left
        { x1: rect.right+pad, y1: rect.top-pad, x2: rect.right+pad, y2: rect.bottom+pad }    // right
    ];

    function intersect(x1,y1,x2,y2, x3,y3,x4,y4) {
        const denom = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
        if (denom === 0) return null;
        const px = ((x1*y2 - y1*x2)*(x3-x4) - (x1-x2)*(x3*y4 - y3*x4)) / denom;
        const py = ((x1*y2 - y1*x2)*(y3-y4) - (y1-y2)*(x3*y4 - y3*x4)) / denom;
        if (
            px < Math.min(x1,x2)-0.1 || px > Math.max(x1,x2)+0.1 ||
            px < Math.min(x3,x4)-0.1 || px > Math.max(x3,x4)+0.1 ||
            py < Math.min(y1,y2)-0.1 || py > Math.max(y1,y2)+0.1 ||
            py < Math.min(y3,y4)-0.1 || py > Math.max(y3,y4)+0.1
        ) return null;
        return {x: px, y: py};
    }

    for (let e of edges) {
        const hit = intersect(x1,y1,x2,y2, e.x1,e.y1,e.x2,e.y2);
        if (hit) return hit;
    }
    // Wenn kein Schnittpunkt gefunden wird, bleibe auf dem ursprünglichen Zielpunkt
    return {x: x2, y: y2}; 
}

// -----------------------------------------------------
// KORRIGIERTE drawLines FUNKTION
// Verwendet die untransformierten CSS-Positionen für die Geometrie
// Kompensiert Linienstärke und Schriftgröße mit 1/scale
// -----------------------------------------------------
function drawLines(relations, entityFilter, tagFilter) {
    const svg = document.getElementById("lines");
    Array.from(svg.children).forEach(child => {
        if (child.tagName !== 'defs') child.remove();
    });

    const shouldFilterEntities = entityFilter.length > 0;
    
    // 1. Filtern (bleibt gleich)
    const visibleRelations = relations.filter(r => {
        const passesTagFilter = (tagFilter.length === 0 || tagFilter.includes(r.tag));
        let passesEntityFilter = true;
        
        if (shouldFilterEntities) {
            const fromActive = entityFilter.includes(r.from);
            const toActive = entityFilter.includes(r.to);
            passesEntityFilter = fromActive || toActive;
        }

        return passesTagFilter
            && passesEntityFilter
            && document.getElementById(r.from) 
            && document.getElementById(r.to);
    });

    // 2. Zeichnen
    visibleRelations.forEach(r => {
        const fromEl = document.getElementById(r.from);
        const toEl = document.getElementById(r.to);
        // --- Hole die initialen/untransformierten CSS-Koordinaten ---
        // Wichtig: left/top können in '%' angegeben sein. Wir rechnen
        // Prozentwerte in Pixel um relativ zur Größe des Nodes-Containers.
        const nodesContainer = document.getElementById('nodes');
        const containerWidth = nodesContainer ? nodesContainer.clientWidth : window.innerWidth;
        const containerHeight = nodesContainer ? nodesContainer.clientHeight : window.innerHeight;

        const x1_css = cssPosToPixels(fromEl.style.left || fromEl.dataset.x || 0, containerWidth);
        const y1_css = cssPosToPixels(fromEl.style.top  || fromEl.dataset.y || 0, containerHeight);
        const x2_css = cssPosToPixels(toEl.style.left   || toEl.dataset.x   || 0, containerWidth);
        const y2_css = cssPosToPixels(toEl.style.top    || toEl.dataset.y   || 0, containerHeight);

        // Hole die aktuelle Layout-Größe der Nodes (in CSS-Pixeln).
        // Diese Werte sind bereits im untransformierten Koordinatensystem und
        // sollten NICHT durch `transform.scale` geteilt werden — wir arbeiten
        // mit untransformierten Positionen/Größen für die Geometrie.
        const fromWidth = fromEl.offsetWidth;
        const fromHeight = fromEl.offsetHeight;
        const toWidth = toEl.offsetWidth;
        const toHeight = toEl.offsetHeight;

        // Erstelle die Bounding Boxen im untransformierten Raum
        const fromBox = {
            left: x1_css - fromWidth / 2,
            right: x1_css + fromWidth / 2,
            top: y1_css - fromHeight / 2,
            bottom: y1_css + fromHeight / 2
        };
        const toBox = {
            left: x2_css - toWidth / 2,
            right: x2_css + toWidth / 2,
            top: y2_css - toHeight / 2,
            bottom: y2_css + toHeight / 2
        };

        

        // Der Anfangs- und Endpunkt der Linie ist der Mittelpunkt der Node im untransformierten Raum
        let x1_center = x1_css;
        let y1_center = y1_css;
        let x2_center = x2_css;
        let y2_center = y2_css;
        
        // Berechne die Schnittpunkte der Linie mit der untransformierten Bounding Box
        let start = lineIntersectsRect(x2_center, y2_center, x1_center, y1_center, fromBox);
        let end   = lineIntersectsRect(x1_center, y1_center, x2_center, y2_center, toBox);
        
        // **Wichtig:** x1, y1, x2, y2 bleiben hier in den untransformierten Koordinaten!
        let x1 = start.x; let y1 = start.y;
        let x2 = end.x;   let y2 = end.y;

        // --- Kurvenlogik ---
        const pairKey = [r.from, r.to].sort().join("|");
        const siblings = visibleRelations.filter(rr =>
            ([rr.from, rr.to].sort().join("|")) === pairKey
        );
        const totalInPair = siblings.length;
        const indexInPair = siblings.indexOf(r);
        let curveAmount = 0;

        if (totalInPair > 1) {
             const spacing = 30; // Feste Pixel-Einheit im untransformierten Raum
             curveAmount = (indexInPair - (totalInPair - 1) / 2) * spacing;
             if (r.from > r.to) {
                curveAmount *= -1;
             }
        }
        // -------------------

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy) || 1; 
        const perp = { x: -dy/dist, y: dx/dist };

        // **Wichtig:** cx und cy bleiben in den untransformierten Koordinaten!
        const cx = (x1 + x2) / 2 + perp.x * curveAmount;
        const cy = (y1 + y2) / 2 + perp.y * curveAmount;

        const color = getTagColor(r.tag);
        const markerId = ensureColoredMarker(svg, color);

        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.classList.add("edge-group");

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.classList.add("edge-line");
        const d = Math.abs(curveAmount) < 1
            ? `M ${x1},${y1} L ${x2},${y2}`
            : `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`;

        path.setAttribute("d", d);
        path.setAttribute("stroke", color);
        // Lasse die Stroke-Width mit dem Graphen mitskalieren (proportional zu Node-Rändern)
        path.setAttribute("stroke-width", 2);
        path.setAttribute("fill", "none");
        path.setAttribute("marker-end", `url(#${markerId})`);
        g.appendChild(path);

        const labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        labelGroup.classList.add("edge-label-group");

        const t = 0.5;
        // Die Mittelpunkte bleiben in den untransformierten Koordinaten
        const midX = (1-t)*(1-t)*x1 + 2*(1-t)*t*cx + t*t*x2;
        const midY = (1-t)*(1-t)*y1 + 2*(1-t)*t*cy + t*t*y2;

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.classList.add("edge-text");
        text.setAttribute("x", midX);
        text.setAttribute("y", midY);
        text.setAttribute("dy", "0.35em"); 
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", color); 
        // Lasse Label-Text mitzoomen, damit es proportional zu Nodes bleibt
        text.setAttribute("font-size", `13px`);
        text.textContent = r.label;

        labelGroup.appendChild(text);
        g.appendChild(labelGroup);
        svg.appendChild(g);
    });
}

/* ========================= FILTER CHECKBOXES ========================= */

// Entitäts-Filter entfernt. Nur noch Tag-Filter vorhanden.

function populateTagFilter(relations) {
    const container = document.getElementById("filter-tags");
    if (!container) return; 
    
    container.innerHTML = "";
    const tags = new Set(relations.map(r => r.tag).filter(Boolean));
    tags.forEach(tag => {
        const color = getTagColor(tag);
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = tag;
        checkbox.checked = false;
        const span = document.createElement("span");
        span.className = "tag-color";
        span.style.borderColor = color;
        span.textContent = tag;
        
        // Aktualisiere die Klasse wenn Checkbox geändert wird
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                span.classList.add("active");
                span.style.background = color;
            } else {
                span.classList.remove("active");
                span.style.background = "none";
            }
        });
        
        label.appendChild(checkbox);
        label.appendChild(span);
        container.appendChild(label);
    });
}

function getCheckedValues(containerId) {
    return Array.from(
        document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)
    ).map(cb => cb.value);
}

/* ========================= GRAPH TRANSFORM (ZOOM/PAN) ========================= */

function applyTransform() {
    const graphInner = document.getElementById("graph-inner");
    if (graphInner) {
        // FIX: Stelle sicher, dass transform.x, transform.y und transform.scale korrekt angewendet werden
        graphInner.style.transform = 
            `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    }
}

function handleZoom(event) {
    event.preventDefault(); // Verhindert Scrollen der Seite
    
    // Die Mausposition relativ zum graph-container
    const graphContainer = document.getElementById("graph-container");
    const containerRect = graphContainer.getBoundingClientRect();
    const mouseX = event.clientX - containerRect.left;
    const mouseY = event.clientY - containerRect.top;

    let newScale = transform.scale;

    if (event.deltaY < 0) {
        newScale += SCALE_STEP; // Zoom In
    } else {
        newScale -= SCALE_STEP; // Zoom Out
    }

    newScale = Math.min(Math.max(SCALE_MIN, newScale), SCALE_MAX); // Skala begrenzen

    if (newScale === transform.scale) return; // Wenn keine Änderung, abbrechen
    
    const scaleFactor = newScale / transform.scale;
    
    // Zoom um den Mauszeiger zentrieren (Wichtige Formel)
    transform.x = mouseX - (mouseX - transform.x) * scaleFactor;
    transform.y = mouseY - (mouseY - transform.y) * scaleFactor;
    transform.scale = newScale;

    applyTransform();
    redraw(); // Linien müssen neu gezeichnet werden, da sich die absoluten Positionen ändern
}

// -----------------------------------------------------
// KORRIGIERTER handlePanStart FUNKTION
// Ignoriert Klicks auf interaktiven Elementen
// -----------------------------------------------------
function handlePanStart(event) {
    // FIX: Ignoriere Panning, wenn das Ziel ein interaktives Element ist
    const target = event.target;
    if (
        target.closest('.filter-container') || // Filter-Container
        target.id === 'reset-view-button' ||   // Reset Button
        target.closest('.node') ||             // Nodes (die einen eigenen Klick-Handler haben)
        target.tagName === 'LABEL'             // Tags im Filter
    ) {
        return; 
    }
    
    // Verhindert Standard-Browserverhalten (wie Bild-Ziehen)
    // Nur bei Mausklicks verhindern, bei Touch passive:false verwenden
    if (event.buttons === 1 || event.touches) {
        // e.preventDefault(); // Wird über { passive: false } im Init-Block gehandhabt
    }

    isPanning = true;
    
    // Ermittelt die Startposition des Cursors/Fingers
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    startPan = { x: clientX - transform.x, y: clientY - transform.y };

    const container = document.getElementById("graph-container");
    container.style.cursor = 'grabbing';
}

function handlePan(event) {
    if (!isPanning) return;
    event.preventDefault(); // Verhindert u.a. Scrollen auf Mobile

    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    transform.x = clientX - startPan.x;
    transform.y = clientY - startPan.y;

    applyTransform();
    redraw(); // Linien müssen während des Pans neu gezeichnet werden
}

function handlePanEnd() {
    isPanning = false;
    document.getElementById("graph-container").style.cursor = 'grab';
}

// -----------------------------------------------------
// NEUE resetTransform FUNKTION
// -----------------------------------------------------
function resetTransform() {
    transform.x = 0;
    transform.y = 0;
    transform.scale = 1;
    applyTransform();
    redraw();
}

/* ========================= INIT & REDRAW LOGIC ========================= */

function redraw() {
    const activeEntities = activeClickedEntityFilter;
    const activeTags = getCheckedValues("filter-tags");

    updateEntityVisuals(activeEntities);

    drawLines(
        globalData.relations,
        activeEntities,
        activeTags
    );
}

async function init() {
    const data = await loadData();
    globalData = data; 

    populateTagFilter(data.relations);
    drawNodes(data.entities);
    
    applyTransform(); // Initial die Skalierung anwenden (scale: 1)
    redraw();

    // Event Listeners
    window.addEventListener("resize", debounce(redraw, 150));

    // --- Reset Button Listener ---
    const resetButton = document.getElementById("reset-view-button");
    if (resetButton) {
        resetButton.addEventListener('click', resetTransform);
    }
    // -----------------------------

    const graphContainer = document.getElementById("graph-container");

    // --- ZOOM/PAN Event Listeners ---
    graphContainer.addEventListener('wheel', handleZoom);
    graphContainer.addEventListener('mousedown', handlePanStart);
    // Pan Move/End sind auf dem Dokument, damit das Panning nicht abbricht, wenn man
    // den Cursor schnell bewegt und kurz den graphContainer verlässt
    document.addEventListener('mousemove', handlePan);
    document.addEventListener('mouseup', handlePanEnd);
    
    // Mobile Touch Events (einfache Pan-Erkennung)
    graphContainer.addEventListener('touchstart', (e) => {
        // Starte Pan nur, wenn es kein Pinch ist und handlePanStart die Elemente nicht ignoriert
        if (e.touches.length === 1) handlePanStart(e);
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) handlePan(e);
    }, { passive: false });
    document.addEventListener('touchend', handlePanEnd);

    // Tag-Filter behalten
    const tagFilterContainer = document.getElementById("filter-tags");
    if (tagFilterContainer) {
        tagFilterContainer.addEventListener("change", redraw);
    }
}

init();