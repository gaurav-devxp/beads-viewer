import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
const table = Uint32Array.from({ length: 256 }, (_, i) => {
	let n = i;
	for (let b = 0; b < 8; b++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
	return n >>> 0;
});
export function crc32(buffer) {
	let n = 0xffffffff;
	for (const byte of buffer) n = table[(n ^ byte) & 255] ^ (n >>> 8);
	return (n ^ 0xffffffff) >>> 0;
}
export async function filesIn(root) {
	const rows = [];
	async function walk(dir, prefix = "") {
		for (const name of (await readdir(dir)).sort()) {
			const path = join(dir, name),
				relative = prefix + name,
				info = await stat(path);
			if (info.isDirectory()) await walk(path, relative + "/");
			else if (info.isFile()) rows.push({ path, relative, bytes: info.size });
			else throw new Error("Unsupported archive entry: " + relative);
		}
	}
	await walk(root);
	return rows;
}
// Standard UTF-8 ZIP, deflate, fixed DOS timestamp; no OS archive executable needed.
export async function writeZip(root, output) {
	const locals = [],
		central = [];
	let offset = 0;
	const files = await filesIn(root);
	if (files.length > 65535)
		throw new Error("ZIP64 entry counts are not supported");
	for (const file of files) {
		const name = Buffer.from(file.relative, "utf8"),
			data = await readFile(file.path),
			compressed = deflateRawSync(data, { level: 9 }),
			checksum = crc32(data);
		if (data.length > 0xffffffff || offset > 0xffffffff)
			throw new Error("ZIP64 sizes are not supported");
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(0x0800, 6);
		header.writeUInt16LE(8, 8);
		header.writeUInt16LE(33, 12);
		header.writeUInt32LE(checksum, 14);
		header.writeUInt32LE(compressed.length, 18);
		header.writeUInt32LE(data.length, 22);
		header.writeUInt16LE(name.length, 26);
		locals.push(header, name, compressed);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(0x0800, 8);
		entry.writeUInt16LE(8, 10);
		entry.writeUInt16LE(33, 14);
		entry.writeUInt32LE(checksum, 16);
		entry.writeUInt32LE(compressed.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(name.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(entry, name);
		offset += header.length + name.length + compressed.length;
	}
	const directory = Buffer.concat(central),
		end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	await writeFile(output, Buffer.concat([...locals, directory, end]));
}
