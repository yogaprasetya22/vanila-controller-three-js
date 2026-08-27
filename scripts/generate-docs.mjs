import fs from "fs";
import path from "path";

// ── Counter & synergy reasoning (derived from TargetingSystem.ts + skill mechanics) ──
// ponytail: static lookup, generated docs only. Update here when balance changes.

function getCounterReason(role, target) {
    const key = `${role}->${target}`;
    const reasons = {
        "Barbarian->Knight":
            "Rage immune menetralisir Taunt + Shield Bash Knight. DPS Barbarian melampaui sustain Knight.",
        "Knight->Assassin":
            "Taunt memaksa Assassin menyerang Knight, Bulwark Stance menyerap burst Backstab. Shield Bash knockback menghentikan combo.",
        "Knight->Archer":
            "Taunt mengganggu fokus Archer. Armor 35% meredam 60 anak panah Arrow Volley.",
        "Archer->Assassin":
            "Evasive Leap kabur dari dive. Arrow Volley punish area saat Assassin masuk formasi.",
        "Mage->Barbarian":
            "Magic damage bypass armor 20%. Frost Nova stun mencegah Barbarian charge. Fireball splash bunuh Barbarian.",
        "Mage->Knight":
            "Magic damage bypass armor 35% Knight. Taunt tidak efektif vs AoE. Frost Nova stun mengunci Knight.",
        "Gunslinger->Barbarian":
            "Smoke Bomb escape aman. High Noon execute single-target tinggi. Barbarian lambat, mudah di-kite.",
        "Gunslinger->Mage":
            "Smoke Bomb stealth dekati tanpa terdeteksi. High Noon execute. Fan Fire AoE bunuh Mage saat approach.",
        "Gunslinger->Healer":
            "High Noon execute Healer sebelum sempat Divine Shield. Fan Fire membersihkan Healer dari cluster.",
        "Assassin->Mage":
            "Shadow Step teleport langsung ke backline. Backstab menghabisi Mage (HP 210K, armor 0%). Poison DoT mencegah regen.",
        "Assassin->Archer":
            "Shadow Step bypass range busur. Backstab dari belakang ignore Evasive Leap. HP Archer 240K, lebih tinggi dari Mage tapi skill dicegah.",
        "Assassin->Healer":
            "Backstab kill Healer (HP 180K, tipe HP terendah). Priority targeting HP rendah menjadikan Healer target utama.",
        "Assassin->Gunslinger":
            "Shadow Step chase Smoke Bomb. Speed 0.055 vs 0.03. Backstab burst sebelum Gunslinger kabur.",
    };
    return (
        reasons[key] ||
        `${role} memiliki keunggulan taktis melawan ${target} melalui kombinasi skill.`
    );
}

function getCounteredReason(role, counter) {
    const key = `${counter}->${role}`;
    const reasons = {
        "Mage->Barbarian":
            "Magic damage bypass armor. Frost Nova stun, Fireball splash AoE hancurkan Barbarian.",
        "Archer->Barbarian":
            "Kite dari jarak jauh. Arrow Volley AoE susah dihindari oleh unit melee lambat.",
        "Barbarian->Knight":
            "Rage menetralisir semua CC Knight. DPS out-sustain.",
        "Mage->Knight":
            "Magic damage bypass armor 35%. Knight tidak bisa menahan burst sihir.",
        "Assassin->Archer":
            "Teleport bypass jangkauan, burst damage tinggi lawan HP rendah.",
        "Knight->Archer": "Taunt ubah target, armor tinggi serap damage panah.",
        "Assassin->Mage":
            "Shadow Step langsung menusuk backline, armor 0% tidak bertahan.",
        "Gunslinger->Mage":
            "Smoke Bomb stealth dekati tanpa terdeteksi. High Noon execute.",
        "Assassin->Healer":
            "Target prioritas HP terendah. Backstab bunuh sebelum Divine Shield aktif.",
        "Gunslinger->Healer":
            "High Noon burst sebelum heal sempat cast. Fan Fire bersihkan area.",
        "Assassin->Gunslinger":
            "Shadow Step kejar Smoke Bomb. Speed unggul jauh.",
        "Archer->Gunslinger":
            "Arrow Volley area denial. Evasive Leap jaga jarak aman.",
        "Knight->Assassin":
            "Taunt paksa target berubah. Bulwark Stance immune serap Backstab.",
        "Archer->Assassin":
            "Evasive Leap hindari dive. Arrow Volley punish area masuk.",
    };
    return (
        reasons[key] ||
        `${counter} memiliki keunggulan taktis melawan ${role} melalui kombinasi skill.`
    );
}

