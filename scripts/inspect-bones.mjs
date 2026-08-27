import * as fs from "fs";

// Simple GLTF parser untuk membaca struktur bone
function parseGLTF(filePath) {
    const buffer = fs.readFileSync(filePath);

    // GLTF file structure: 12 byte header + JSON + binary
    const headerView = new DataView(buffer.buffer, buffer.byteOffset, 20);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    const version = headerView.getUint32(4, true);
    const length = headerView.getUint32(8, true);

    if (magic !== "glTF") {
        throw new Error("Not a valid GLTF file");
    }

    // Read JSON chunk (first chunk is usually JSON)
    const jsonChunkHeader = new DataView(
        buffer.buffer,
        buffer.byteOffset + 20,
        8,
    );
    const jsonChunkLength = jsonChunkHeader.getUint32(0, true);
    const jsonChunkType = jsonChunkHeader.getUint32(4, true);

    const jsonBuffer = buffer.slice(28, 28 + jsonChunkLength);
    const jsonText = new TextDecoder().decode(jsonBuffer);
    const json = JSON.parse(jsonText);

    return json;
}

function findBonesInNodes(nodes, nodeName = "scene", depth = 0) {
    if (!nodes) return;

    const indent = "  ".repeat(depth);

    nodes.forEach((node) => {
        const name = node.name || "(unnamed)";
        const hasSkin = node.skin !== undefined ? " [HAS SKIN]" : "";
        console.log(`${indent}📦 ${name}${hasSkin}`);

        if (node.children) {
            const childNodes = node.children.map((idx) => nodes[idx]);
            findBonesInNodes(childNodes, name, depth + 1);
        }
    });
}

try {
    const modelPath = process.argv[2] || "Knight";
    const filePath = `./public/models/character/characters/${modelPath}.glb`;

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const gltf = parseGLTF(filePath);

    console.log(`\n=== GLTF Structure for ${modelPath}.glb ===\n`);

    if (gltf.nodes) {
        console.log("📦 Node Hierarchy (potential bones):\n");

        // Find root nodes (nodes not referenced by others)
        const referencedNodes = new Set();
        gltf.nodes.forEach((node) => {
            if (node.children) {
                node.children.forEach((childIdx) => {
                    referencedNodes.add(childIdx);
                });
            }
        });

        const rootNodes = gltf.nodes
            .map((node, idx) => ({ node, idx }))
            .filter(({ idx }) => !referencedNodes.has(idx));

        rootNodes.forEach(({ node, idx }) => {
            console.log(`Root Node [${idx}]: ${node.name || "(unnamed)"}`);
            if (node.children) {
                const childNodes = node.children.map(
                    (cidx) => gltf.nodes[cidx],
                );
                findBonesInNodes(childNodes, node.name, 1);
            }
        });
    }

    if (gltf.skins) {
        console.log("\n🦴 Skins (Bone Information):\n");
        gltf.skins.forEach((skin, idx) => {
            console.log(`Skin [${idx}]: ${skin.name || "(unnamed)"}`);
            if (skin.joints) {
                console.log(`  Joints (${skin.joints.length} bones):`);
                skin.joints.forEach((jointIdx) => {
                    const jointNode = gltf.nodes[jointIdx];
                    console.log(
                        `    - [${jointIdx}] ${jointNode.name || "(unnamed)"}`,
                    );
                });
            }
        });
    }
} catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
}
