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
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    ],
  });
  const page = await browser.newPage();
  return { browser, page };
}

async function scrollPage(page) {
  let lastHeight = await page.evaluate('document.body.scrollHeight');
  let scrollAttempts = 0;
  const maxAttempts = 10;
  while (scrollAttempts < maxAttempts) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const newHeight = await page.evaluate('document.body.scrollHeight');
    if (newHeight === lastHeight) {
      scrollAttempts++;
    } else {
      scrollAttempts = 0;
    }
    lastHeight = newHeight;
  }
}

async function scrapeGames(url) {
  const games = [];
  const seenGames = new Set();
  let browser, page;

  try {
    logger.info(`🟢 Acessando: ${url}`);
    ({ browser, page } = await setupPuppeteer());
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Scroll para carregar todos os jogos
    await scrollPage(page);

    // Espera até os cards aparecerem (até 30 segundos)
    await page.waitForSelector('a[data-card-mode="standard"]', { timeout: 30000 });

    // Pega todo o HTML
    const content = await page.content();
    const $ = cheerio.load(content);

    // Seleciona todos os cards dinamicamente pelo atributo data-card-mode
    const gameCards = $('a[data-card-mode="standard"]');
    logger.info(`🧩 Encontrados ${gameCards.length} cards`);

    for (let i = 0; i < gameCards.length; i++) {
      try {
        const card = $(gameCards[i]);

        // Times
        const teamElements = card.find('span.sc-eeDRCY.kXIsjf');
        if (teamElements.length < 2) {
          logger.warn(`❗ Card ${i + 1} não tem times suficientes`);
          continue;
        }
        const teamA = $(teamElements[0]).text().trim();
        const teamB = $(teamElements[1]).text().trim();
        const match = `${teamA} x ${teamB}`;

        // Horário - busca span com HH:mm
        let timeText = 'Não informado';
        card.find('span.sc-jXbUNg.zrfFX').each((_, el) => {
          const text = $(el).text().trim();
          if (/\d{1,2}:\d{2}/.test(text)) timeText = text;
        });

        // Logos
        const logoElements = card.find('img.sc-bXCLTC.xtAuF');
        const logoA = logoElements.length > 0 ? $(logoElements[0]).attr('src') : null;
        const logoB = logoElements.length > 1 ? $(logoElements[1]).attr('src') : null;

        // Canal fixo como 'Não informado'
        const channelText = 'Não informado';

        // Evita duplicatas
        const gameKey = `${match}_${timeText}`;
        if (!seenGames.has(gameKey)) {
          games.push({
            match,
            time: timeText,
            channel: channelText,
            logo_a: logoA,
            logo_b: logoB,
          });
          logger.info(`✅ ${match} às ${timeText} - Canal: ${channelText}`);
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