function getSynergyReason(role, partner) {
    const key = `${role}+${partner}`;
    const reasons = {
        "Barbarian+Healer":
            "Healer Divine Shield + Rejuvenation menjaga Barbarian tetap hidup di garis depan.",
        "Knight+Mage":
            "Knight Taunt kumpulkan musuh, Mage follow-up dengan AoE burst (Fireball/Frost Nova).",
        "Knight+Archer":
            "Knight tank di depan, Archer DPS aman dari jarak jauh. Taunt lindungi Archer dari dive.",
        "Knight+Healer":
            "Knight armor 35% + Healer heal = hampir immortal. Divine Shield berlapis.",
        "Archer+Knight":
            "Knight proteksi dari dive Assassin. Archer DPS konstan dari belakang.",
        "Archer+Healer":
            "Healer jaga Archer tetap hidup. Divine Shield selamatkan saat di-dive.",
        "Mage+Knight":
            "Knight tank di depan mengumpulkan musuh, Mage hancurkan dengan AoE.",
        "Healer+Barbarian":
            "Barbarian HP 500K + Healer = regenerasi massive. Divine Shield prevent burst.",
        "Healer+Knight":
            "Kombinasi tank terkuat. Knight armor 35% + heal = wall tak tertembus.",
        "Healer+Archer":
            "Healer proteksi Archer dari dive Assassin. Archer cover Healer dari jarak jauh.",
    };
    return (
        reasons[key] ||
        `${role} dan ${partner} saling melengkapi dalam formasi tim.`
    );
}

const configPath = path.resolve("src/simulation/config.ts");
const configContent = fs.readFileSync(configPath, "utf8");

// --- PARSING HELPERS ---

function extractRecord(varName) {
    const regex = new RegExp(
        `export const ${varName}(?:\\s*:\\s*Record<number,\\s*\\w+>)?\\s*=\\s*{([\\s\\S]*?)};`,
    );
    const match = configContent.match(regex);
    if (!match) return {};
    const lines = match[1].split("\n");
    const record = {};
    for (const line of lines) {
        const itemMatch = line.match(/^\s*(\d+)\s*:\s*([^,]+)/);
        if (itemMatch) {
            record[parseInt(itemMatch[1])] = itemMatch[2].trim();
        }
    }
    return record;
}

function extractSkills(varName) {
    const regex = new RegExp(`export const ${varName}\\s*=\\s*{([\\s\\S]*?)};`);
    const match = configContent.match(regex);
    if (!match) return null;

    // Parse nested objects
    const content = match[1];
    const skills = {};
    const skillRegex = /(\w+)\s*:\s*{([\s\S]*?)}/g;
    let skillMatch;
    while ((skillMatch = skillRegex.exec(content)) !== null) {
        const skillName = skillMatch[1];
        const properties = {};
        const propLines = skillMatch[2].split("\n");
        for (const propLine of propLines) {
            const propMatch = propLine.match(/^\s*(\w+)\s*:\s*([^,/]+)/);
            if (propMatch) {
                properties[propMatch[1]] = propMatch[2].trim();
            }
        }
        skills[skillName] = properties;
    }
    return skills;
}

