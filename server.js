const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cookieParser = require('cookie-parser');
const path = require('path');
const app = express();
const port = process.env.PORT || 8000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.set('trust proxy', true);

const VIDEO_AUTH_TOKEN = process.env.VIDEO_AUTH_TOKEN || 'default-token';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const authenticateAdmin = (req, res, next) => {
  const { username, password } = req.cookies;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    next();
  } else {
    res.redirect('/login');
  }
};

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', authenticateAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    res.cookie('username', username, { httpOnly: true });
    res.cookie('password', password, { httpOnly: true });
    res.redirect('/admin');
  } else {
    res.redirect('/login');
  }
});

const createVideoProxy = (type) => {
  return createProxyMiddleware({
    changeOrigin: true,
    target: 'http://65.109.31.123',
    pathRewrite: async (path, req) => {
      const streamId = path.split('/').pop().replace('.mp4', '');
      const primaryPath = `/series/879446467/771463126/${streamId}`;
      const fallbackPath = `/vauth/${VIDEO_AUTH_TOKEN}/${streamId}`;
      const hsgbolaPath = `http://hsgbola1.xyz:80/series/879446467/771463126/${streamId}.mp4`;

      console.log(`Tentando caminho primário para ${type}: http://65.109.31.123${primaryPath}`);
      console.log(`Caminho reserva para ${type}: http://65.109.31.123${fallbackPath}`);
      console.log(`Caminho hsgbola para ${type}: ${hsgbolaPath}`);

      try {
        const fetch = (await import('node-fetch')).default;
        // Tentar hsgbola1.xyz primeiro (já que funciona para filmes)
        const hsgbolaResponse = await fetch(hsgbolaPath, { method: 'HEAD' });
        if (hsgbolaResponse.ok) {
          console.log(`Proxying para hsgbola1.xyz: ${hsgbolaPath}`);
          return hsgbolaPath;
        }
        console.warn(`hsgbola1.xyz retornou ${hsgbolaResponse.status} para ${streamId}`);

        // Tentar caminho primário
        const primaryResponse = await fetch(`http://65.109.31.123${primaryPath}`, { method: 'HEAD' });
        if (primaryResponse.ok) {
          console.log(`Proxying para caminho primário: http://65.109.31.123${primaryPath}`);
          return primaryPath;
        }
        console.warn(`Caminho primário retornou ${primaryResponse.status} para ${streamId}`);

        // Tentar caminho reserva
        console.log(`Proxying para caminho reserva: http://65.109.31.123${fallbackPath}`);
        return fallbackPath;
      } catch (error) {
        console.error(`Erro ao verificar URLs para ${streamId}:`, error);
        return fallbackPath;
      }
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`Proxying request to: ${proxyReq.path}`);
      proxyReq.setHeader('Origin', 'http://65.109.31.123');
    },
    onError: (err, req, res) => {
      console.error('Erro no proxy:', err);
      res.status(500).send('Erro ao carregar o vídeo. Verifique o console para detalhes.');
    }
  });
};

app.use('/video/series', createVideoProxy('series'));
app.use('/video/movie', createVideoProxy('movie'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'netflix.html'));
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
