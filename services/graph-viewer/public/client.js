(function () {
  const url = new URL(window.location.href);
  const qsCollection = url.searchParams.get("collection") || "";
  const collectionInput = document.getElementById("collection-input");
  const relsInput = document.getElementById("rels-input");
  const limitInput = document.getElementById("limit-input");
  const loadBtn = document.getElementById("load-btn");
  const statusEl = document.getElementById("status");
  const graphEl = document.getElementById("graph");

  collectionInput.value = qsCollection;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function colorForLabel(label) {
    const palette = [
      "#8ac7ff", "#9affc7", "#ffb3ba", "#d7b3ff", "#ffd39a",
      "#b3fff6", "#ffdfba", "#c9ff9a", "#ff9af2", "#b1b1ff"
    ];
    let h = 0;
    for (let i = 0; i < label.length; i++) {
      h = (h * 31 + label.charCodeAt(i)) >>> 0;
    }
    return palette[h % palette.length];
  }

  const Graph = ForceGraph3D()(graphEl)
    .nodeAutoColorBy("label")
    .nodeLabel((n) => `${n.label}${n.title ? ": " + n.title : ""}`)
    .nodeThreeObject((node) => {
      const sprite = new SpriteText(node.title || node.label);
      sprite.color = colorForLabel(node.label);
      sprite.textHeight = 8;
      return sprite;
    })
    .linkColor(() => "rgba(200,200,255,0.5)")
    .linkLabel((l) => l.type);

  function buildUrl() {
    const params = new URLSearchParams();
    const collection = (collectionInput.value || "").trim();
    if (!collection) return null;
    params.set("collection", collection);
    const rels = (relsInput.value || "").trim();
    if (rels) params.set("rels", rels);
    const limit = parseInt(limitInput.value, 10);
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    return `/api/graph?${params.toString()}`;
  }

  function loadGraph() {
    const apiUrl = buildUrl();
    if (!apiUrl) {
      setStatus("Provide collection");
      return;
    }
    setStatus("Loading...");
    fetch(apiUrl)
      .then((res) => {
        if (!res.ok) {
          return res.json().then((j) => {
            throw new Error(j.error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => {
        Graph.graphData(data);
        setStatus(`Loaded: ${data.nodes.length} nodes, ${data.links.length} links`);
      })
      .catch((err) => {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "client_load_failed", error: String(err) }));
        setStatus("Error: " + String(err.message || err));
      });
  }

  loadBtn.addEventListener("click", loadGraph);

  if (qsCollection) {
    loadGraph();
  } else {
    setStatus("Provide collection");
  }
})();