// Extract attributes
const rawAttributes = extractRecord("ATTRIBUTES");
const parsedAttributes = {};
const attrRegex = /(\d+)\s*:\s*{([\s\S]*?)}/g;
const attributesMatch = configContent.match(
    /export const ATTRIBUTES(?:[\s\S]*?)=\s*{([\s\S]*?)};/,
);
if (attributesMatch) {
    let itemMatch;
    while ((itemMatch = attrRegex.exec(attributesMatch[1])) !== null) {
        const roleId = parseInt(itemMatch[1]);
        const props = {};
        const lines = itemMatch[2].split("\n");
        for (const line of lines) {
            const propMatch = line.match(/^\s*(\w+)\s*:\s*([^,/]+)/);
            if (propMatch) {
                props[propMatch[1]] = parseFloat(propMatch[2].trim());
            }
        }
        parsedAttributes[roleId] = props;
    }
}

const rawHp = extractRecord("HP_PER_TYPE");
const rawArmor = extractRecord("ARMOR");

// Extract skill groups
const skillsData = {
    Barbarian: extractSkills("BARBARIAN_SKILLS"),
    Knight: extractSkills("KNIGHT_SKILLS"),
    Archer: extractSkills("ARCHER_SKILLS"),
    Mage: extractSkills("MAGE_SKILLS"),
    Healer: extractSkills("HEALER_SKILLS"),
    Gunslinger: extractSkills("GUNSLINGER_SKILLS"),
    Assassin: extractSkills("ASSASSIN_SKILLS"),
};

// --- DATA DEFINITION FOR ROLES ---

