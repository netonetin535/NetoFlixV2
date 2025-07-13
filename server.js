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

// Credenciais de admin hardcoded (para produção, use variáveis de ambiente ou banco de dados)
const adminCredentials = { username: 'admin', password: 'admin123' };

// Rota para o HTML principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para o JSON de jogos
app.get('/jogos.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'jogos.json'));
});

// Rota para o JSON de filmes
app.get('/catalogo.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'catalogo.json'));
});

// Rota para o JSON de séries
app.get('/series.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'series.json'));
});

// Rota para verificar status de admin
app.get('/check-admin', (req, res) => {
  const isAdmin = req.cookies.adminToken === 'true';
  res.json({ isAdmin });
});

// Rota para login administrativo
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === adminCredentials.username && password === adminCredentials.password) {
    res.cookie('adminToken', 'true', { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }); // Cookie válido por 24 horas
    res.json({ success: true, message: 'Login bem-sucedido' });
  } else {
    res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
  }
});

// Rota para logout
app.post('/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Logout bem-sucedido' });
});

// Middleware para verificar autenticação
const isAuthenticated = (req, res, next) => {
  if (req.cookies.adminToken === 'true') {
    return next();
  }
  res.status(403).json({ success: false, message: 'Acesso não autorizado' });
};

// Rota para atualizar jogos
app.post('/update', isAuthenticated, async (req, res) => {
  try {
    const jogosPath = path.join(__dirname, 'public', 'jogos.json');
    
    // Apagar o arquivo jogos.json existente, se houver
    try {
      await fs.unlink(jogosPath);
      console.log('Arquivo jogos.json existente apagado com sucesso.');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao apagar jogos.json:', error);
        throw error;
      }
      console.log('Nenhum jogos.json existente para apagar.');
    }

    // Executar o script de scraping
    const games = await scrapeGames('https://ge.globo.com/agenda');
    console.log('Script scraper.js executado com sucesso.');

    // Salvar os jogos
    await saveToJson(games);
    
    // Verificar se o arquivo jogos.json foi criado
    await fs.access(jogosPath);
    
    res.json({ success: true, message: 'Jogos atualizados com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar jogos: ' + error.message });
  }
});

// Rota para atualizar catalogo.json
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
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler catalogo.json:', error);
        throw error;
      }
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

// Rota para editar filme
app.post('/api/edit-movie', isAuthenticated, async (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'public', 'catalogo.json');
    const { stream_id, ...updatedFields } = req.body;

    if (!stream_id) {
      return res.status(400).json({ success: false, message: 'stream_id é obrigatório' });
    }

    let catalog = [];
    try {
      const data = await fs.readFile(catalogPath, 'utf8');
      catalog = JSON.parse(data);
      if (!Array.isArray(catalog)) {
        throw new Error('catalogo.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro aoavía ler catalogo.json:', error);
        throw error;
      }
    }

    const movieIndex = catalog.findIndex(movie => movie.stream_id === parseInt(stream_id));
    if (movieIndex === -1) {
      return res.status(404).json({ success: false, message: 'Filme não encontrado' });
    }

    catalog[movieIndex] = { ...catalog[movieIndex], ...updatedFields };

    const updatedMovie = catalog[movieIndex];
    if (!updatedMovie.name || !updatedMovie.title || !updatedMovie.year || !updatedMovie.stream_id ||
        !updatedMovie.stream_icon || !updatedMovie.genre || !updatedMovie.tmdb_id ||
        !updatedMovie.tmdb_name || !updatedMovie.tmdb_url) {
      return res.status(400).json({ success: false, message: 'Todos os campos do filme são obrigatórios após edição' });
    }

    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
    res.json({ success: true, message: 'Filme editado com sucesso' });
  } catch (error) {
    console.error('Erro ao editar filme:', error);
    res.status(500).json({ success: false, message: 'Erro ao editar filme: ' + error.message });
  }
});

