import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Helper to parse GLB JSON chunk
function parseGlbJson(filePath) {
    try {
        const buffer = readFileSync(filePath);
        // Check magic number
        const magic = buffer.toString("utf8", 0, 4);
        if (magic !== "glTF") {
            return { error: "Not a valid glTF binary file" };
        }
        const version = buffer.readUInt32LE(4);
        const length = buffer.readUInt32LE(8);
        
        // Chunk 0 header
        const chunkLength = buffer.readUInt32LE(12);
        const chunkType = buffer.readUInt32LE(16);
        
        // 0x4E4F534A is JSON in ASCII ("JSON" written in little endian/big endian hex)
        if (chunkType !== 0x4E4F534A) {
            return { error: `First chunk is not JSON (chunk type: ${chunkType.toString(16)})` };
        }
        
        const jsonBuffer = buffer.subarray(20, 20 + chunkLength);
        const gltf = JSON.parse(jsonBuffer.toString("utf8"));
        return gltf;
    } catch (e) {
        return { error: e.message };
    }
}

const WEAPONS_DIR = "./public/models/character/weapons";
const ANIMATIONS_DIR = "./public/models/character/animation";

console.log("Analyzing assets...");

const weapons = readdirSync(WEAPONS_DIR).filter(f => f.endsWith(".glb"));
const animations = readdirSync(ANIMATIONS_DIR).filter(f => f.endsWith(".glb"));

const output = [];
output.push("# Hasil Analisis Aset Karakter (Senjata & Animasi)");
output.push(`*Waktu Analisis: ${new Date().toLocaleString()}*\n`);

output.push("## ⚔️ Daftar Senjata (Weapons)");
output.push("Berikut adalah detail file model senjata yang terdeteksi:");
output.push("| No | Nama File | Meshes Terdeteksi | Node Utama |");
output.push("|---|---|---|---|");

weapons.forEach((file, index) => {
    const gltf = parseGlbJson(join(WEAPONS_DIR, file));
    if (gltf.error) {
        output.push(`| ${index + 1} | \`${file}\` | *Error: ${gltf.error}* | - |`);
    } else {
        const meshNames = (gltf.meshes || []).map(m => m.name).join(", ") || "No Mesh Name";
        const mainNodes = (gltf.nodes || []).slice(0, 3).map(n => n.name).join(", ");
        output.push(`| ${index + 1} | \`${file}\` | \`${meshNames}\` | \`${mainNodes}\` |`);
    }
});

output.push("\n## 🏃 Daftar Rig & Klip Animasi");
output.push("Berikut adalah daftar file rig animasi berserta klip-klip yang ada di dalamnya:");

animations.forEach((file) => {
    const gltf = parseGlbJson(join(ANIMATIONS_DIR, file));
    output.push(`\n### 📦 \`${file}\``);
    if (gltf.error) {
        output.push(`*Error parsing file: ${gltf.error}*`);
    } else {
        const clipNames = (gltf.animations || []).map(a => a.name);
        if (clipNames.length === 0) {
            output.push("- *Tidak ada klip animasi di dalam file ini.*");
        } else {
            output.push("- **Klip Animasi:**");
            clipNames.forEach(clip => {
                output.push(`  - \`${clip}\``);
            });
        }
    }
});

import { writeFileSync } from "fs";
writeFileSync("./hasil.md", output.join("\n"));
console.log("Analisis selesai. Hasil disimpan di hasil.md");
