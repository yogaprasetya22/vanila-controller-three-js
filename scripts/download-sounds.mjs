import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { parseFile } from "music-metadata";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "sounds");

// Search query + expected max duration presets
const TARGETS = [
    { name: "slash.mp3", search: "sword slash", max: 3 },
    { name: "bow.mp3", search: "bow arrow", max: 3 },
    { name: "fireball.mp3", search: "explosion boom", max: 3 },
    { name: "magic_cast.mp3", search: "magic spell whoosh", max: 3 },
    { name: "heal.mp3", search: "magic sparkle", max: 3 },
    { name: "victory.mp3", search: "victory fanfare", max: 3 },
];

const CONCURRENCY_LIMIT = 5;

async function scrapeDetailUrls(page, search, workerName) {
    await page.goto(
        `https://pixabay.com/sound-effects/search/${encodeURIComponent(search)}/`,
        { waitUntil: "networkidle", timeout: 60000 },
    );
    await page.waitForTimeout(3000);

    const entries = await page.$$eval("body", ([body]) => {
        const html = body.innerHTML;
        const result = [];
        const regex =
            /(\d+):(\d{2})\s*[\s\S]*?href="(\/sound-effects\/[^"]*?\d[^"]*)"/g;
        let m;
        while ((m = regex.exec(html))) {
            const dur = parseInt(m[1]) * 60 + parseInt(m[2]);
            const href = "https://pixabay.com" + m[3];
            result.push({ dur, href });
        }
        return result;
    });

    console.log(
        `[${workerName}] Found ${entries.length} entries for "${search}"`,
    );
    return entries.sort((a, b) => a.dur - b.dur);
}

async function processTarget(browser, t, workerId) {
    const workerName = `W-${workerId}`;
    console.log(`[${workerName}] ⬇ Mulai: ${t.name} (mencari ${t.count} asset)`);

    const ctx = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    });
    const page = await ctx.newPage();

    try {
        const candidates = await scrapeDetailUrls(page, t.search, workerName);
        // Ambil lebih banyak kandidat untuk dicoba agar bisa mendownload sebanyak target count
        const valid = candidates.filter((c) => c.dur <= t.max).slice(0, Math.max(15, t.count * 3));

        if (valid.length === 0) {
            console.log(`[${workerName}] ✗ no match untuk ${t.name}`);
            return false;
        }

        let downloadedCount = 0;

        for (const entry of valid) {
            if (downloadedCount >= t.count) {
                break;
            }

            let mp3Buf = null;

            // Listener untuk menangkap file mp3
            const responseListener = async (r) => {
                if (
                    !mp3Buf &&
                    (r.url().endsWith(".mp3") || r.url().includes(".mp3?")) &&
                    r.status() < 400
                ) {
                    try {
                        mp3Buf = Buffer.from(await r.body());
                    } catch {}
                }
            };
            page.on("response", responseListener);

            console.log(
                `[${workerName}] → Coba ${entry.href.split("/").slice(-2, -1)[0]} (${entry.dur}s)`,
            );

            try {
                await page.goto(entry.href, {
                    waitUntil: "domcontentloaded",
                    timeout: 30000,
                });
                await page.waitForTimeout(2000);

                // Klik tombol play
                await page.evaluate(() => {
                    for (const el of document.querySelectorAll(
                        "button, [role='button'], div[class*='play'], svg[class*='play']",
                    )) {
                        const s = (
                            (el.getAttribute("aria-label") || "") +
                            (el.className || "") +
                            (el.textContent || "")
                        ).toLowerCase();
                        if (s.includes("play")) {
                            el.click();
                            return;
                        }
                    }
                });

                // Tunggu sampai buffer mp3 terisi
                for (let i = 0; i < 20 && !mp3Buf; i++) {
                    await page.waitForTimeout(500);
                }
            } catch (err) {
                console.log(`[${workerName}] ⚠ Error loading entry: ${err.message}`);
            } finally {
                page.off("response", responseListener);
            }

            if (mp3Buf) {
                const ext = t.name.endsWith(".mp3") ? ".mp3" : "";
                const baseName = t.name.replace(/\.mp3$/, "");
                // Format penamaan: nama_1.mp3, nama_2.mp3, dst. Jika count cuma 1, gunakan nama asli.
                const fileName = t.count > 1 ? `${baseName}_${downloadedCount + 1}${ext}` : t.name;

                const outPath = join(OUT_DIR, fileName);
                writeFileSync(outPath, mp3Buf);
                const meta = await parseFile(outPath);
                console.log(
                    `[${workerName}] ✓ ${fileName} tersimpan | ${meta.format.duration.toFixed(1)}s | ${(mp3Buf.length / 1024).toFixed(1)} KB`,
                );
                downloadedCount++;
            }
        }

        if (downloadedCount > 0) {
            console.log(`[${workerName}] ✓ Selesai mendownload ${downloadedCount}/${t.count} asset untuk ${t.name}`);
            return true;
        } else {
            console.log(`[${workerName}] ✗ Gagal mendownload asset apa pun untuk ${t.name}`);
            return false;
        }
    } catch (e) {
        console.log(`[${workerName}] ✗ Error ${t.name}: ${e.message}`);
        return false;
    } finally {
        await ctx.close();
    }
}

