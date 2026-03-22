const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';

async function scrape() {
    try {
        // 1. Načtení historie turnajů
        const response = await axios.get(STAT_URL);
        const $ = cheerio.load(response.data);
        const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        // Najdeme odkazy na turnaje (vypadají jako /en/tour.phtml?t=...)
        const tourLinks = [];
        $('a[href*="tour.phtml?t="]').each((i, el) => {
            const id = $(el).attr('href').split('t=')[1];
            if (!store.history.find(t => t.id == id)) {
                tourLinks.push({ id: id, url: 'https://www.playok.com' + $(el).attr('href') });
            }
        });

        if (tourLinks.length === 0) {
            console.log("No new tournaments found.");
            return;
        }

        console.log(`Found ${tourLinks.length} new tournaments. Processing...`);

        // 2. Projdeme nové turnaje a stáhneme výsledky
        for (const tour of tourLinks.reverse()) { // Od nejstaršího po nejnovější
            const tRes = await axios.get(tour.url);
            const $t = cheerio.load(tRes.data);
            const players = [];

            // Playok tabulka výsledků (často 4. nebo 5. tabulka na stránce)
            $t('table.clmn tr').each((i, row) => {
                const cells = $t(row).find('td');
                if (cells.length >= 2) {
                    const nick = $t(cells[1]).text().trim();
                    const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                    
                    if (nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
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
                console.log(`Added tournament ${tour.id} with ${players.length} players.`);
            }
        }

        // 3. Přepočet celkového žebříčku
        store.players = {};
        store.history.forEach(t => {
            t.data.forEach(p => {
                if (!store.players[p.nick]) store.players[p.nick] = { b: 0, u: 0 };
                store.players[p.nick].b += p.body;
                store.players[p.nick].u += 1;
            });
        });

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("Database updated successfully.");

    } catch (error) {
        console.error("Scraping failed:", error);
    }
}

scrape();
