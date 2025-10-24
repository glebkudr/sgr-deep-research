(function () {
  const url = new URL(window.location.href);
  const qsCollection = url.searchParams.get("collection") || "";
  const collectionInput = document.getElementById("collection-input");
  const relsInput = document.getElementById("rels-input");
  const limitInput = document.getElementById("limit-input");
  const loadBtn = document.getElementById("load-btn");
  const fitBtn = document.getElementById("fit-btn");
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
    .backgroundColor("#0f172a")
    .nodeRelSize(6)
    .nodeAutoColorBy("label")
    .nodeLabel((n) => `${n.label}${n.title ? ": " + n.title : ""}`)
    .nodeThreeObjectExtend(true)
    .nodeThreeObject((node) => {
      const sprite = new SpriteText(node.title || node.label);
      sprite.color = colorForLabel(node.label);
      sprite.textHeight = 14;
      return sprite;
    })
    .linkColor(() => "rgba(210,220,255,0.6)")
    .linkLabel((l) => l.type);

  // Structured log: initial container size
  (function logInitialContainer() {
    const r = graphEl.getBoundingClientRect();
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "client_container_size",
        stage: "init",
        width: Math.round(r.width),
        height: Math.round(r.height),
      })
    );
  })();

  // One-time-per-dataset zoom-to-fit control via onEngineStop
  let shouldFrameOnStop = false;
  Graph.onEngineStop(() => {
    if (!shouldFrameOnStop) return;
    const data = Graph.graphData();
    const hasNodes = data && Array.isArray(data.nodes) && data.nodes.length > 0;
    if (!hasNodes) return;
    shouldFrameOnStop = false;
    const r = graphEl.getBoundingClientRect();
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "client_zoom_fit",
        reason: "engine_stop",
        width: Math.round(r.width),
        height: Math.round(r.height),
        nodes: data.nodes.length,
        links: data.links ? data.links.length : 0,
      })
    );
    Graph.zoomToFit(400, 50);
  });

  function buildUrl() {
    const params = new URLSearchParams();
    const collection = (collectionInput.value || "").trim();
    if (!collection) return null;
    params.set("collection", collection);
    const rels = (relsInput.value || "").trim();
    if (rels) params.set("rels", rels);
    const limit = parseInt(limitInput.value, 10);
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    return `/graphview/api/graph?${params.toString()}`;
  }

  function loadGraph() {
    const apiUrl = buildUrl();
    if (!apiUrl) {
      setStatus("Provide collection");
      return;
    }
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "client_load_clicked",
        url: apiUrl,
      })
    );
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
        // Log data receipt and sample
        const sampleNodes = Array.isArray(data.nodes)
          ? data.nodes.slice(0, 3).map((n) => ({ id: n.id, label: n.label }))
          : [];
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            event: "client_graph_data_received",
            nodes: Array.isArray(data.nodes) ? data.nodes.length : 0,
            links: Array.isArray(data.links) ? data.links.length : 0,
            sample_nodes: sampleNodes,
          })
        );

        Graph.graphData(data);
        shouldFrameOnStop = true; // enable zoom-to-fit when physics settles
        setStatus(`Loaded: ${data.nodes.length} nodes, ${data.links.length} links`);
      })
      .catch((err) => {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "client_load_failed", error: String(err) }));
        setStatus("Error: " + String(err.message || err));
      });
  }

  loadBtn.addEventListener("click", loadGraph);
  fitBtn.addEventListener("click", function () {
    const data = Graph.graphData();
    if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
    const r = graphEl.getBoundingClientRect();
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "client_zoom_fit",
        reason: "manual_click",
        width: Math.round(r.width),
        height: Math.round(r.height),
        nodes: data.nodes.length,
        links: data.links ? data.links.length : 0,
      })
    );
    Graph.zoomToFit(400, 50);
  });

  if (qsCollection) {
    loadGraph();
  } else {
    setStatus("Provide collection");
  }

  // Debounced zoom-to-fit on window resize if data is present
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const self = this;
      const args = arguments;
      t = setTimeout(function () {
        fn.apply(self, args);
      }, ms);
    };
  }

  const onResize = debounce(function () {
    const data = Graph.graphData();
    if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
    const r = graphEl.getBoundingClientRect();
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "client_zoom_fit",
        reason: "resize",
        width: Math.round(r.width),
        height: Math.round(r.height),
        nodes: data.nodes.length,
        links: data.links ? data.links.length : 0,
      })
    );
    Graph.zoomToFit(400, 50);
  }, 200);

  window.addEventListener("resize", onResize);
})();


