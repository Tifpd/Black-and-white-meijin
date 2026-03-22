const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';
const SETTINGS_FILE = 'settings.json';

async function scrape() {
    try {
        console.log("Starting scraper...");
        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        
        let store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        let settings = { startDate: "2026-01-01" };
        
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }

        const startDate = new Date(settings.startDate);
        const tourLinks = [];

        // Hledání odkazů na turnaje
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('tour.phtml?t=')) {
                const id = href.split('t=')[1].split('&')[0];
                if (!store.history.find(t => t.id == id)) {
                    tourLinks.push({ id: id, url: 'https://www.playok.com' + (href.startsWith('/') ? href : '/' + href) });
                }
            }
        });

        console.log(`New tournaments found: ${tourLinks.length}`);

        // Zpracování nových turnajů
        for (const tour of tourLinks) {
            console.log(`Processing ${tour.id}...`);
            const tRes = await axios.get(tour.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $t = cheerio.load(tRes.data);
            
            // Získání data z turnaje (Playok ho má obvykle v hlavičce nebo u popisu)
            // Pokud ho nenajdeme přesně, použijeme dnešní datum pro nové turnaje
            let dateStr = new Date().toISOString().split('T')[0]; 
            
            const players = [];
            $t('table tr').each((i, row) => {
                const cells = $t(row).find('td');
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
                    date: dateStr, // Ukládáme ve formátu YYYY-MM-DD pro lepší řazení
                    data: players
                });
            }
        }

        // --- PŘEPOČET ŽEBŘÍČKU PODLE FILTRU ---
        store.players = {};
        store.history.forEach(t => {
            const tourDate = new Date(t.date);
            if (tourDate >= startDate) {
                t.data.forEach(p => {
                    if (!store.players[p.nick]) store.players[p.nick] = { b: 0, u: 0 };
                    store.players[p.nick].b += p.body;
                    store.players[p.nick].u += 1;
                });
            }
        });

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log(`Update complete. Filtering from: ${settings.startDate}`);

    } catch (error) {
        console.error("Error:", error.message);
    }
}

scrape();
