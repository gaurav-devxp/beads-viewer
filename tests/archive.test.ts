import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
// Contributor-only archive utility: interoperability is additionally checked with unzip.
// @ts-expect-error JavaScript packaging utility is intentionally outside app TS compilation.
import { writeZip, crc32 } from "../scripts/lib/archive.mjs";
test("portable ZIP retains nested UTF-8 filenames, bytes and standard CRC/end directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "bv-archive-"));
	try {
		assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
		await mkdir(join(root, "input", "nested"), { recursive: true });
		await writeFile(
			join(root, "input", "nested", "café.json"),
			"Unicode 👩🏽‍💻\n",
		);
		await writeFile(join(root, "input", "empty.txt"), "");
		const zip = join(root, "test.zip");
		await writeZip(join(root, "input"), zip);
		const data = await readFile(zip);
		let offset = 0;
		const contents = new Map();
		while (data.readUInt32LE(offset) === 0x04034b50) {
			assert.equal(data.readUInt16LE(offset + 6), 0x0800);
			assert.equal(data.readUInt16LE(offset + 8), 8);
			const size = data.readUInt32LE(offset + 18),
				nameLength = data.readUInt16LE(offset + 26),
				extra = data.readUInt16LE(offset + 28),
				name = data
					.subarray(offset + 30, offset + 30 + nameLength)
					.toString("utf8"),
				start = offset + 30 + nameLength + extra;
			contents.set(
				name,
				inflateRawSync(data.subarray(start, start + size)).toString(),
			);
			offset = start + size;
		}
		assert.equal(contents.get("nested/café.json"), "Unicode 👩🏽‍💻\n");
		assert.equal(contents.get("empty.txt"), "");
		assert.equal(data.readUInt32LE(offset), 0x02014b50);
		assert.equal(data.readUInt32LE(data.length - 22), 0x06054b50);
		assert.equal(data.readUInt16LE(data.length - 12), 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
