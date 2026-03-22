const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';
const SETTINGS_FILE = 'settings.json';

// --- NASTAVENÍ ZAČÁTKU AKTUÁLNÍ SEZÓNY ---
// Turnaje starší než toto datum bot do 2026-H1 nezapíše (pokud nejsou v settings)
const LIGA_START = new Date('2026-03-01'); 

async function scrape() {
    try {
        console.log("--- START SEZÓNNÍHO SCRAPERU ---");
        
        let store = { seasons: {} };
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            if (content.trim()) store = JSON.parse(content);
        }
        if (!store.seasons) store.seasons = {};

        let settings = { manualAssignments: {} };
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }

        let jobs = [];

        // A) NOVÉ TURNAJE (Automaticky z hlavní stránky statistik)
        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const now = new Date();
        const currentSeason = `${now.getFullYear()}-${now.getMonth() < 6 ? "H1" : "H2"}`;

        $('a[href*="tour.phtml?t="]').each((i, el) => {
            const id = $(el).attr('href').split('t=')[1].split('&')[0];
            
            // Kontrola: 1. Není už v databázi? 2. Je novější než náš LIGA_START?
            if (!isAlreadyStored(store, id) && now >= LIGA_START) {
                jobs.push({ id, season: currentSeason });
            }
        });

        // B) HISTORICKÉ TURNAJE (Z tvého settings.json - ty se zapíší vždy bez ohledu na datum)
        for (let sKey in settings.manualAssignments) {
            settings.manualAssignments[sKey].forEach(id => {
                if (!isAlreadyStored(store, id)) {
                    jobs.push({ id, season: sKey });
                }
            });
        }

        console.log(`Celkem k vyřízení: ${jobs.length} turnajů.`);

        for (let job of jobs) {
            console.log(`Zpracovávám turnaj ${job.id} pro ${job.season}...`);
            try {
                const tRes = await axios.get(`https://www.playok.com/en/tour.phtml?t=${job.id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $t = cheerio.load(tRes.data);
                
                if (!store.seasons[job.season]) store.seasons[job.season] = { players: {}, history: [] };

                const players = [];
                $t('table tr').each((i, row) => {
                    const cells = $t(row).find('td');
                    if (cells.length >= 3) {
                        const rankText = $t(cells[0]).text().trim();
                        const nick = $t(cells[1]).text().trim();
                        const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                        
                        // Validace: musí to mít pořadí (číslo), nick a platné skóre
                        if (rankText.match(/^\d+\.?$/) && nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                            players.push({ nick, body: score });
                            
                            let sP = store.seasons[job.season].players;
                            if (!sP[nick]) sP[nick] = { b: 0, u: 0 };
                            sP[nick].b += score;
                            sP[nick].u += 1;
                        }
                    }
                });

                if (players.length > 0) {
                    store.seasons[job.season].history.push({ id: job.id, data: players });
                }
                // Pauza 500ms, aby nás Playok nepovažoval za útok
                await new Promise(resolve => setTimeout(resolve, 500)); 
            } catch (err) {
                console.log(`Chyba u ID ${job.id}: ${err.message}`);
            }
        }

        // Seřazení historie podle ID (volitelné, pro pořádek v JSONu)
        for (let s in store.seasons) {
            store.seasons[s].history.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("--- HOTOVO ---");

    } catch (e) { console.error("Kritická chyba:", e.message); }
}

// Pomocná funkce: projde všechny sezóny a hledá, zda ID turnaje už existuje
function isAlreadyStored(store, id) {
    for (let s in store.seasons) {
        if (store.seasons[s].history && store.seasons[s].history.find(t => t.id == id)) return true;
    }
    return false;
}

scrape();
