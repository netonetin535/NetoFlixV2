#!/bin/bash
# Instalar dependências do sistema para o Chrome
apt-get update
apt-get install -y wget gnupg ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils

# Instalar o Chrome para o Puppeteer
npx puppeteer browsers install chrome@stable

# Garantir que o cache do Puppeteer seja mantido
if [[ ! -d $PUPPETEER_CACHE_DIR ]]; then
  echo "Copiando cache do Puppeteer para o diretório correto"
  mkdir -p $PUPPETEER_CACHE_DIR
  cp -R /opt/render/.cache/puppeteer/* $PUPPETEER_CACHE_DIR
fi
