const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy dinâmico para filmes e séries
app.use('/video/:type', createProxyMiddleware({
  target: 'http://65.109.31.123',
  changeOrigin: true,
  pathRewrite: (path, req) => {
    const type = req.params.type === 'series' ? 'series' : 'movie';
    const streamId = path.replace(`/video/${req.params.type}/`, '');
    // Manter o token de autenticação na URL
    return `/vauth/hKp29-74ledThOgXcmOYW4u1WHefcTvObdWj0TG_AKYJtATGaSsol1sBW-be_3tMQ3tZnRtQBqb8HMo1ZZhCF1eOvV-9aY3vfBW3vF1ir-kuVCMMR44N-waxZT6RBkHdOll5fwlpHTOcxxceSdnNIHbzavtyppAT2hXNB2-p7HL_aeAOifbQDWZ5AoNeehki7hyLa-75W_7aHHoiqIIF46GMXfh5SDD0zR4eZ99_em30Z14wux5fX8o5r9hZj9Fr8xg6NNFzCZks5eyFYx9_72h77JDnEiaj-JZxN1fEx3GytBnulc2St2g_b5P7hdAIkXZML7AXt8U1KydkqMQc8Q4WWj-le09JhbIFwjh386H3jwnV90mi-3FevNLkARmF42s0p0UliwlZJMotGmY1T4q33RTrg-CDSgGLkwX1D21ZX5Em2syPfqvcmh2GAxk04sQu3XqVB3exX1yz6KKzfmG1LbqzET5jq2OUk2VJ3i9cq6fE_bGesPZZAYA3p9Bimbm6OSeD566KpsEgHr_nwprayBp9v9Gm3palnMWusidgv3ayd4LftcPuvoHUuiUFG7bmCmBk9b8wf39OFCYyaXYbX0aIzrTGP1GYWarvi8rKh9T_AJb15c9PetQ21XniBwnpk2UNkkhPXT6oZqfcLg/${streamId}`;
  },
  onProxyReq: (proxyReq, req, res) => {
    if (req.headers.range) {
      proxyReq.setHeader('Range', req.headers.range);
    }
    console.log(`Proxying request to: http://65.109.31.123${proxyReq.path}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    proxyRes.headers['Access-Control-Allow-Origin'] = process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Range';
    proxyRes.headers['Content-Type'] = 'video/mp4';
    proxyRes.headers['Accept-Ranges'] = 'bytes';
    proxyRes.headers['Cache-Control'] = 'public, max-age=3600';
  },
  onError: (err, req, res) => {
    console.error('Erro no proxy:', err);
    res.status(500).json({ success: false, message: 'Erro ao carregar o vídeo. Tente novamente mais tarde.' });
  },
  secure: false,
}));

// Servir favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Credenciais admin
const adminCredentials = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin123'
};

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
app.get('/series_only.json', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'series_only.json'))
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
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, message: 'Login bem-sucedido' });
  } else {
    res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
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
      !newS.image ||
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
      !s.image ||
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
    res
      .status(500)
      .json({ success: false, message: 'Erro ao remover episódio: ' + e.message });
  }
});

// Inicia o servidor
app.listen(PORT, () =>
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
);