const ROLES = [
    {
        id: 0,
        name: "Barbarian",
        alias: "Tank (Offensive)",
        color: "#ff3333",
        skillsVar: "Barbarian",
        description:
            "Petarung jarak dekat (melee) yang memiliki HP tinggi, pertahanan sedang, dan output damage tinggi. Kelas ini berfokus pada serangan ofensif brutal.",
        visualDescription:
            "Menggunakan model Barbarian.glb berpakaian baju zirah besi merah, membawa kapak dua tangan raksasa (Axe 2-Handed). Gerakannya agresif dengan tebasan melingkar besar.",
        counters: ["Knight"],
        counteredBy: ["Mage", "Archer"],
        synergies: ["Healer"],
        skillsInfo: {
            rage: {
                name: "Rage (Self-Buff)",
                visual: "Barbarian mengeluarkan aura kemarahan membara (suar api merah-oranye) di sekujur tubuhnya.",
                effect: "Memberikan imunitas penuh kepada diri sendiri (Immunity Ticks), mencegah segala jenis damage masuk.",
            },
            axeCleave: {
                name: "Axe Cleave (Melee Cleave)",
                visual: "Tebasan kapak horizontal menyapu dengan efek garis tebasan merah tebal berkecepatan tinggi.",
                effect: "Memberikan damage fisik besar ke musuh di depan dalam jangkauan tebasannya.",
            },
            battleCry: {
                name: "Battle Cry (AoE Debuff/Buff)",
                visual: "Mengeluarkan riak gelombang suara melingkar berwarna merah yang membesar dari kaki Barbarian.",
                effect: "Memberikan teriakan perang yang meredam nyali musuh dalam radius jangkauan.",
            },
        },
    },
    {
        id: 12,
        name: "Knight",
        alias: "Tank (Defensive/Protector)",
        color: "#999999",
        skillsVar: "Knight",
        description:
            "Pelindung garis depan dengan armor terkuat di game. Knight berfokus pada pengendalian pertempuran (crowd control) dan melindungi rekan satu tim.",
        visualDescription:
            "Menggunakan model Knight.glb berarmor perak penuh dengan tameng besar (Shield) dan pedang satu tangan (Sword).",
        counters: ["Assassin", "Archer"],
        counteredBy: ["Barbarian", "Mage"],
        synergies: ["Mage", "Archer", "Healer"],
        skillsInfo: {
            bulwarkStance: {
                name: "Bulwark Stance (Self-Block)",
                visual: "Knight memicu pelindung tameng emas bersinar redup di sekeliling tubuhnya.",
                effect: "Menepis semua serangan musuh (Shield Block) dengan durasi imunitas yang sangat lama (Immune Ticks).",
            },
            taunt: {
                name: "Taunt (Area Aggro)",
                visual: "Memunculkan simbol kemarahan merah berkedip di atas kepala musuh di sekitar Knight.",
                effect: "Memaksa semua musuh dalam radius jangkauan untuk menyerang Knight, mengalihkan perhatian mereka dari Archer/Mage.",
            },
            shieldBash: {
                name: "Shield Bash (Melee CC/Knockback)",
                visual: "knight menghantamkan tamengnya ke depan dengan efek kilatan sparks putih terang.",
                effect: "Memberikan damage sedang dan memukul mundur (Knockback) target sejauh beberapa unit.",
            },
        },
    },
    {
        id: 1,
        name: "Archer",
        alias: "Ranged DPS",
        color: "#00ff55",
        skillsVar: "Archer",
        description:
            "Penyerang jarak jauh konstan dengan DPS fisik stabil. Sangat lincah dan mampu menjaga jarak dari musuh jarak dekat.",
        visualDescription:
            "Menggunakan model Ranger.glb berpakaian jubah hijau hutan, memegang busur panah besar (Bow) dengan tas anak panah (Quiver) di punggung.",
        counters: ["Assassin"],
        counteredBy: ["Assassin", "Knight"],
        synergies: ["Knight", "Healer"],
        skillsInfo: {
            doubleShot: {
                name: "Double Shot (Single-Target burst)",
                visual: "Archer menembakkan dua anak panah laser kuning bersinar secara cepat berturut-turut.",
                effect: "Memberikan damage fisik beruntun ke satu target dengan jeda tembakan sangat singkat.",
            },
            evasiveLeap: {
                name: "Evasive Leap (Self-Escape)",
                visual: "Archer melompat mundur secara instan disertai kepulan debu (puff) dan kilatan cahaya putih.",
                effect: "Menghindar ke belakang sejauh beberapa unit saat didekati musuh untuk menjaga jarak aman.",
            },
            arrowVolley: {
                name: "Arrow Volley (Massive AoE)",
                visual: "Memanggil lingkaran sihir rune emas besar di tanah, lalu menghujani area tersebut dengan 60 anak panah bersinar dari langit.",
                effect: "Memberikan damage fisik area (AoE) yang sangat merusak bagi semua musuh yang berada di dalam radius lingkaran.",
            },
        },
    },
    {
        id: 2,
        name: "Mage",
        alias: "Magic Burst/AoE Specialist",
        color: "#00aaff",
        skillsVar: "Mage",
        description:
            "Penyihir elemen dengan jangkauan serang terjauh. Menghasilkan damage ledakan (burst) sihir area terbesar namun sangat rentan mati jika didekati.",
        visualDescription:
            "Menggunakan model Mage.glb berjubah biru penyihir, memegang tongkat sihir kayu berkristal biru bersinar (Staff).",
        counters: ["Barbarian", "Knight"],
        counteredBy: ["Assassin", "Gunslinger"],
        synergies: ["Knight"],
        skillsInfo: {
            frostNova: {
                name: "Frost Nova (AoE CC/Stun)",
                visual: "Ledakan cincin es berwarna biru muda di tanah disertai pecahan serpihan es tajam melayang di udara.",
                effect: "Memberikan damage sihir dan membekukan (Stun/Freeze) semua musuh di sekitarnya sehingga tidak bisa bergerak selama beberapa ticks.",
            },
            chainLightning: {
                name: "Chain Lightning (Multi-Target bounce)",
                visual: "Kilatan petir biru instan yang menyambar lurus dan memantul meliuk-liuk di antara beberapa unit musuh.",
                effect: "Memberikan damage sihir besar pada target utama, lalu memantul ke target sekunder terdekat dengan damage yang sedikit berkurang.",
            },
            fireball: {
                name: "Fireball (Huge AoE Burst)",
                visual: "Mage meluncurkan meteor api besar menyala merah-jingga yang meninggalkan ekor bara api (embers), lalu meledak hebat saat menyentuh target.",
                effect: "Memberikan damage sihir langsung (Direct Damage) yang sangat masif pada target utama, serta damage ledakan tambahan (Splash Damage) dalam radius ledakan.",
            },
        },
    },
    {
        id: 3,
        name: "Healer",
        alias: "Acolyte / Support",
        color: "#ffffff",
        skillsVar: "Healer",
        description:
            "Unit pendukung murni (support) yang berfokus memulihkan HP teman, memberikan perlindungan kekebalan, dan meningkatkan daya tahan garis depan.",
        visualDescription:
            "Menggunakan model Mage/Acolyte berjubah putih salju dengan garis emas bersinar, memegang buku mantra terbuka (Spellbook) dan tongkat penyembuh.",
        counters: [],
        counteredBy: ["Assassin", "Gunslinger"],
        synergies: ["Barbarian", "Knight", "Archer"],
        skillsInfo: {
            rejuvenation: {
                name: "Rejuvenation (Single-Target Heal)",
                visual: "Menyorotkan pilar sinar hijau zamrud ke arah teman yang terluka disertai bintang penyembuh melayang naik.",
                effect: "Memulihkan HP target dalam jumlah besar secara instan.",
            },
            divineShield: {
                name: "Divine Shield (Immunity Shield)",
                visual: "Memasang perisai tabung cahaya kuning emas berkilau mengelilingi tubuh target.",
                effect: "Memberikan status kebal/pengurangan damage drastis pada teman satu tim selama durasi tertentu.",
            },
            holySanctuary: {
                name: "Holy Sanctuary (Mass AoE Heal)",
                visual: "Menciptakan lingkaran emas besar di tanah dan memunculkan 4 pilar cahaya suci bersinar ke langit.",
                effect: "Menyembuhkan hingga 5 teman satu tim yang berada di dalam area lingkaran secara bersamaan.",
            },
        },
    },
    {
        id: 4,
        name: "Gunslinger",
        alias: "Rapid Ranged DPS",
        color: "#ffaa00",
        skillsVar: "Gunslinger",
        description:
            "Penembak jitu berkecepatan tinggi dengan critical rate tinggi. Mampu menyerang sangat cepat dan bersembunyi untuk menyelamatkan diri.",
        visualDescription:
            "Menggunakan model Rogue Hooded berpenutup kepala gelap, memegang pistol panah mekanis (Crossbow) di tangan.",
        counters: ["Barbarian", "Mage", "Healer"],
        counteredBy: ["Assassin", "Archer"],
        synergies: [],
        skillsInfo: {
            highNoon: {
                name: "High Noon (Single-Target Execution)",
                visual: "Tembakan kilat beruntun berkecepatan tinggi dengan percikan sparks tajam di laras senjata.",
                effect: "Memberikan damage fisik masif instan ke satu target musuh.",
            },
            smokeBomb: {
                name: "Smoke Bomb (Self-Stealth)",
                visual: "Gunslinger melempar bom asap, menciptakan kabut asap hitam pekat berbentuk kubah kecil di posisinya.",
                effect: "Membuat dirinya tidak dapat ditarget musuh (Stealth/Invisible) selama beberapa ticks untuk kabur.",
            },
            fanFire: {
                name: "Fan Fire (AoE Multi-Hit)",
                visual: "Gunslinger berputar menembakkan rentetan panah ke segala arah dalam bentuk kipas melingkar.",
                effect: "Memberikan damage fisik area (AoE) sebanyak 3 kali hantaman berturut-turut pada semua musuh di dekatnya.",
            },
        },
    },
    {
        id: 5,
        name: "Assassin",
        alias: "Glass Cannon / Stealth Burst",
        color: "#db004f",
        skillsVar: "Assassin",
        description:
            "Pembunuh bayangan lincah ber-damage ekstrem. Assassin memprioritaskan musuh ber-HP tipis (Archer/Mage) dan melancarkan burst kritikal mematikan dari belakang.",
        visualDescription:
            "Menggunakan model Rogue berpeci gelap tanpa penutup kepala, memegang belati kembar beracun (Twin Daggers) di kedua tangan. Berjalan sangat cepat.",
        counters: ["Mage", "Archer", "Healer", "Gunslinger"],
        counteredBy: ["Knight", "Archer"],
        synergies: [],
        skillsInfo: {
            shadowStep: {
                name: "Shadow Step (Teleport)",
                visual: "Assassin menghilang secara instan dan langsung muncul di belakang target disertai kepulan asap hitam.",
                effect: "Melakukan teleportasi langsung di belakang punggung target terdekat.",
            },
            backstab: {
                name: "Backstab (Execution Burst)",
                visual: "Tebasan belati menyilang berkecepatan tinggi membentuk efek tebasan X tajam berwarna ungu-gelap.",
                effect: "Memberikan damage fisik sangat tinggi jika menyerang musuh dari belakang, atau damage sedang jika menyerang dari depan.",
            },
            poisonBlade: {
                name: "Poison Blade (DoT Poison)",
                visual: "Belati assassin memicu gelembung racun hijau pekat bersinar redup di tubuh target.",
                effect: "Memberikan efek racun (Poison DoT) yang mencicil HP target setiap tick selama durasi racun aktif.",
            },
        },
    },
];