// Rota para remover filme
app.post('/api/remove-movie', isAuthenticated, async (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'public', 'catalogo.json');
    const { stream_id } = req.body;

    if (!stream_id) {
      return res.status(400).json({ success: false, message: 'stream_id é obrigatório' });
    }

    let catalog = [];
    try {
      const data = await fs.readFile(catalogPath, 'utf8');
      catalog = JSON.parse(data);
      if (!Array.isArray(catalog)) {
        throw new Error('catalogo.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler catalogo.json:', error);
        throw error;
      }
    }

    const initialLength = catalog.length;
    catalog = catalog.filter(movie => movie.stream_id !== parseInt(stream_id));

    if (catalog.length === initialLength) {
      return res.status(404).json({ success: false, message: 'Filme não encontrado' });
    }

    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
    res.json({ success: true, message: 'Filme removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover filme:', error);
    res.status(500).json({ success: false, message: 'Erro ao remover filme: ' + error.message });
  }
});

// Rota para atualizar series.json
app.post('/api/update-series', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    let seriesCatalog = [];

    try {
      const data = await fs.readFile(seriesPath, 'utf8');
      seriesCatalog = JSON.parse(data);
      if (!Array.isArray(seriesCatalog)) {
        throw new Error('series.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler series.json:', error);
        throw error;
      }
    }

    const newSeries = req.body;

    if (!newSeries.name || !newSeries.title || !newSeries.year || !newSeries.series_id ||
        !newSeries.cover || !newSeries.genre || !newSeries.tmdb_id || !newSeries.tmdb_name) {
      return res.status(400).json({ success: false, message: 'Todos os campos da série são obrigatórios' });
    }

    if (seriesCatalog.some(series => series.series_id === newSeries.series_id)) {
      return res.status(400).json({ success: false, message: 'Série com este series_id já existe' });
    }

    if (newSeries.episodes && !Array.isArray(newSeries.episodes)) {
      return res.status(400).json({ success: false, message: 'Episódios devem ser um array' });
    }

    seriesCatalog.push(newSeries);
    await fs.writeFile(seriesPath, JSON.stringify(seriesCatalog, null, 2));
    res.json({ success: true, message: 'Série adicionada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar series.json:', error);
    res.status(500).json({ success: false, message: 'Erro ao adicionar série: ' + error.message });
  }
});

// Rota para editar série
app.post('/api/edit-series', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { series_id, ...updatedFields } = req.body;

    if (!series_id) {
      return res.status(400).json({ success: false, message: 'series_id é obrigatório' });
    }

    let seriesCatalog = [];
    try {
      const data = await fs.readFile(seriesPath, 'utf8');
      seriesCatalog = JSON.parse(data);
      if (!Array.isArray(seriesCatalog)) {
        throw new Error('series.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler series.json:', error);
        throw error;
      }
    }

    const seriesIndex = seriesCatalog.findIndex(series => series.series_id === parseInt(series_id));
    if (seriesIndex === -1) {
      return res.status(404).json({ success: false, message: 'Série não encontrada' });
    }

    seriesCatalog[seriesIndex] = { ...seriesCatalog[seriesIndex], ...updatedFields };

    const updatedSeries = seriesCatalog[seriesIndex];
    if (!updatedSeries.name || !updatedSeries.title || !updatedSeries.year || !updatedSeries.series_id ||
        !updatedSeries.cover || !updatedSeries.genre || !updatedSeries.tmdb_id || !updatedSeries.tmdb_name) {
      return res.status(400).json({ success: false, message: 'Todos os campos da série são obrigatórios após edição' });
    }

    await fs.writeFile(seriesPath, JSON.stringify(seriesCatalog, null, 2));
    res.json({ success: true, message: 'Série editada com sucesso' });
  } catch (error) {
    console.error('Erro ao editar série:', error);
    res.status(500).json({ success: false, message: 'Erro ao editar série: ' + error.message });
  }
});

