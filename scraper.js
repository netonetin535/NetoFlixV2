const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const cheerio = require('cheerio');

// Configurar logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

async function setupPuppeteer() {
  const browser = await puppeteer.launch({
    headless: 'new', // Novo modo headless recomendado
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/render/.cache/puppeteer/chrome/linux/chrome-linux64/chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    ],
  });
  const page = await browser.newPage();
  // Configurar viewport para simular um dispositivo desktop
  await page.setViewport({ width: 1280, height: 720 });
  return { browser, page };
}

async function scrollPage(page) {
  let lastHeight = await page.evaluate('document.body.scrollHeight');
  let scrollAttempts = 0;
  const maxAttempts = 10;
  while (scrollAttempts < maxAttempts) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Aguarda carregamento dinâmico
    const newHeight = await page.evaluate('document.body.scrollHeight');
    if (newHeight === lastHeight) {
      scrollAttempts++;
    } else {
      scrollAttempts = 0;
    }
    lastHeight = newHeight;
  }
}

async function extractStreamLink(page, cardUrl) {
  try {
    // Navegar até a página do jogo
    await page.goto(cardUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.content();
    const $ = cheerio.load(content);

    // Tentar encontrar links M3U8 ou outros links de streaming
    let streamLink = null;
    const videoElements = $('video source, a[href$=".m3u8"], script');
    for (let i = 0; i < videoElements.length; i++) {
      const element = $(videoElements[i]);
      const src = element.attr('src') || element.attr('href') || element.text();
      if (src && src.includes('.m3u8')) {
        streamLink = src;
        break;
      }
    }

    // Se não encontrar diretamente, buscar em scripts ou iframes
    if (!streamLink) {
      const scripts = $('script').text();
      const m3u8Match = scripts.match(/(https?:\/\/[^\s]*\.m3u8)/);
      if (m3u8Match) streamLink = m3u8Match[0];
    }

    return streamLink || 'Não informado';
  } catch (e) {
    logger.warn(`❌ Erro ao extrair link de streaming para ${cardUrl}: ${e.message}`);
    return 'Não informado';
  }
}

async function scrapeGames(url) {
  const games = [];
  const seenGames = new Set();
  let browser, page;

  try {
    logger.info(`🟢 Acessando: ${url}`);
    ({ browser, page } = await setupPuppeteer());

    // Interceptar requisições para bloquear recursos desnecessários
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Scroll para carregar todos os jogos
    await scrollPage(page);

    // Espera até os cards aparecerem (até 60 segundos)
    await page.waitForSelector('a[data-card-mode="standard"]', { timeout: 60000 });

    // Pega todo o HTML
    const content = await page.content();
    const $ = cheerio.load(content);

    // Seleciona todos os cards dinamicamente pelo atributo data-card-mode
    const gameCards = $('a[data-card-mode="standard"]');
    logger.info(`🧩 Encontrados ${gameCards.length} cards`);

    for (let i = 0; i < gameCards.length; i++) {
      try {
        const card = $(gameCards[i]);
        const cardUrl = card.attr('href');
        if (!cardUrl) {
          logger.warn(`❗ Card ${i + 1} sem URL`);
          continue;
        }

        // Times
        const teamElements = card.find('span.sc-eeDRCY.kXIsjf');
        if (teamElements.length < 2) {
          logger.warn(`❗ Card ${i + 1} não tem times suficientes`);
          continue;
        }
        const teamA = $(teamElements[0]).text().trim();
        const teamB = $(teamElements[1]).text().trim();
        const match = `${teamA} x ${teamB}`;

        // Horário
        let timeText = 'Não informado';
        card.find('span.sc-jXbUNg.zrfFX').each((_, el) => {
          const text = $(el).text().trim();
          if (/\d{1,2}:\d{2}/.test(text)) timeText = text;
        });

        // Logos
        const logoElements = card.find('img.sc-bXCLTC.xtAuF');
        const logoA = logoElements.length > 0 ? $(logoElements[0]).attr('src') : null;
        const logoB = logoElements.length > 1 ? $(logoElements[1]).attr('src') : null;

        // Canal
        let channelText = 'Não informado';
        card.find('span').each((_, el) => {
          const text = $(el).text().trim();
          if (text.toLowerCase().includes('tv') || text.toLowerCase().includes('canal')) {
            channelText = text;
          }
        });

        // Link de streaming
        const streamLink = await extractStreamLink(page, cardUrl);

        // Evita duplicatas
        const gameKey = `${match}_${timeText}`;
        if (!seenGames.has(gameKey)) {
          games.push({
            match,
            time: timeText,
            channel: channelText,
            logo_a: logoA,
            logo_b: logoB,
            stream_link: streamLink,
          });
          logger.info(`✅ ${match} às ${timeText} - Canal: ${channelText} - Stream: ${streamLink}`);
          seenGames.add(gameKey);
        }

      } catch (e) {
        logger.warn(`❌ Erro no card ${i + 1}: ${e.message}`);
      }
    }

    return games;

  } catch (e) {
    logger.error(`❌ Erro durante scraping: ${e.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

async function saveToJson(games, filename = path.join('public', 'jogos.json')) {
  try {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(games, null, 4), 'utf-8');
    logger.info(`📁 Salvo em: ${filename}`);
  } catch (e) {
    logger.error(`❌ Erro ao salvar JSON: ${e.message}`);
  }
}

async function main() {
  const url = 'https://ge.globo.com/agenda';
  logger.info(`🚀 Iniciando scraping para ${url}`);

  const games = await scrapeGames(url);
  logger.info(`📊 Total de jogos extraídos: ${games.length}`);

  if (games.length > 0) {
    await saveToJson(games);
  } else {
    logger.warn('⚠ Nenhum jogo encontrado. Verifique se a estrutura HTML mudou.');
  }
}

if (require.main === module) {
  main();
}

module.exports = { scrapeGames, saveToJson };
