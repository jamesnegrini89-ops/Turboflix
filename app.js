const app = document.querySelector("#app");
const searchInput = document.querySelector("#searchInput");
const playerDialog = document.querySelector("#playerDialog");
const videoPlayer = document.querySelector("#videoPlayer");
const playerTitle = document.querySelector("#playerTitle");
const playerMessage = document.querySelector("#playerMessage");
const closePlayerButton = document.querySelector("#closePlayerButton");
const playerFavoriteButton = document.querySelector("#playerFavoriteButton");
const restartButton = document.querySelector("#restartButton");

const STORAGE_KEY = "turboflix-data";

let currentView = "home";
let currentItem = null;
let activeHls = null;

const defaultDatabase = {
  items: [],
  favorites: [],
  history: [],
  config: {
    sourceType: "",
    m3uUrl: "",
    server: "",
    username: "",
    password: ""
  }
};

const database = loadDatabase();

function loadDatabase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      return structuredClone(defaultDatabase);
    }

    const parsed = JSON.parse(saved);

    return {
      ...structuredClone(defaultDatabase),
      ...parsed,
      config: {
        ...defaultDatabase.config,
        ...(parsed.config || {})
      }
    };
  } catch (error) {
    console.error("Erro ao carregar dados locais:", error);
    return structuredClone(defaultDatabase);
  }
}

function saveDatabase() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  } catch (error) {
    console.error("Erro ao salvar dados locais:", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function createId(value) {
  return btoa(
    encodeURIComponent(String(value || "item"))
  ).replace(/[^a-zA-Z0-9]/g, "");
}

function isFavorite(item) {
  return database.favorites.some(
    favorite => favorite.id === item.id || favorite.url === item.url
  );
}

function isInHistory(item) {
  return database.history.some(
    historyItem => historyItem.id === item.id || historyItem.url === item.url
  );
}

function getImage(item) {
  return item.logo ||
    item.cover ||
    "https://placehold.co/300x420/29183a/ffffff?text=TurboFlix";
}

function getItemByUrl(url) {
  return database.items.find(item => item.url === url) ||
    database.favorites.find(item => item.url === url) ||
    database.history.find(item => item.url === url);
}

function setActiveNavigation() {
  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === currentView
    );
  });
}

function itemCard(item) {
  const favoriteSymbol = isFavorite(item) ? " ★" : "";

  return `
    <article
      class="content-card"
      tabindex="0"
      role="button"
      data-item-url="${escapeHtml(item.url)}"
      aria-label="Abrir ${escapeHtml(item.name)}"
    >
      <img
        class="content-card-image"
        src="${escapeHtml(getImage(item))}"
        alt=""
        loading="lazy"
        onerror="this.src='https://placehold.co/300x420/29183a/ffffff?text=TurboFlix'"
      >

      <div class="content-card-info">
        <span class="content-card-title">
          ${escapeHtml(item.name)}
        </span>

        <small class="content-card-meta">
          ${escapeHtml(item.group || item.category || "Sem categoria")}
          ${favoriteSymbol}
        </small>
      </div>
    </article>
  `;
}

function emptyState(message) {
  return `
    <div class="empty-state">
      ${escapeHtml(message)}
    </div>
  `;
}

function renderHome() {
  const history = database.history.slice(0, 12);
  const items = filteredItems(database.items);

  app.innerHTML = `
    <section class="hero">
      <h1>Bem-vindo ao TurboFlix</h1>
      <p>
        Sua televisão, filmes e séries em um só lugar.
      </p>
    </section>

    <h2 class="section-title">Continuar assistindo</h2>

    <div class="horizontal-row">
      ${
        history.length
          ? history.map(itemCard).join("")
          : emptyState("Você ainda não começou nenhum conteúdo.")
      }
    </div>

    <h2 class="section-title">Conteúdos disponíveis</h2>

    <div class="content-grid">
      ${
        items.length
          ? items.map(itemCard).join("")
          : emptyState(
              "Configure uma playlist M3U ou uma conta Xtream em Configurações."
            )
      }
    </div>
  `;

  connectCards();
}

function renderCategory(type, title) {
  const items = filteredItems(
    database.items.filter(item => item.type === type)
  );

  app.innerHTML = `
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>Escolha um conteúdo para assistir.</p>
    </section>

    <div class="content-grid">
      ${
        items.length
          ? items.map(itemCard).join("")
          : emptyState(Nenhum conteúdo encontrado em ${title}.)
      }
    </div>
  `;

  connectCards();
}

