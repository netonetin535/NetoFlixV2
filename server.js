const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const cookieParser = require('cookie-parser');
const { scrapeGames, saveToJson } = require('./scraper');
const app = express();
const PORT = 8000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Suporte ao favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

const adminCredentials = { username: 'admin', password: 'admin123' };

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'netflix.html'));
});

app.get('/jogos.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'jogos.json'));
});

app.get('/catalogo.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'catalogo.json'));
});

app.get('/series.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'series.json'));
});

app.get('/check-admin', (req, res) => {
  const isAdmin = req.cookies.adminToken === 'true';
  res.json({ isAdmin });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === adminCredentials.username && password === adminCredentials.password) {
    res.cookie('adminToken', 'true', { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.json({ success: true, message: 'Login bem-sucedido' });
  } else {
    res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Logout bem-sucedido' });
});

const isAuthenticated = (req, res, next) => {
  if (req.cookies.adminToken === 'true') {
    return next();
  }
  res.status(403).json({ success: false, message: 'Acesso não autorizado' });
};

app.post('/update', isAuthenticated, async (req, res) => {
  try {
    const jogosPath = path.join(__dirname, 'public', 'jogos.json');
    try {
      await fs.unlink(jogosPath);
      console.log('Arquivo jogos.json existente apagado com sucesso.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log('Nenhum jogos.json existente para apagar.');
    }
    const games = await scrapeGames('https://ge.globo.com/agenda');
    console.log('Script scraper.js executado com sucesso.');
    await saveToJson(games);
    await fs.access(jogosPath);
    res.json({ success: true, message: 'Jogos atualizados com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar jogos: ' + error.message });
  }
});

app.post('/api/update-catalog', isAuthenticated, async (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'public', 'catalogo.json');
    let catalog = [];
    try {
      const data = await fs.readFile(catalogPath, 'utf8');
      catalog = JSON.parse(data);
      if (!Array.isArray(catalog)) {
        throw new Error('catalogo.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const newMovie = req.body;
    if (!newMovie.name || !newMovie.title || !newMovie.year || !newMovie.stream_id ||
        !newMovie.stream_icon || !newMovie.genre || !newMovie.tmdb_id ||
        !newMovie.tmdb_name || !newMovie.tmdb_url) {
      return res.status(400).json({ success: false, message: 'Todos os campos do filme são obrigatórios' });
    }
    if (catalog.some(movie => movie.stream_id === newMovie.stream_id)) {
      return res.status(400).json({ success: false, message: 'Filme com este stream_id já existe' });
    }
    catalog.push(newMovie);
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
    res.json({ success: true, message: 'Filme adicionado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar catalogo.json:', error);
    res.status(500).json({ success: false, message: 'Erro ao adicionar filme: ' + error.message });
  }
});

app.post('/api/edit-movie', isAuthenticated, async (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'public', 'catalogo.json');
    const updatedMovie = req.body;
    const data = await fs.readFile(catalogPath, 'utf8');
    const catalog = JSON.parse(data);
    const index = catalog.findIndex(movie => movie.stream_id === updatedMovie.stream_id);
    if (index === -1) return res.status(404).json({ success: false, message: 'Filme não encontrado' });
    catalog[index] = updatedMovie;
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
    res.json({ success: true, message: 'Filme editado com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao editar filme: ' + error.message });
  }
});

app.post('/api/remove-movie', isAuthenticated, async (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'public', 'catalogo.json');
    const { stream_id } = req.body;
    const data = await fs.readFile(catalogPath, 'utf8');
    let catalog = JSON.parse(data);
    catalog = catalog.filter(movie => movie.stream_id !== stream_id);
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
    res.json({ success: true, message: 'Filme removido com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao remover filme: ' + error.message });
  }
});

app.post('/api/update-series', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    let series = [];
    try {
      const data = await fs.readFile(seriesPath, 'utf8');
      series = JSON.parse(data);
      if (!Array.isArray(series)) throw new Error('series.json inválido');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const newSeries = req.body;
    if (!newSeries.name || !newSeries.tmdb_id || !newSeries.tmdb_url || !newSeries.episodes || !Array.isArray(newSeries.episodes)) {
      return res.status(400).json({ success: false, message: 'Dados da série incompletos ou inválidos' });
    }
    if (series.some(s => s.tmdb_id === newSeries.tmdb_id)) {
      return res.status(400).json({ success: false, message: 'Série com este tmdb_id já existe' });
    }
    series.push(newSeries);
    await fs.writeFile(seriesPath, JSON.stringify(series, null, 2));
    res.json({ success: true, message: 'Série adicionada com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao adicionar série: ' + error.message });
  }
});

app.post('/api/edit-series', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const updatedSeries = req.body;
    const data = await fs.readFile(seriesPath, 'utf8');
    const series = JSON.parse(data);
    const index = series.findIndex(s => s.tmdb_id === updatedSeries.tmdb_id);
    if (index === -1) return res.status(404).json({ success: false, message: 'Série não encontrada' });
    series[index] = updatedSeries;
    await fs.writeFile(seriesPath, JSON.stringify(series, null, 2));
    res.json({ success: true, message: 'Série editada com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao editar série: ' + error.message });
  }
});

app.post('/api/edit-episode', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { tmdb_id, episodeIndex, updatedEpisode } = req.body;
    const data = await fs.readFile(seriesPath, 'utf8');
    const series = JSON.parse(data);
    const seriesIndex = series.findIndex(s => s.tmdb_id === tmdb_id);
    if (seriesIndex === -1) return res.status(404).json({ success: false, message: 'Série não encontrada' });
    if (!series[seriesIndex].episodes || !Array.isArray(series[seriesIndex].episodes)) return res.status(400).json({ success: false, message: 'Episódios inválidos' });
    series[seriesIndex].episodes[episodeIndex] = updatedEpisode;
    await fs.writeFile(seriesPath, JSON.stringify(series, null, 2));
    res.json({ success: true, message: 'Episódio editado com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao editar episódio: ' + error.message });
  }
});

app.post('/api/remove-series', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { tmdb_id } = req.body;
    const data = await fs.readFile(seriesPath, 'utf8');
    let series = JSON.parse(data);
    series = series.filter(s => s.tmdb_id !== tmdb_id);
    await fs.writeFile(seriesPath, JSON.stringify(series, null, 2));
    res.json({ success: true, message: 'Série removida com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao remover série: ' + error.message });
  }
});

app.post('/api/remove-episode', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { tmdb_id, episodeIndex } = req.body;
    const data = await fs.readFile(seriesPath, 'utf8');
    const series = JSON.parse(data);
    const seriesIndex = series.findIndex(s => s.tmdb_id === tmdb_id);
    if (seriesIndex === -1) return res.status(404).json({ success: false, message: 'Série não encontrada' });
    series[seriesIndex].episodes.splice(episodeIndex, 1);
    await fs.writeFile(seriesPath, JSON.stringify(series, null, 2));
    res.json({ success: true, message: 'Episódio removido com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao remover episódio: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
