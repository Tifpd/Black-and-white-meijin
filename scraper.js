const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';

async function scrape() {
    try {
        let store = { seasons: {} };
        if (fs.existsSync(DATA_FILE)) {
            store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }

        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const tourLinks = [];

        // 1. Najdeme nové turnaje a zkontrolujeme, jestli už nejsou v libovolné sezóně
        $('a[href*="tour.phtml?t="]').each((i, el) => {
            const href = $(el).attr('href');
            const id = href.split('t=')[1].split('&')[0];
            
            let alreadyExists = false;
            for (let s in store.seasons) {
                if (store.seasons[s].history.find(t => t.id == id)) alreadyExists = true;
            }
            
            if (!alreadyExists) {
                tourLinks.push({ id, url: 'https://www.playok.com' + (href.startsWith('/') ? href : '/' + href) });
            }
        });

        console.log(`Nalezeno ${tourLinks.length} nových turnajů.`);

        for (const tour of tourLinks) {
            const tRes = await axios.get(tour.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $t = cheerio.load(tRes.data);
            
            // Určení sezóny (aktuální čas běhu bota)
            const now = new Date();
            const year = now.getFullYear();
            const half = now.getMonth() < 6 ? "H1" : "H2";
            const seasonKey = `${year}-${half}`;

            if (!store.seasons[seasonKey]) store.seasons[seasonKey] = { players: {}, history: [] };

            const players = [];
            $t('table tr').each((i, row) => {
                const cells = $t(row).find('td');
                if (cells.length >= 3) {
                    const nick = $t(cells[1]).text().trim();
                    const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                    if (nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                        players.push({ nick, body: score });
                        
                        // Zápis do statistik sezóny
                        let sP = store.seasons[seasonKey].players;
                        if (!sP[nick]) sP[nick] = { b: 0, u: 0 };
                        sP[nick].b += score;
                        sP[nick].u += 1;
                    }
                }
            });

            if (players.length > 0) {
                store.seasons[seasonKey].history.push({ 
                    id: tour.id, 
                    date: now.toISOString().split('T')[0], 
                    data: players 
                });
            }
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("Hotovo.");
    } catch (e) { console.error(e.message); }
}
scrape();