// Rota para editar episódio
app.post('/api/edit-episode', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { series_id, episode_id, ...updatedFields } = req.body;

    if (!series_id || !episode_id) {
      return res.status(400).json({ success: false, message: 'series_id e episode_id são obrigatórios' });
    }

    let seriesCatalog = [];
    try {
      const data = await fs.readFile(seriesPath, 'utf8');
      seriesCatalog = JSON.parse(data);
      if (!Array.isArray(seriesCatalog)) {
        throw new Error('series.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler series.json:', error);
        throw error;
      }
    }

    const series = seriesCatalog.find(s => s.series_id === parseInt(series_id));
    if (!series) {
      return res.status(404).json({ success: false, message: 'Série não encontrada' });
    }

    const episodeIndex = series.episodes.findIndex(ep => ep.id === episode_id);
    if (episodeIndex === -1) {
      return res.status(404).json({ success: false, message: 'Episódio não encontrado' });
    }

    series.episodes[episodeIndex] = { ...series.episodes[episodeIndex], ...updatedFields };

    const updatedEpisode = series.episodes[episodeIndex];
    if (!updatedEpisode.id || !updatedEpisode.season || !updatedEpisode.episode_num || !updatedEpisode.title) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios do episódio (id, season, episode_num, title) devem estar presentes após edição' });
    }

    await fs.writeFile(seriesPath, JSON.stringify(seriesCatalog, null, 2));
    res.json({ success: true, message: 'Episódio editado com sucesso' });
  } catch (error) {
    console.error('Erro ao editar episódio:', error);
    res.status(500).json({ success: false, message: 'Erro ao editar episódio: ' + error.message });
  }
});

// Rota para remover série
app.post('/api/remove-series', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { series_id } = req.body;

    if (!series_id) {
      return res.status(400).json({ success: false, message: 'series_id é obrigatório' });
    }

    let seriesCatalog = [];
    try {
      const data = await fs.readFile(seriesPath, 'utf8');
      seriesCatalog = JSON.parse(data);
      if (!Array.isArray(seriesCatalog)) {
        throw new Error('series.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler series.json:', error);
        throw error;
      }
    }

    const initialLength = seriesCatalog.length;
    seriesCatalog = seriesCatalog.filter(series => series.series_id !== parseInt(series_id));

    if (seriesCatalog.length === initialLength) {
      return res.status(404).json({ success: false, message: 'Série não encontrada' });
    }

    await fs.writeFile(seriesPath, JSON.stringify(seriesCatalog, null, 2));
    res.json({ success: true, message: 'Série removida com sucesso' });
  } catch (error) {
    console.error('Erro ao remover série:', error);
    res.status(500).json({ success: false, message: 'Erro ao remover série: ' + error.message });
  }
});

// Rota para remover episódio
app.post('/api/remove-episode', isAuthenticated, async (req, res) => {
  try {
    const seriesPath = path.join(__dirname, 'public', 'series.json');
    const { series_id, episode_id } = req.body;

    if (!series_id || !episode_id) {
      return res.status(400).json({ success: false, message: 'series_id e episode_id são obrigatórios' });
    }

    let seriesCatalog = [];
    try {
      const data = await fs.readFile(seriesPath, 'utf8');
      seriesCatalog = JSON.parse(data);
      if (!Array.isArray(seriesCatalog)) {
        throw new Error('series.json não contém um array válido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Erro ao ler series.json:', error);
        throw error;
      }
    }

    const series = seriesCatalog.find(s => s.series_id === parseInt(series_id));
    if (!series) {
      return res.status(404).json({ success: false, message: 'Série não encontrada' });
    }

    const initialLength = series.episodes.length;
    series.episodes = series.episodes.filter(ep => ep.id !== episode_id);

    if (series.episodes.length === initialLength) {
      return res.status(404).json({ success: false, message: 'Episódio não encontrado' });
    }

    await fs.writeFile(seriesPath, JSON.stringify(seriesCatalog, null, 2));
    res.json({ success: true, message: 'Episódio removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover episódio:', error);
    res.status(500).json({ success: false, message: 'Erro ao remover episódio: ' + error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
