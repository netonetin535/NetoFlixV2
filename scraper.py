import json
import logging
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from bs4 import BeautifulSoup
import time
import re

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def setup_selenium():
    """Configura o driver do Selenium."""
    chrome_options = Options()
    chrome_options.add_argument('--headless')  # Rodar sem interface gráfica
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
    driver = webdriver.Chrome(options=chrome_options)
    return driver

def scroll_page(driver):
    """Rola a página para carregar todos os cards dinamicamente."""
    last_height = driver.execute_script("return document.body.scrollHeight")
    scroll_attempts = 0
    max_attempts = 5
    while scroll_attempts < max_attempts:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(3)
        new_height = driver.execute_script("return document.body.scrollHeight")
        if new_height == last_height:
            scroll_attempts += 1
        else:
            scroll_attempts = 0
        last_height = new_height

def scrape_games(url):
    """Extrai jogos ao vivo da página e retorna uma lista de dicionários."""
    games = []
    seen_games = set()  # Para evitar duplicatas
    try:
        driver = setup_selenium()
        logging.info("Acessando a página: %s", url)
        driver.get(url)
        time.sleep(3)

        # Rolar a página para carregar todos os cards
        scroll_page(driver)

        # Esperar os cards carregarem
        WebDriverWait(driver, 10).until(
            EC.presence_of_all_elements_located((By.CLASS_NAME, 'eventGrouperstyle__MomentsWrapper-sc-1bz1qr-1'))
        )

        soup = BeautifulSoup(driver.page_source, 'html.parser')

        # Buscar todos os cards de jogos
        game_cards = soup.find_all(['div', 'section'], class_=lambda x: x and any(cls in x for cls in ['eventGrouperstyle__MomentsWrapper-sc-1bz1qr-1', 'sc-eldPxv', 'sc-jlZhew', 'sc-dhKdcB']))

        logging.info("Encontrados %d cards potenciais de jogos", len(game_cards))

        for i, card in enumerate(game_cards):
            try:
                # Extrair times
                team_elements = card.find_all('span', class_='sc-eeDRCY kXIsjf')
                if len(team_elements) >= 2:
                    team_a = team_elements[0].get_text(strip=True)
                    team_b = team_elements[1].get_text(strip=True)
                    match = f"{team_a} x {team_b}"
                else:
                    match = None

                # Extrair horário
                game_time = card.find('span', class_='sc-jXbUNg zrfFX', string=re.compile(r'\d{1,2}:\d{2}'))
                time_text = game_time.get_text(strip=True) if game_time else "Não informado"

                # Extrair escudos
                logo_elements = card.find_all('img', class_='sc-bXCLTC xtAuF')
                logo_a = logo_elements[0].get('src') if len(logo_elements) > 0 else None
                logo_b = logo_elements[1].get('src') if len(logo_elements) > 1 else None

                # Verificar duplicata antes de processar o canal
                game_key = f"{match}_{time_text}"
                if match and time_text != "Não informado" and game_key not in seen_games:
                    channel_text = "Não informado"
                    channel_button = card.find('div', class_=['sc-fUnMCh', 'hOA-dLP'])
                    if channel_button and "Onde assistir?" in channel_button.get_text(strip=True):
                        try:
                            button_xpath = f"//div[contains(@class, 'sc-fUnMCh') and contains(@class, 'hOA-dLP') and contains(text(), 'Onde assistir?')]"
                            button_element = WebDriverWait(driver, 5).until(
                                EC.element_to_be_clickable((By.XPATH, button_xpath))
                            )
                            driver.execute_script("arguments[0].scrollIntoView(true);", button_element)
                            actions = ActionChains(driver)
                            actions.move_to_element(button_element).click().perform()
                            logging.info("Clique em 'Onde assistir?' realizado no card %d", i+1)
                            time.sleep(3)  # Aumentar tempo para popup carregar
                            # Esperar pela popup e extrair texto visível
                            channel_elements = WebDriverWait(driver, 5).until(
                                EC.presence_of_all_elements_located((By.XPATH, "//*[contains(@class, 'modal') or contains(@class, 'popup')]//text()[normalize-space()]"))
                            )
                            channel_text = next((el.strip() for el in channel_elements if any(keyword in el.strip().lower() for keyword in ['sportv', 'globoplay', 'cazétv'])), "Não informado")
                            logging.info("Canal extraído do card %d: %s", i+1, channel_text)
                            # Tentar fechar a popup
                            actions.move_to_element(button_element).click().perform()
                        except Exception as e:
                            logging.warning("Falha ao extrair canal do card %d: %s", i+1, e)
                            channel_text = "SporTV"

                    games.append({
                        "match": match,
                        "time": time_text,
                        "channel": channel_text,
                        "logo_a": logo_a,
                        "logo_b": logo_b
                    })
                    logging.info("Jogo encontrado: %s, Horário: %s, Canal: %s, Logo A: %s, Logo B: %s", match, time_text, channel_text, logo_a, logo_b)
                    seen_games.add(game_key)
                else:
                    logging.debug("Card %d ignorado (duplicata ou dados incompletos): %s", i+1, card.prettify()[:200])

            except AttributeError as e:
                logging.warning("Erro ao processar card de jogo %d: %s", i+1, e)
                continue

        return games

    except Exception as e:
        logging.error("Erro ao acessar a página: %s", e)
        return []
    finally:
        driver.quit()

def save_to_json(games, filename=os.path.join("public", "jogos.json")):
    """Salva os dados dos jogos em um arquivo JSON na pasta public."""
    try:
        # Criar a pasta public se não existir
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(games, f, ensure_ascii=False, indent=4)
        logging.info("Dados salvos em %s", filename)
    except IOError as e:
        logging.error("Erro ao salvar JSON: %s", e)

def main():
    url = "https://ge.globo.com/agenda"
    logging.info("Iniciando processo de scraping para %s", url)

    # Extrair jogos
    games = scrape_games(url)
    logging.info("Encontrados %d jogos", len(games))

    # Salvar em JSON
    if games:
        save_to_json(games)
    else:
        logging.warning("Nenhum jogo encontrado para salvar.")

if __name__ == "__main__":
    main()