function renderFavorites() {
  const items = filteredItems(database.favorites);

  app.innerHTML = `
    <section class="hero">
      <h1>Minha lista</h1>
      <p>Seus canais, filmes e séries favoritos.</p>
    </section>

    <div class="content-grid">
      ${
        items.length
          ? items.map(itemCard).join("")
          : emptyState("Você ainda não adicionou favoritos.")
      }
    </div>
  `;

  connectCards();
}

function filteredItems(items) {
  const query = normalizeText(searchInput?.value);

  if (!query) {
    return items;
  }

  return items.filter(item => {
    const searchable = [
      item.name,
      item.group,
      item.category,
      item.type
    ]
      .map(normalizeText)
      .join(" ");

    return searchable.includes(query);
  });
}

function render() {
  setActiveNavigation();

  if (currentView === "settings") {
    renderSettings();
    return;
  }

  if (currentView === "live") {
    renderCategory("live", "TV ao vivo");
    return;
  }

  if (currentView === "movies") {
    renderCategory("movies", "Filmes");
    return;
  }

  if (currentView === "series") {
    renderCategory("series", "Séries");
    return;
  }

  if (currentView === "favorites") {
    renderFavorites();
    return;
  }

  renderHome();
}

function connectCards() {
  document.querySelectorAll(".content-card").forEach(card => {
    const url = card.dataset.itemUrl;

    card.addEventListener("click", () => {
      const item = getItemByUrl(url);

      if (item) {
        openPlayer(item);
      }
    });

    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        const item = getItemByUrl(url);

        if (item) {
          openPlayer(item);
        }
      }
    });
  });
}

function parseM3UAttributes(line) {
  const attributes = {};

  const pattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function detectContentType(group, name) {
  const text = normalizeText(${group} ${name});

  if (
    text.includes("filme") ||
    text.includes("movie") ||
    text.includes("vod")
  ) {
    return "movies";
  }

  if (
    text.includes("serie") ||
    text.includes("series") ||
    text.includes("temporada")
  ) {
    return "series";
  }

  return "live";
}

function parseM3U(text) {
  const lines = text.split(/
?
/);
  const items = [];

  let pendingInfo = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const commaPosition = line.indexOf(",");
      const name = commaPosition >= 0
        ? line.slice(commaPosition + 1).trim()
        : "Conteúdo sem nome";

      const attributes = parseM3UAttributes(line);
      const group = attributes["group-title"] || "Geral";
      const logo = attributes["tvg-logo"] || "";

      pendingInfo = {
        name,
        group,
        logo,
        type: detectContentType(group, name)
      };

      continue;
    }

    if (!line.startsWith("#") && pendingInfo) {
      const item = {
        id: createId(${line}-${pendingInfo.name}),
        name: pendingInfo.name,
        group: pendingInfo.group,
        logo: pendingInfo.logo,
        type: pendingInfo.type,
        url: line,
        source: "m3u"
      };

      items.push(item);
      pendingInfo = null;
    }
  }

  return items;
}

async function loadM3U() {
  const message = document.querySelector("#settingsMessage");
  const url = document.querySelector("#m3uUrl")?.value.trim();

  if (!url) {
    showSettingsMessage(
      "Informe a URL da playlist M3U.",
      "error"
    );
    return;
  }

  showSettingsMessage("Carregando playlist M3U...", "");

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(HTTP ${response.status});
    }

    const text = await response.text();
    const items = parseM3U(text);

    if (!items.length) {
      throw new Error("Nenhum item encontrado");
    }

    database.items = items;
    database.config.sourceType = "m3u";
    database.config.m3uUrl = url;

    saveDatabase();

    showSettingsMessage(
      ${items.length} conteúdos carregados com sucesso.,
      "success"
    );

    currentView = "home";
    render();
  } catch (error) {
    console.error(error);

    showSettingsMessage(
      "Não foi possível carregar a M3U. Verifique a URL, HTTPS e CORS.",
      "error"
    );
  }
}

