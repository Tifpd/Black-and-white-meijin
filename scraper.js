const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';
const MIN_DATE = new Date('2025-07-01'); // Ignorovat vše před tímto datem

async function scrape() {
    try {
        console.log("--- SEZÓNNÍ SCRAPER START ---");
        
        let store = { seasons: {} };
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            if (content.trim()) store = JSON.parse(content);
        }
        if (!store.seasons) store.seasons = {};

        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const tourLinks = [];

        $('a[href*="tour.phtml?t="]').each((i, el) => {
            const href = $(el).attr('href');
            const id = href.split('t=')[1].split('&')[0];
            
            let exists = false;
            for (let s in store.seasons) {
                if (store.seasons[s].history && store.seasons[s].history.find(t => t.id == id)) exists = true;
            }
            if (!exists) {
                tourLinks.push({ id, url: 'https://www.playok.com' + (href.startsWith('/') ? href : '/' + href) });
            }
        });

        console.log(`Nalezeno ${tourLinks.length} nových turnajů.`);

        for (const tour of tourLinks) {
            const tRes = await axios.get(tour.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $t = cheerio.load(tRes.data);
            
            // Určení sezóny (pro nové turnaje aktuální datum)
            const now = new Date();
            if (now < MIN_DATE) continue; 

            const year = now.getFullYear();
            const half = now.getMonth() < 6 ? "H1" : "H2";
            const seasonKey = `${year}-${half}`;

            if (!store.seasons[seasonKey]) {
                store.seasons[seasonKey] = { players: {}, history: [] };
            }

            const players = [];
            $t('table.clmn tr, table tr').each((i, row) => {
                const cells = $t(row).find('td');
                if (cells.length >= 3) {
                    const rankText = $t(cells[0]).text().trim();
                    const nick = $t(cells[1]).text().trim();
                    const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                    
                    if (rankText.match(/^\d+\.?$/) && nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                        players.push({ nick, body: score });
                        
                        const sPlayers = store.seasons[seasonKey].players;
                        if (!sPlayers[nick]) sPlayers[nick] = { b: 0, u: 0 };
                        sPlayers[nick].b += score;
                        sPlayers[nick].u += 1;
                    }
                }
            });

            if (players.length > 0) {
                store.seasons[seasonKey].history.push({ 
                    id: tour.id, 
                    date: now.toISOString().split('T')[0],
                    data: players 
                });
                console.log(`Uložen turnaj ${tour.id} do ${seasonKey}`);
            }
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("--- HOTOVO ---");
    } catch (e) { console.error("Chyba:", e.message); }
}
scrape();
