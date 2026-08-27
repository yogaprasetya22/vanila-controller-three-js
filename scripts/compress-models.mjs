import { readdir, mkdir, rename, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");

const CONFIGS = [
    {
        name: "Adventurers",
        charactersInput: "/home/yoga/Dokumen/model-tiktok-next/sangat mantap/KayKit_Adventurers_2.0_FREE/Characters/characters-gltf",
        charactersOutput: path.join(ROOT_DIR, "public", "models", "character", "characters"),
        weaponsInput: "/home/yoga/Dokumen/model-tiktok-next/sangat mantap/KayKit_Adventurers_2.0_FREE/Assets/waepon-gltf",
        weaponsOutput: path.join(ROOT_DIR, "public", "models", "character", "weapons"),
        simplify: 0.7,
    },
    {
        name: "Skeletons",
        charactersInput: "/home/yoga/Dokumen/model-tiktok-next/KayKit_Skeletons_1.1_FREE/characters/gltf",
        charactersOutput: path.join(ROOT_DIR, "public", "models", "character", "characters"),
        weaponsInput: "/home/yoga/Dokumen/model-tiktok-next/KayKit_Skeletons_1.1_FREE/assets/warpon",
        weaponsOutput: path.join(ROOT_DIR, "public", "models", "character", "weapons"),
        simplify: 0.7,
    }
];

const ANIMATIONS_FOLDER = path.join(ROOT_DIR, "public", "models", "character", "animation");

function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { stdio: "ignore" });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Exit code ${code}`));
        });
        proc.on("error", (err) => reject(err));
    });
}

async function start() {
    console.log("🚀 REVERTING GLTFPACK TO SAFE MODE (WITHOUT -CC)...");
    console.log("--------------------------------------------------");

    let processedCount = 0;

    for (const config of CONFIGS) {
        console.log(`\n=================== Memproses Aset: ${config.name} ===================`);

        // Pastikan folder output tersedia
        for (const folder of [config.charactersOutput, config.weaponsOutput]) {
            if (!existsSync(folder)) {
                await mkdir(folder, { recursive: true });
            }
        }

        // 1. Proses Character Models
        if (existsSync(config.charactersInput)) {
            const charFiles = (await readdir(config.charactersInput));
            
            // Proses file .glb
            const glbFiles = charFiles.filter((f) => f.toLowerCase().endsWith(".glb"));
            console.log(`👤 Memproses Character Models GLB (${glbFiles.length} file)...`);
            for (const file of glbFiles) {
                const inputPath = path.join(config.charactersInput, file);
                const outputPath = path.join(config.charactersOutput, file);

                process.stdout.write(`  📦 [${processedCount + 1}] Mengompresi ${file} (gltfpack)... `);

                try {
                    // Gunakan parameter asli: -c dan -si (tanpa -cc karena merusak skeletal bone binding)
                    await runCommand("npx", [
                        "gltfpack",
                        "-i", inputPath,
                        "-o", outputPath,
                        "-c",
                        "-si", config.simplify.toString()
                    ]);
                    process.stdout.write("✅ BERHASIL\n");
                    processedCount++;
                } catch (err) {
                    process.stdout.write("❌ GAGAL\n");
                    console.error(`     Error: ${err.message}`);
                }
            }

            // Copy file gambar tekstur (.png) jika ada
            const pngFiles = charFiles.filter((f) => f.toLowerCase().endsWith(".png"));
            for (const file of pngFiles) {
                const inputPath = path.join(config.charactersInput, file);
                const outputPath = path.join(config.charactersOutput, file);
                try {
                    await copyFile(inputPath, outputPath);
                    console.log(`  🖼️  Menyalin tekstur ${file} -> OK`);
                } catch (err) {
                    console.error(`  🖼️  Gagal menyalin tekstur ${file}: ${err.message}`);
                }
            }
        } else {
            console.warn(`⚠️ Folder input character tidak ditemukan: ${config.charactersInput}`);
        }

        // 2. Proses Weapon Models (.gltf atau .glb)
        if (existsSync(config.weaponsInput)) {
            const weaponFiles = await readdir(config.weaponsInput);
            
            // Proses gltf dan glb
            const weaponModels = weaponFiles.filter((f) => f.toLowerCase().endsWith(".gltf") || f.toLowerCase().endsWith(".glb"));
            console.log(`\n⚔️ Memproses Weapon Models (${weaponModels.length} file)...`);
            for (const file of weaponModels) {
                const inputPath = path.join(config.weaponsInput, file);
                const isGltf = file.toLowerCase().endsWith(".gltf");
                const outputFileName = isGltf ? file.slice(0, -5) + ".glb" : file;
                const outputPath = path.join(config.weaponsOutput, outputFileName);

                process.stdout.write(`  📦 [${processedCount + 1}] Mengompresi weapon ${file} -> ${outputFileName} (gltfpack)... `);

                try {
                    // Senjata aman menggunakan -cc karena berupa static mesh (tanpa skinning)
                    await runCommand("npx", [
                        "gltfpack",
                        "-i", inputPath,
                        "-o", outputPath,
                        "-c",
                        "-cc",
                        "-si", config.simplify.toString()
                    ]);
                    process.stdout.write("✅ BERHASIL\n");
                    processedCount++;
                } catch (err) {
                    process.stdout.write("❌ GAGAL\n");
                    console.error(`     Error: ${err.message}`);
                }
            }

            // Copy file gambar tekstur (.png) jika ada di folder weapon
            const pngFiles = weaponFiles.filter((f) => f.toLowerCase().endsWith(".png"));
            for (const file of pngFiles) {
                const inputPath = path.join(config.weaponsInput, file);
                const outputPath = path.join(config.weaponsOutput, file);
                try {
                    await copyFile(inputPath, outputPath);
                    console.log(`  🖼️  Menyalin tekstur weapon ${file} -> OK`);
                } catch (err) {
                    console.error(`  🖼️  Gagal menyalin tekstur weapon ${file}: ${err.message}`);
                }
            }
        } else {
            console.warn(`⚠️ Folder input weapon tidak ditemukan: ${config.weaponsInput}`);
        }
    }

    // 3. Proses Animation Models (in-place)
    if (existsSync(ANIMATIONS_FOLDER)) {
        const animFiles = (await readdir(ANIMATIONS_FOLDER)).filter(
            (f) => f.toLowerCase().endsWith(".glb") && !f.includes("_temp")
        );

        console.log(`\n🎬 Memproses Animation Models (${animFiles.length} file)...`);
        for (const file of animFiles) {
            const inputPath = path.join(ANIMATIONS_FOLDER, file);
            const tempPath = path.join(ANIMATIONS_FOLDER, file.replace(".glb", "_temp.glb"));

            process.stdout.write(`  📦 [${processedCount + 1}] Mengompresi ${file} (gltfpack)... `);

            try {
                // Animasi tidak boleh menggunakan -cc karena merusak struktur track animasi bone
                await runCommand("npx", [
                    "gltfpack",
                    "-i", inputPath,
                    "-o", tempPath,
                    "-c"
                ]);
                if (existsSync(tempPath)) {
                    await rename(tempPath, inputPath);
                    process.stdout.write("✅ BERHASIL\n");
                    processedCount++;
                } else {
                    process.stdout.write("❌ GAGAL (file temp tidak terbentuk)\n");
                }
            } catch (err) {
                process.stdout.write("❌ GAGAL\n");
                console.error(`     Error: ${err.message}`);
            }
        }
    } else {
        console.warn(`⚠️ Folder animasi tidak ditemukan: ${ANIMATIONS_FOLDER}`);
    }

    console.log("--------------------------------------------------");
    console.log(`✨ REVERT SELESAI! Berhasil memulihkan ${processedCount} file.`);
}

start();
