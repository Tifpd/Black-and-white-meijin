const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';

async function scrape() {
    try {
        console.log("Fetching stats page...");
        const response = await axios.get(STAT_URL, {
            headers: { 'User-Agent': 'Mozilla/5.0' } // Předstíráme, že jsme prohlížeč
        });
        
        const $ = cheerio.load(response.data);
        let store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (!store.history) store = { players: {}, history: [] };

        const tourLinks = [];
        // Hledáme všechny odkazy, které obsahují tour.phtml
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('tour.phtml?t=')) {
                const id = href.split('t=')[1].split('&')[0]; // Očistíme ID od případných dalších parametrů
                if (!store.history.find(t => t.id == id)) {
                    tourLinks.push({ id: id, url: 'https://www.playok.com' + (href.startsWith('/') ? href : '/' + href) });
                }
            }
        });

        console.log(`Detected unique tournament links: ${tourLinks.length}`);

        if (tourLinks.length === 0) {
            console.log("No new or valid tournaments found. Check if the URL is correct or if Playok changed the layout.");
            return;
        }

        for (const tour of tourLinks.slice(0, 5)) { // Zkusíme nejdřív prvních 5 nejnovějších
            console.log(`Processing tournament ID: ${tour.id}...`);
            const tRes = await axios.get(tour.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $t = cheerio.load(tRes.data);
            const players = [];

            // Playok tabulka výsledků - zkusíme najít jakoukoli tabulku s daty
            $t('table tr').each((i, row) => {
                const cells = $t(row).find('td');
                // Hledáme řádky, kde je v prvním sloupci číslo (pořadí) a ve druhém nick
                if (cells.length >= 3) {
                    const rankText = $t(cells[0]).text().trim();
                    const nick = $t(cells[1]).text().trim();
                    const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                    
                    if (rankText.match(/^\d+\.?$/) && nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                        players.push({ nick: nick, body: score });
                    }
                }
            });

            if (players.length > 0) {
                store.history.push({
                    id: tour.id,
                    date: new Date().toLocaleDateString('en-GB'),
                    data: players
                });
                console.log(`Successfully added ${players.length} players from tournament ${tour.id}`);
            } else {
                console.log(`Could not find player data in tournament ${tour.id}.`);
            }
        }

        // Přepočet
        store.players = {};
        store.history.forEach(t => {
            t.data.forEach(p => {
                if (!store.players[p.nick]) store.players[p.nick] = { b: 0, u: 0 };
                store.players[p.nick].b += p.body;
                store.players[p.nick].u += 1;
            });
        });

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("All done!");

    } catch (error) {
        console.error("Scraping error:", error.message);
    }
}

scrape();
