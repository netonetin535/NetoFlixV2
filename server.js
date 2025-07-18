const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Configurar o proxy para vídeos com logs de depuração
app.use('/video', createProxyMiddleware({
  target: 'http://hsgbola1.xyz:80',
  changeOrigin: true,
  pathRewrite: {
    '^/video': '/movie/879446467/771463126',
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Proxy] Enviando solicitação para: ${proxyReq.path}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[Proxy] Resposta recebida para ${req.url} - Status: ${proxyRes.statusCode}`);
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type';
    proxyRes.headers['Content-Type'] = 'video/mp4';
  },
  onError: (err, req, res) => {
    console.error(`[Proxy] Erro ao processar ${req.url}:`, err);
    res.status(500).send(`Erro no proxy: ${err.message}`);
  },
  secure: false,
}));

// Middleware global para CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Servir favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Credenciais admin (use variáveis de ambiente em produção)
const adminCredentials = { username: 'admin', password: 'admin123' };

// Rotas públicas
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'netflix.html'))
);
app.get('/catalogo.json', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'catalogo.json'))
);
app.get('/series.json', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'series.json'))
);
app.get('/check-admin', (req, res) =>
  res.json({ isAdmin: req.cookies.adminToken === 'true' })
);

// Login / Logout
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === adminCredentials.username &&
    password === adminCredentials.password
  ) {
    res.cookie('adminToken', 'true', {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, message: 'Login bem-sucedido' });
  } else {
    res
      .status(401)
      .json({ success: false, message: 'Usuário ou senha incorretos' });
  }
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Logout bem-sucedido' });
});

// Middleware de autenticação
const isAuthenticated = (req, res, next) => {
  if (req.cookies.adminToken === 'true') return next();
  res.status(403).json({ success: false, message: 'Acesso não autorizado' });
};

// CRUD de filmes
app.post('/api/filmes', isAuthenticated, async (req, res) => {
  try {
    const caminho = path.join(__dirname, 'public', 'catalogo.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const newMovie = req.body;
    if (
      !newMovie.name ||
      !newMovie.title ||
      !newMovie.year ||
      !newMovie.stream_id ||
      !newMovie.stream_icon ||
      !newMovie.genre ||
      !newMovie.tmdb_id ||
      !newMovie.tmdb_name ||
      !newMovie.tmdb_url
    )
      return res
        .status(400)
        .json({ success: false, message: 'Campos obrigatórios ausentes' });
    if (dados.some(m => m.stream_id === newMovie.stream_id))
      return res
        .status(400)
        .json({ success: false, message: 'Stream ID já existe' });
    dados.push(newMovie);
    await fs.writeFile(caminho, JSON.stringify(dados, null, 2));
    res.json({ success: true, message: 'Filme adicionado com sucesso' });
  } catch (e) {
    console.error('[Filmes] Erro ao adicionar filme:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao adicionar filme: ' + e.message });
  }
});
app.put('/api/filmes/:stream_id', isAuthenticated, async (req, res) => {
  try {
    const sid = parseInt(req.params.stream_id);
    const caminho = path.join(__dirname, 'public', 'catalogo.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const idx = dados.findIndex(m => m.stream_id === sid);
    if (idx < 0)
      return res
        .status(404)
        .json({ success: false, message: 'Filme não encontrado' });
    dados[idx] = { ...dados[idx], ...req.body };
    const m = dados[idx];
    if (
      !m.name ||
      !m.title ||
      !m.year ||
      !m.stream_id ||
      !m.stream_icon ||
      !m.genre ||
      !m.tmdb_id ||
      !m.tmdb_name ||
      !m.tmdb_url
    )
      return res
        .status(400)
        .json({ success: false, message: 'Campos obrigatórios ausentes' });
    await fs.writeFile(caminho, JSON.stringify(dados, null, 2));
    res.json({ success: true, message: 'Filme editado com sucesso' });
  } catch (e) {
    console.error('[Filmes] Erro ao editar filme:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao editar filme: ' + e.message });
  }
});
app.delete('/api/filmes/:stream_id', isAuthenticated, async (req, res) => {
  try {
    const sid = parseInt(req.params.stream_id);
    const caminho = path.join(__dirname, 'public', 'catalogo.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const len0 = dados.length;
    const filtrados = dados.filter(m => m.stream_id !== sid);
    if (filtrados.length === len0)
      return res
        .status(404)
        .json({ success: false, message: 'Filme não encontrado' });
    await fs.writeFile(caminho, JSON.stringify(filtrados, null, 2));
    res.json({ success: true, message: 'Filme removido com sucesso' });
  } catch (e) {
    console.error('[Filmes] Erro ao remover filme:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao remover filme: ' + e.message });
  }
});

// CRUD de séries e episódios
app.post('/api/series', isAuthenticated, async (req, res) => {
  try {
    const caminho = path.join(__dirname, 'public', 'series.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const newS = req.body;
    if (
      !newS.name ||
      !newS.title ||
      !newS.year ||
      !newS.series_id ||
      !newS.cover ||
      !newS.genre ||
      !newS.tmdb_id ||
      !newS.tmdb_name
    )
      return res
        .status(400)
        .json({ success: false, message: 'Campos obrigatórios ausentes' });
    if (dados.some(s => s.series_id === newS.series_id))
      return res
        .status(400)
        .json({ success: false, message: 'Series ID já existe' });
    if (newS.episodes && !Array.isArray(newS.episodes))
      return res
        .status(400)
        .json({ success: false, message: 'Episódios devem ser array' });
    dados.push(newS);
    await fs.writeFile(caminho, JSON.stringify(dados, null, 2));
    res.json({ success: true, message: 'Série adicionada com sucesso' });
  } catch (e) {
    console.error('[Séries] Erro ao adicionar série:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao adicionar série: ' + e.message });
  }
});
app.put('/api/series/:series_id', isAuthenticated, async (req, res) => {
  try {
    const sid = parseInt(req.params.series_id);
    const caminho = path.join(__dirname, 'public', 'series.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const idx = dados.findIndex(s => s.series_id === sid);
    if (idx < 0)
      return res
        .status(404)
        .json({ success: false, message: 'Série não encontrada' });
    dados[idx] = { ...dados[idx], ...req.body };
    const s = dados[idx];
    if (
      !s.name ||
      !s.title ||
      !s.year ||
      !s.series_id ||
      !s.cover ||
      !s.genre ||
      !s.tmdb_id ||
      !s.tmdb_name
    )
      return res
        .status(400)
        .json({ success: false, message: 'Campos obrigatórios ausentes' });
    await fs.writeFile(caminho, JSON.stringify(dados, null, 2));
    res.json({ success: true, message: 'Série editada com sucesso' });
  } catch (e) {
    console.error('[Séries] Erro ao editar série:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao editar série: ' + e.message });
  }
});
app.delete('/api/series/:series_id', isAuthenticated, async (req, res) => {
  try {
    const sid = parseInt(req.params.series_id);
    const caminho = path.join(__dirname, 'public', 'series.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const filtrados = dados.filter(s => s.series_id !== sid);
    if (filtrados.length === dados.length)
      return res
        .status(404)
        .json({ success: false, message: 'Série não encontrada' });
    await fs.writeFile(caminho, JSON.stringify(filtrados, null, 2));
    res.json({ success: true, message: 'Série removida com sucesso' });
  } catch (e) {
    console.error('[Séries] Erro ao remover série:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao remover série: ' + e.message });
  }
});
app.put('/api/series/:series_id/episodios/:episode_id', isAuthenticated, async (req, res) => {
  try {
    const sid = parseInt(req.params.series_id);
    const eid = parseInt(req.params.episode_id);
    const caminho = path.join(__dirname, 'public', 'series.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const serie = dados.find(s => s.series_id === sid);
    if (!serie)
      return res
        .status(404)
        .json({ success: false, message: 'Série não encontrada' });
    const epIdx = serie.episodes?.findIndex(ep => ep.id === eid);
    if (epIdx == null || epIdx < 0)
      return res
        .status(404)
        .json({ success: false, message: 'Episódio não encontrado' });
    serie.episodes[epIdx] = { ...serie.episodes[epIdx], ...req.body };
    const ep = serie.episodes[epIdx];
    if (!ep.id || !ep.season || !ep.episode_num || !ep.title)
      return res
        .status(400)
        .json({ success: false, message: 'Campos obrigatórios ausentes' });
    await fs.writeFile(caminho, JSON.stringify(dados, null, 2));
    res.json({ success: true, message: 'Episódio editado com sucesso' });
  } catch (e) {
    console.error('[Episódios] Erro ao editar episódio:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao editar episódio: ' + e.message });
  }
});
app.delete('/api/series/:series_id/episodios/:episode_id', isAuthenticated, async (req, res) => {
  try {
    const sid = parseInt(req.params.series_id);
    const eid = parseInt(req.params.episode_id);
    const caminho = path.join(__dirname, 'public', 'series.json');
    const dados = JSON.parse(await fs.readFile(caminho, 'utf8') || '[]');
    const serie = dados.find(s => s.series_id === sid);
    if (!serie)
      return res
        .status(404)
        .json({ success: false, message: 'Série não encontrada' });
    const prevLen = serie.episodes?.length || 0;
    serie.episodes = serie.episodes?.filter(ep => ep.id !== eid) || [];
    if (serie.episodes.length === prevLen)
      return res
        .status(404)
        .json({ success: false, message: 'Episódio não encontrado' });
    await fs.writeFile(caminho, JSON.stringify(dados, null, 2));
    res.json({ success: true, message: 'Episódio removido com sucesso' });
  } catch (e) {
    console.error('[Episódios] Erro ao remover episódio:', e);
    res
      .status(500)
      .json({ success: false, message: 'Erro ao remover episódio: ' + e.message });
  }
});

// Inicia o servidor
const PORT = process.env.PORT || 8000;
app.listen(PORT, () =>
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
);
