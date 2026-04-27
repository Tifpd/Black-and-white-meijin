const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const STAT_URL = 'https://www.playok.com/en/stat.phtml?u=gomokuworld&g=gm&sk=5';
const DATA_FILE = 'data.json';
const SETTINGS_FILE = 'settings.json';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const START_DATE_2026 = new Date('2026-01-01');

async function scrape() {
    try {
        console.log("--- STARTING SCRAPER (FIXED BYE HANDLING) ---");
        
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

        let potentialJobs = [];
        let newlyProcessedJobs = [];

        // 1. Fetch tournament IDs
        const response = await axios.get(STAT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        $('a[href*="tour.phtml?t="]').each((i, el) => {
            const id = $(el).attr('href').split('t=')[1].split('&')[0];
            if (!isAlreadyStored(store, id)) {
                potentialJobs.push({ id, type: 'auto' });
            }
        });

        // 2. Fetch IDs from manual settings
        for (let sKey in settings.manualAssignments) {
            settings.manualAssignments[sKey].forEach(id => {
                if (!isAlreadyStored(store, id)) {
                    potentialJobs.push({ id, type: 'manual', manualSeason: sKey });
                }
            });
        }

        console.log(`Checking ${potentialJobs.length} new tournaments...`);

        for (const job of potentialJobs) {
            try {
                const url = `https://www.playok.com/en/tour.phtml?t=${job.id}`;
                const tRes = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $t = cheerio.load(tRes.data);
                
                const infoText = $t('td.p_lt').first().text() || $t('body').text();
                const dateMatch = infoText.match(/(\d{4})-(\d{2})-(\d{2})/);
                
                let targetSeason = "";
                if (job.type === 'manual') {
                    targetSeason = job.manualSeason;
                } else if (dateMatch) {
                    const tourDate = new Date(dateMatch[0]);
                    if (tourDate >= START_DATE_2026) {
                        const half = tourDate.getMonth() < 6 ? "H1" : "H2";
                        targetSeason = `${tourDate.getFullYear()}-${half}`;
                    } else continue;
                }

                if (targetSeason) {
                    console.log(`Processing tournament ${job.id} for ${targetSeason}`);
                    if (!store.seasons[targetSeason]) store.seasons[targetSeason] = { players: {}, history: [] };
                    
                    let tournamentPlayers = [];
                    // FIXED: Reading the third column (Score) directly to handle 'bye' correctly
                    $t('table tr').each((i, row) => {
                        const cells = $t(row).find('td');
                        if (cells.length >= 3) {
                            const rank = $t(cells[0]).text().trim();
                            const nick = $t(cells[1]).text().trim();
                            const scoreText = $t(cells[2]).text().trim().replace(',', '.');
                            const score = parseFloat(scoreText);

                            if (rank.match(/^\d+\.?$/) && nick && !isNaN(score) && nick.toLowerCase() !== 'bye') {
                                if (!tournamentPlayers.find(p => p.nick === nick)) {
                                    tournamentPlayers.push({ nick, body: score });
                                }
                            }
                        }
                    });

                    tournamentPlayers.sort((a, b) => b.body - a.body);

                    tournamentPlayers.forEach((player, index) => {
                        let bonus = 0;
                        if (index === 0) bonus = 9;
                        else if (index === 1) bonus = 5;
                        else if (index === 2) bonus = 3;

                        let sP = store.seasons[targetSeason].players;
                        if (!sP[player.nick]) sP[player.nick] = { b: 0, bonus: 0, u: 0 };
                        
                        sP[player.nick].b += player.body;
                        sP[player.nick].bonus += bonus;
                        sP[player.nick].u += 1;
                    });

                    if (tournamentPlayers.length > 0) {
                        store.seasons[targetSeason].history.push({ id: job.id, data: tournamentPlayers });
                        newlyProcessedJobs.push({ id: job.id, season: targetSeason });
                    }
                }
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) { console.log(`Error at tournament ${job.id}: ${e.message}`); }
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));

        if (newlyProcessedJobs.length > 0 && DISCORD_WEBHOOK_URL) {
            await sendDiscordNotification(newlyProcessedJobs, store);
        }

        console.log("--- SCRAPE FINISHED ---");
    } catch (e) { console.error("Critical Error:", e.message); }
}

async function sendDiscordNotification(jobs, store) {
    for (const job of jobs) {
        const seasonData = store.seasons[job.season];
        const tournament = seasonData.history.find(t => t.id === job.id);
        if (!tournament) continue;

        const topPlayers = [...tournament.data].sort((a, b) => b.body - a.body).slice(0, 3);
        const seasonLabel = job.season.includes('H1') 
            ? job.season.replace('-H1', ' Black Meijin') 
            : job.season.replace('-H2', ' White Meijin');
            
        const color = job.season.includes('H1') ? 0x1a1a1a : 0xb08d57;

        const embed = {
            title: `🏆 Tournament Results: ${job.id}`,
            description: `Season: **${seasonLabel}**`,
            color: color,
            fields: [
                {
                    name: "Top 3 Players",
                    value: topPlayers.map((p, i) => `${i+1}. **${p.nick}** — ${p.body.toFixed(1)} points`).join('\n')
                },
                {
                    name: "Links",
                    value: `[View Standings](https://tifpd.github.io/Black-and-white-meijin/) | [PlayOK Results](https://www.playok.com/en/tour.phtml?t=${job.id})`
                }
            ]
        };

        try {
            await axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] });
        } catch (err) {
            console.error("Discord error:", err.message);
        }
    }
}

function isAlreadyStored(store, id) {
    for (let s in store.seasons) {
        if (store.seasons[s].history && store.seasons[s].history.find(t => t.id == id)) return true;
    }
    return false;
}

scrape();
