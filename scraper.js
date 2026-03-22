const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';
const SETTINGS_FILE = 'settings.json';

// --- FILTR PODLE DATA ---
// Bot bude ignorovat automatické turnaje starší než toto datum
const START_DATE_2026 = new Date('2026-01-01');

async function scrape() {
    try {
        console.log("--- START SCRAPERU S DATOVÝM FILTREM ---");
        
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

        // Seznam všech ID k prověření (z Playoku i ze settings)
        let potentialJobs = [];

        // 1. Získáme ID z hlavní stránky Playoku
        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        $('a[href*="tour.phtml?t="]').each((i, el) => {
            const id = $(el).attr('href').split('t=')[1].split('&')[0];
            if (!isAlreadyStored(store, id)) {
                potentialJobs.push({ id, type: 'auto' });
            }
        });

        // 2. Přidáme ID ze settings (pokud tam jsou nová)
        for (let sKey in settings.manualAssignments) {
            settings.manualAssignments[sKey].forEach(id => {
                if (!isAlreadyStored(store, id)) {
                    potentialJobs.push({ id, type: 'manual', manualSeason: sKey });
                }
            });
        }

        console.log(`Prověřuji ${potentialJobs.length} turnajů...`);

        for (const job of potentialJobs) {
            try {
                const url = `https://www.playok.com/en/tour.phtml?t=${job.id}`;
                const tRes = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $t = cheerio.load(tRes.data);
                
                // Získání data turnaje přímo z podstránky
                // Playok obvykle píše datum v hlavičce tabulky nebo nad ní
                const infoText = $t('td.p_lt').first().text() || $t('body').text();
                const dateMatch = infoText.match(/(\d{4})-(\d{2})-(\d{2})/);
                
                let targetSeason = "";
                
                if (job.type === 'manual') {
                    // Pokud je to ze settings, sezónu už známe
                    targetSeason = job.manualSeason;
                } else if (dateMatch) {
                    // Pokud je to automatika, zkontrolujeme datum
                    const tourDate = new Date(dateMatch[0]);
                    if (tourDate >= START_DATE_2026) {
                        const half = tourDate.getMonth() < 6 ? "H1" : "H2";
                        targetSeason = `${tourDate.getFullYear()}-${half}`;
                    } else {
                        console.log(`Skipping old tournament ${job.id} from ${dateMatch[0]}`);
                        continue;
                    }
                }

                if (targetSeason) {
                    console.log(`Ukládám turnaj ${job.id} do ${targetSeason}`);
                    if (!store.seasons[targetSeason]) store.seasons[targetSeason] = { players: {}, history: [] };
                    
                    const players = [];
                    $t('table tr').each((i, row) => {
                        const cells = $t(row).find('td');
                        if (cells.length >= 3) {
                            const rank = $t(cells[0]).text().trim();
                            const nick = $t(cells[1]).text().trim();
                            const score = parseFloat($t(cells[2]).text().replace(',', '.'));
                            if (rank.match(/^\d+\.?$/) && nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                                players.push({ nick, body: score });
                                let sP = store.seasons[targetSeason].players;
                                if (!sP[nick]) sP[nick] = { b: 0, u: 0 };
                                sP[nick].b += score;
                                sP[nick].u += 1;
                            }
                        }
                    });

                    if (players.length > 0) {
                        store.seasons[targetSeason].history.push({ id: job.id, data: players });
                    }
                }
                await new Promise(r => setTimeout(r, 600)); 
            } catch (e) { console.log(`Error at ${job.id}: ${e.message}`); }
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
        console.log("--- HOTOVO ---");
    } catch (e) { console.error(e.message); }
}

function isAlreadyStored(store, id) {
    for (let s in store.seasons) {
        if (store.seasons[s].history && store.seasons[s].history.find(t => t.id == id)) return true;
    }
    return false;
}

scrape();