// --- GENERATE DOCUMENTS ---

const docsDir = path.resolve("docs/roles");
if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
}

for (const role of ROLES) {
    const attrs = parsedAttributes[role.id] || {};
    const hp = parseInt(rawHp[role.id]) || 0;
    const armor = parseFloat(rawArmor[role.id]) || 0;
    const skills = skillsData[role.skillsVar] || {};

    // Formatter helpers
    const fmtDmg = (val) => (val ? parseInt(val).toLocaleString() : "0");
    const fmtPct = (val) => (val ? `${Math.round(val * 100)}%` : "0%");
    const fmtSec = (ticks) =>
        ticks
            ? `${(parseInt(ticks) / 62.5).toFixed(2)}s (${ticks} ticks)`
            : "0s";

    let skillSections = "";
    for (const [skillKey, skillVal] of Object.entries(skills)) {
        const info = role.skillsInfo[skillKey] || {
            name: skillKey,
            visual: "Tidak ada data",
            effect: "Tidak ada data",
        };

        let statsTable =
            "| Atribut Skill | Nilai | Deskripsi |\n| :--- | :--- | :--- |\n";
        for (const [k, v] of Object.entries(skillVal)) {
            if (k === "cooldown") {
                statsTable += `| **Cooldown** | ${fmtSec(v)} | Waktu jeda penggunaan kembali |\n`;
            } else if (
                k === "damage" ||
                k === "damageDirect" ||
                k === "damageSplash" ||
                k === "damagePrimary" ||
                k === "damageSecondary" ||
                k === "damageBack" ||
                k === "damageFront" ||
                k === "healAmount"
            ) {
                statsTable += `| **Base Value** | ${fmtDmg(v)} | Nilai damage / heal dasar |\n`;
            } else if (
                k === "range" ||
                k === "radius" ||
                k === "teleportRange" ||
                k === "chainRadius"
            ) {
                statsTable += `| **Jangkauan/Radius** | ${v} unit | Jarak efektif area skill |\n`;
            } else if (
                k === "immuneTicks" ||
                k === "stunTicks" ||
                k === "stealthTicks" ||
                k === "durationTicks"
            ) {
                statsTable += `| **Durasi Efek** | ${fmtSec(v)} | Durasi status buff/debuff |\n`;
            } else {
                statsTable += `| **${k}** | ${v} | Parameter lainnya |\n`;
            }
        }

        skillSections += `
### ⚡ ${info.name}
${info.effect}

${statsTable}

* **Efek Visual**: ${info.visual}
`;
    }

    const markdownContent = `# 🎮 Panduan Role: ${role.name} (${role.alias})

${role.description}

---

## 📊 Atribut Dasar (Statistik Unit)

Berikut adalah data numerik dasar unit **${role.name}** yang diambil langsung dari konfigurasi balancing game:

| Statistik | Nilai Dasar | Deskripsi |
| :--- | :--- | :--- |
| **Darah Maksimal (HP)** | **${hp.toLocaleString()} HP** | Kapasitas nyawa maksimal unit |
| **Pertahanan (Armor)** | **${fmtPct(armor)}** | Persentase pengurangan damage fisik yang diterima |
| **Kecepatan Gerak** | **${attrs.moveSpeed || 0}** | Kecepatan unit berpindah tempat per frame |
| **Jangkauan Serang** | **${attrs.attackRange || 0} unit** | Jarak maksimal untuk melancarkan serangan dasar |
| **Damage Dasar** | **${fmtDmg(attrs.baseDamage)}** | Nilai damage dasar serangan normal |
| **Interval Serangan** | **${fmtSec(attrs.attackInterval)}** | Jeda waktu antar serangan dasar |
| **Critical Rate (Peluang)** | **${fmtPct(attrs.critChance)}** | Peluang serangan dasar menghasilkan damage kritikal |
| **Critical Damage (Multiplier)** | **${attrs.critDamage || 0}x** | Pengali damage saat serangan kritikal berhasil dipicu |

---

## 🗡️ Counter & Sinergi

> Bagian ini menjelaskan hubungan taktis antar unit: siapa yang dilawan, siapa yang melawan, dan siapa teman satu tim terbaik — berdasarkan logika targeting engine dan mekanik skill.

| Hubungan | Unit | Alasan |
| :--- | :--- | :--- |
${role.counters.length > 0 ? role.counters.map((c) => `| **⚔️ Counter** | **${c}** | ${getCounterReason(role.name, c)} |`).join("\n") : "| ⚔️ Counter | — | Tidak ada counter spesifik |"}
${role.counteredBy.length > 0 ? role.counteredBy.map((c) => `| **🛡️ Di-counter** | **${c}** | ${getCounteredReason(role.name, c)} |`).join("\n") : "| 🛡️ Di-counter | — | Tidak ada hard counter |"}
${role.synergies.length > 0 ? role.synergies.map((s) => `| **🤝 Sinergi** | **${s}** | ${getSynergyReason(role.name, s)} |`).join("\n") : "| 🤝 Sinergi | — | Mandiri / self-sufficient |"}

---

## 🎨 Deskripsi Visual & Gaya Bertarung

* **Desain Karakter**: ${role.visualDescription}
* **Gaya Bertarung**: Bergerak maju mendekati target sesuai jangkauan serangnya. Menggunakan interval attack dasar untuk mencicil musuh sebelum merapalkan skill aktif apabila cooldown selesai.

---

## 🔮 Mekanisme & Efek Visual Skill

Unit **${role.name}** memiliki beberapa skill aktif bersyarat dengan visualisasi khusus:
${skillSections}

---
*Dokumen ini dibuat secara otomatis dari konfigurasi engine terbaru (${new Date().toLocaleDateString()}).*
`;

    const outputPath = path.join(docsDir, `${role.name}.md`);
    fs.writeFileSync(outputPath, markdownContent, "utf8");
}

console.log(
    "Successfully generated all role documentation markdown files under docs/roles/",
);
