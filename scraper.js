const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';
const SETTINGS_FILE = 'settings.json';

async function scrape() {
    try {
        console.log("--- MEIJIN SCRAPER START ---");
        
        // 1. Načtení nastavení (pokud neexistuje, použije se 2026)
        let settings = { startDate: "2026-01-01" };
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
        const filterDate = new Date(settings.startDate);
        console.log(`Filtering tournaments from: ${settings.startDate}`);

        // 2. Načtení databáze
        let store = { players: {}, history: [] };
        if (fs.existsSync(DATA_FILE)) {
            store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }

        // 3. Získání seznamu turnajů z Playoku
        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const tourLinks = [];

        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('tour.phtml?t=')) {
                const id = href.split('t=')[1].split('&')[0];
                // Přidáme jen ty, které ještě nemáme v historii
                if (!store.history.find(t => t.id == id)) {
                    tourLinks.push({ 
                        id: id, 
                        url: 'https://www.playok.com' + (href.startsWith('/') ? href : '/' + href) 
                    });
                }
            }
        });

        console.log(`Found ${tourLinks.length} new tournaments to process.`);

        // 4. Stažení dat z nových turnajů (BEZ LIMITU)
        for (const tour of tourLinks) {
            console.log(`Scraping tournament ${tour.id}...`);
            try {
                const tRes = await axios.get(tour.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $t = cheerio.load(tRes.data);
                
                // Playok obvykle nemá datum v tabulce, tak použijeme aktuální datum stažení
                // (Turnaje se stahují hned po odehrání, takže to odpovídá)
                const today = new Date().toISOString().split('T')[0]; 

                const players = [];
                $t('table tr').each((i, row) => {
                    const cells = $t(row).find('td');
                    if (cells.length >= 3) {
                        const rankText = $t(cells[0]).text().trim();
                        const nick = $t(cells[1]).text().trim();
                        const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                        
                        // Validace: první sloupec je číslo, nick existuje, skóre je číslo
                        if (rankText.match(/^\d+\.?$/) && nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                            players.push({ nick: nick, body: score });
                        }
                    }
                });

                if (players.length > 0) {
                    store.history.push({
                        id: tour.id,
                        date: today,
                        data: players
                    });
                }
            } catch (e) {
                console.log(`Failed to skip tournament ${tour.id}: ${e.message}`);
            }
        }

        // 5. PŘEPOČET ŽEBŘÍČKU (Tady se děje ta magie s rokem 2026)
        store.players = {}; // Vyčistíme starý žebříček a postavíme ho znovu
        
        store.history.forEach(t => {
            const tourDate = new Date(t.date);
            
            // Započítat body pouze pokud je turnaj v povoleném období
            if (tourDate >= filterDate) {
                t.data.forEach(p => {
                    if (!store.players[p.nick]) {
                        store.players[p.nick] = { b: 0, u: 0 };
                    }
                    store.players[p.nick].b += p.body;
                    store.players[p.nick].u += 1;
                });
            }
        });

        // 6. Uložení zpět do souboru
        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("--- SCRAPER FINISHED SUCCESSFULLY ---");

    } catch (error) {
        console.error("Critical error:", error.message);
    }
}

scrape();