async function main() {
    console.log("🎵 Pixabay Sound Downloader & Searcher\n");
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

    // Parsing arguments
    const args = process.argv.slice(2);
    let targetsToProcess = TARGETS;

    if (args.length > 0) {
        const key = args[0].toLowerCase();
        // find matching target by name or keyword (e.g. "bow" or "heal")
        const found = TARGETS.find(t => t.name.startsWith(key) || t.name === key + ".mp3");
        if (found) {
            const customSearch = args[1] || found.search;
            const customMax = args[2] ? parseInt(args[2], 10) : found.max;
            const count = args[3] ? parseInt(args[3], 10) : 1;
            targetsToProcess = [{
                name: found.name,
                search: customSearch,
                max: customMax,
                count: count
            }];
            console.log(`🎯 Target Preset: ${found.name}`);
            console.log(`🔍 Search Query: "${customSearch}"`);
            console.log(`⏱ Max Duration: ${customMax}s`);
            console.log(`🔢 Jumlah Asset: ${count}\n`);
        } else {
            // Treat as custom target download
            const name = key.endsWith(".mp3") ? key : key + ".mp3";
            const customSearch = args[1] || key.replace(".mp3", "");
            const customMax = args[2] ? parseInt(args[2], 10) : 5;
            const count = args[3] ? parseInt(args[3], 10) : 1;
            targetsToProcess = [{
                name: name,
                search: customSearch,
                max: customMax,
                count: count
            }];
            console.log(`🎯 Custom Target: ${name}`);
            console.log(`🔍 Search Query: "${customSearch}"`);
            console.log(`⏱ Max Duration: ${customMax}s`);
            console.log(`🔢 Jumlah Asset: ${count}\n`);
        }
    } else {
        console.log("💡 Tips: Kamu bisa download sound tertentu dengan argumen:");
        console.log("   bun run scripts/download-sounds.mjs <preset> [custom_query] [max_seconds] [count]");
        console.log("   Contoh: bun run scripts/download-sounds.mjs bow \"arrow release\" 3 5\n");
        console.log("Mendownload semua preset sound default...");
        targetsToProcess = TARGETS.map(t => ({ ...t, count: 1 }));
    }

    const browser = await chromium.launch({ headless: true });

    let ok = 0;
    let fail = 0;
    const queue = [...targetsToProcess];

    async function worker(workerId) {
        while (queue.length > 0) {
            const task = queue.shift();
            if (task) {
                const success = await processTarget(browser, task, workerId);
                if (success) ok++;
                else fail++;
            }
        }
    }

    const workers = [];
    const limit = Math.min(CONCURRENCY_LIMIT, targetsToProcess.length);
    for (let i = 1; i <= limit; i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);
    await browser.close();

    console.log(`\n✅ ${ok}/${targetsToProcess.length} Berhasil diproses`);
    if (fail) console.log(`❌ ${fail} Gagal`);
}

main();