function xtreamBaseUrl() {
  const server = document
    .querySelector("#xtreamServer")
    ?.value
    .trim()
    .replace(//+$/, "");

  return server;
}

function getXtreamCredentials() {
  return {
    server: xtreamBaseUrl(),
    username: document.querySelector("#xtreamUsername")?.value.trim(),
    password: document.querySelector("#xtreamPassword")?.value
  };
}

async function xtreamRequest(server, username, password, action) {
  const query = new URLSearchParams({
    username,
    password,
    action
  });

  const response = await fetch(
    ${server}/player_api.php?${query.toString()}
  );

  if (!response.ok) {
    throw new Error(HTTP ${response.status});
  }

  return response.json();
}

async function loadXtream() {
  const message = document.querySelector("#settingsMessage");
  const credentials = getXtreamCredentials();

  if (
    !credentials.server ||
    !credentials.username ||
    !credentials.password
  ) {
    showSettingsMessage(
      "Preencha servidor, usuário e senha.",
      "error"
    );
    return;
  }

  showSettingsMessage("Conectando ao servidor Xtream...", "");

  try {
    const [
      liveStreams,
      vodStreams,
      seriesStreams
    ] = await Promise.all([
      xtreamRequest(
        credentials.server,
        credentials.username,
        credentials.password,
        "get_live_streams"
      ),
      xtreamRequest(
        credentials.server,
        credentials.username,
        credentials.password,
        "get_vod_streams"
      ),
      xtreamRequest(
        credentials.server,
        credentials.username,
        credentials.password,
        "get_series"
      )
    ]);

    const liveItems = Array.isArray(liveStreams)
      ? liveStreams.map(stream => ({
          id: live-${stream.stream_id},
          name: stream.name || "Canal",
          group: stream.category_name || "TV ao vivo",
          logo: stream.stream_icon || "",
          type: "live",
          url: ${credentials.server}/live/${credentials.username}/${credentials.password}/${stream.stream_id}.m3u8,
          source: "xtream"
        }))
      : [];

    const movieItems = Array.isArray(vodStreams)
      ? vodStreams.map(stream => ({
          id: movie-${stream.stream_id},
          name: stream.name || "Filme",
          group: stream.category_name || "Filmes",
          logo: stream.stream_icon || "",
          type: "movies",
          url: ${credentials.server}/movie/${credentials.username}/${credentials.password}/${stream.stream_id}.${stream.container_extension || "mp4"},
          source: "xtream"
        }))
      : [];

    const seriesItems = Array.isArray(seriesStreams)
      ? seriesStreams.map(series => ({
          id: series-${series.series_id || series.id},
          name: series.name || "Série",
          group: series.category_name || "Séries",
          logo: series.cover || "",
          type: "series",
          url: "",
          seriesId: series.series_id || series.id,
          source: "xtream"
        }))
      : [];

    database.items = [
      ...liveItems,
      ...movieItems,
      ...seriesItems
    ];

    database.config = {
      ...database.config,
      sourceType: "xtream",
      server: credentials.server,
      username: credentials.username,
      password: credentials.password
    };

    saveDatabase();

    showSettingsMessage(
      ${database.items.length} conteúdos carregados com sucesso.,
      "success"
    );

    currentView = "home";
    render();
  } catch (error) {
    console.error(error);

    showSettingsMessage(
      "Falha no Xtream. Verifique dados, servidor e CORS.",
      "error"
    );
  }
}

function showSettingsMessage(message, type) {
  const element = document.querySelector("#settingsMessage");

  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = settings-message ${type};
}

function renderSettings() {
  const config = database.config;

  app.innerHTML = `
    <section class="hero">
      <h1>Configurações</h1>
      <p>Adicione sua playlist M3U ou conta Xtream autorizada.</p>
    </section>

    <section class="settings-form">
      <h2>Playlist M3U</h2>

      <label for="m3uUrl">
        URL da playlist M3U
      </label>

      <input
        id="m3uUrl"
        type="url"
        value="${escapeHtml(config.m3uUrl)}"
        placeholder="https://exemplo.com/playlist.m3u"
      >

      <button id="loadM3UButton">
        Carregar playlist M3U
      </button>

      <hr>

      <h2>Xtream Codes</h2>

      <label for="xtreamServer">
        Servidor
      </label>

      <input
        id="xtreamServer"
        type="url"
        value="${escapeHtml(config.server)}"
        placeholder="https://servidor:porta"
      >

      <label for="xtreamUsername">
        Usuário
      </label>

      <input
        id="xtreamUsername"
        type="text"
        value="${escapeHtml(config.username)}"
        autocomplete="off"
      >

      <label for="xtreamPassword">
        Senha
      </label>

      <input
        id="xtreamPassword"
        type="password"
        value="${escapeHtml(config.password)}"
        autocomplete="off"
      >

      <button id="loadXtreamButton">
        Conectar ao Xtream
      </button>

      <p id="settingsMessage" class="settings-message">
        Use somente conteúdos e contas autorizados.
      </p>

      <hr>

      <h2>Dados locais</h2>

      <p>
        Favoritos e histórico ficam salvos neste navegador.
      </p>

      <button id="clearDataButton" class="danger-button">
        Limpar dados locais
      </button>
    </section>
  `;

  document.querySelector("#loadM3UButton")
    .addEventListener("click", loadM3U);

  document.querySelector("#loadXtreamButton")
    .addEventListener("click", loadXtream);

  document.querySelector("#clearDataButton")
    .addEventListener("click", clearLocalData);
}

function toggleFavorite(item) {
  const index = database.favorites.findIndex(
    favorite => favorite.id === item.id || favorite.url === item.url
  );

  if (index >= 0) {
    database.favorites.splice(index, 1);
    playerFavoriteButton.textContent = "★ Favoritar";
  } else {
    database.favorites.unshift(item);
    playerFavoriteButton.textContent = "★ Favoritado";
  }

  saveDatabase();
  render();
}

function updateHistory(item, seconds = 0) {
  const withoutItem = database.history.filter(
    historyItem => historyItem.id !== item.id &&
      historyItem.url !== item.url
  );

  database.history = [
    {
      ...item,
      progress: Math.max(0, Number(seconds) || 0),
      updatedAt: Date.now()
    },
    ...withoutItem
  ].slice(0, 30);

  saveDatabase();
}

function destroyHls() {
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
}

function showPlayerMessage(message) {
  playerMessage.textContent = message;
}

function openPlayer(item) {
  if (!item || !item.url) {
    showPlayerMessage(
      "Este item não possui um endereço de reprodução disponível."
    );
    return;
  }

  currentItem = item;
  destroyHls();

  playerTitle.textContent = item.name;
  showPlayerMessage("");

  videoPlayer.pause();
  videoPlayer.removeAttribute("src");
  videoPlayer.load();

  const historyItem = database.history.find(
    history => history.id === item.id || history.url === item.url
  );

  const startPosition = historyItem?.progress || 0;

  if (
    window.Hls &&
    Hls.isSupported() &&
    item.url.toLowerCase().includes(".m3u8")
  ) {
    activeHls = new Hls();

    activeHls.loadSource(item.url);
    activeHls.attachMedia(videoPlayer);

    activeHls.on(Hls.Events.ERROR, (event, data) => {
      if (data?.fatal) {
        showPlayerMessage(
          "Erro fatal ao carregar o stream. Verifique o servidor, HTTPS e CORS."
        );
      }
    });
  } else {
    videoPlayer.src = item.url;
  }

  videoPlayer.onloadedmetadata = () => {
    if (startPosition > 0 && Number.isFinite(videoPlayer.duration)) {
      try {
        videoPlayer.currentTime = startPosition;
      } catch (error) {
        console.warn("Não foi possível restaurar progresso:", error);
      }
    }
  };

  videoPlayer.play().catch(() => {
    showPlayerMessage(
      "Pressione Play para iniciar. O navegador pode bloquear reprodução automática."
    );
  });

  playerFavoriteButton.textContent = isFavorite(item)
    ? "★ Favoritado"
    : "★ Favoritar";

  if (typeof playerDialog.showModal === "function") {
    playerDialog.showModal();
  } else {
    playerDialog.setAttribute("open", "");
  }
}

function closePlayer() {
  if (currentItem) {
    updateHistory(currentItem, videoPlayer.currentTime);
  }

  videoPlayer.pause();
  destroyHls();

  videoPlayer.removeAttribute("src");
  videoPlayer.load();

  if (playerDialog.open) {
    playerDialog.close();
  } else {
    playerDialog.removeAttribute("open");
  }

  currentItem = null;
  render();
}

function clearLocalData() {
  const confirmed = window.confirm(
    "Tem certeza que deseja apagar playlists, favoritos e histórico?"
  );

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    render();
  });
});

searchInput.addEventListener("input", () => {
  render();
});

closePlayerButton.addEventListener("click", closePlayer);

playerDialog.addEventListener("cancel", event => {
  event.preventDefault();
  closePlayer();
});

playerFavoriteButton.addEventListener("click", () => {
  if (currentItem) {
    toggleFavorite(currentItem);
  }
});

restartButton.addEventListener("click", () => {
  videoPlayer.currentTime = 0;
  videoPlayer.play().catch(() => {});
});

videoPlayer.addEventListener("pause", () => {
  if (currentItem) {
    updateHistory(currentItem, videoPlayer.currentTime);
  }
});

videoPlayer.addEventListener("ended", () => {
  if (currentItem) {
    database.history = database.history.filter(
      historyItem => historyItem.id !== currentItem.id &&
        historyItem.url !== currentItem.url
    );

    saveDatabase();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../service-worker.js")
      .catch(error => {
        console.warn("Service Worker não registrado:", error);
      });
  });
}

render();