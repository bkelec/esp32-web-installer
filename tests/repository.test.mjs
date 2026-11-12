import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateCatalog, createManifest, referencedFiles } from "../catalog.mjs";
import { Repository, validateFirmware, imageExtension, encodeBase64, decodeBase64 } from "../config/repository.mjs";

const product = (id = "one") => ({ id, name: `Board ${id}`, description: "", image: `./source/${id}.jpg`,
  firmware: `./source/${id}.bin`, manifest: `./manifests/${id}.json` });

// GitHub Git Database simulator. A branch changes ONLY at the final non-forced ref update.
function github(products = [product()]) {
  let next = 0;
  const state = { head: "head-0", files: new Map(), blobs: new Map(), trees: new Map(), commits: new Map(), calls: [], race: false, failBlob: false };
  const blob = content => { const sha = `blob-${++next}`; state.blobs.set(sha, content); return sha; };
  for (const path of referencedFiles(products)) state.files.set(path, blob("asset"));
  state.files.set("index.html", blob("preserve me"));
  state.files.set("source/unrelated.bin", blob("not managed by catalog"));
  state.files.set("products.json", blob(JSON.stringify(products)));
  state.trees.set("tree-0", new Map(state.files));
  state.commits.set(state.head, { tree: "tree-0" });
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith("https://api.github.com/repos/bkelec/esp32-web-installer"));
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.redirect, "error");
    const path = url.slice("https://api.github.com/repos/bkelec/esp32-web-installer".length);
    const body = options.body && JSON.parse(options.body);
    state.calls.push({ path, method: options.method, body });
    if (!path) return reply({ default_branch: "master" });
    if (path === "/git/ref/heads/master") return reply({ object: { sha: state.head } });
    if (options.method === "GET" && path.startsWith("/git/commits/")) {
      return reply({ tree: { sha: state.commits.get(path.split("/").pop()).tree } });
    }
    if (options.method === "GET" && path.startsWith("/git/trees/")) {
      const files = state.trees.get(path.split("/").pop().split("?")[0]);
      return reply({ truncated: false, tree: [...files].map(([path, sha]) => ({ path, sha, type: "blob", mode: "100644" })) });
    }
    if (options.method === "GET" && path.startsWith("/git/blobs/")) {
      return reply({ content: Buffer.from(state.blobs.get(path.split("/").pop())).toString("base64") });
    }
    if (path === "/git/blobs") {
      if (state.failBlob) return reply({}, 403);
      return reply({ sha: blob(body.encoding === "base64" ? Buffer.from(body.content, "base64") : body.content) }, 201);
    }
    if (path === "/git/trees") {
      const files = new Map(state.trees.get(body.base_tree));
      for (const entry of body.tree) {
        if (entry.sha === null) files.delete(entry.path);
        else files.set(entry.path, entry.sha || blob(entry.content));
      }
      const sha = `tree-${++next}`;
      state.trees.set(sha, files);
      return reply({ sha }, 201);
    }
    if (path === "/git/commits") {
      const sha = `head-${++next}`;
      state.commits.set(sha, body);
      return reply({ sha }, 201);
    }
    if (path === "/git/refs/heads/master") {
      assert.equal(body.force, false);
      if (state.race || state.commits.get(body.sha).parents[0] !== state.head) return reply({}, 422);
      state.head = body.sha;
      state.files = new Map(state.trees.get(state.commits.get(body.sha).tree));
      return reply({ object: { sha: state.head } });
    }
    throw new Error(`Unexpected ${options.method} ${path}`);
  };
  return { state, client: new Repository("test-token", fetcher) };
}

test("existing seven products match their actual files and merged ESP32 headers", async () => {
  const products = validateCatalog(JSON.parse(await readFile(new URL("../products.json", import.meta.url))));
  assert.equal(products.length, 7);
  for (const p of products) {
    const manifest = JSON.parse(await readFile(new URL(`../${p.manifest}`, import.meta.url)));
    assert.equal(manifest.name, p.name);
    assert.equal(manifest.new_install_prompt_erase, false);
    assert.equal(manifest.builds[0].parts[0].offset, 0);
    assert.equal(manifest.builds[0].parts[0].path, `../${p.firmware.replace(/^\.\//, "")}`);
    await readFile(new URL(`../${p.image}`, import.meta.url));
    const bytes = await readFile(new URL(`../${p.firmware}`, import.meta.url));
    await validateFirmware(new File([bytes], "merged.bin"));
  }
});

test("catalog rejects duplicate ids/manifests, external URLs and path traversal", () => {
  for (const image of ["https://evil.example/a.jpg", "./source/../a.jpg", "./source/%2e%2e/a.jpg", "./source/a.svg", "./source/a.jpg#fragment"]) {
    assert.throws(() => validateCatalog([{ ...product(), image }]));
  }
  assert.throws(() => validateCatalog([product(), product()]));
  assert.throws(() => validateCatalog([{ ...product(), id: undefined }]));
  assert.throws(() => validateCatalog([product(), { ...product("two"), manifest: product().manifest }]));
  assert.throws(() => validateCatalog([{ ...product(), manifest: "./manifests/nested/a.json" }]));
});

test("manifest supports independent title, picture and binary filenames", () => {
  const p = { ...product(), name: "หัวข้อทดสอบ", image: "./source/picture.png", firmware: "./source/different firmware.bin" };
  const m = createManifest(p);
  assert.equal(m.name, p.name);
  assert.equal(m.builds[0].parts[0].path, "../source/different firmware.bin");
  assert.equal(m.new_install_prompt_erase, false);
});

test("binary base64 round trips including non-ASCII bytes", () => {
  const bytes = Uint8Array.from({ length: 25000 }, (_, i) => i % 256);
  assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
});

test("reject application-only binary, other chip and oversized files", async () => {
  await assert.rejects(validateFirmware(new File([new Uint8Array(0x20000)], "app.bin")));
  await assert.rejects(validateFirmware(new File([new Uint8Array(10)], "small.bin")));
  await assert.rejects(validateFirmware({ name: "huge.bin", size: 17 * 1024 * 1024 }));
  const bytes = new Uint8Array(0x20000);
  bytes[0x1000] = bytes[0x10000] = 0xe9;
  bytes[0x8000] = 0xaa; bytes[0x8001] = 0x50; bytes[0x100c] = 9;
  await assert.rejects(validateFirmware(new File([bytes], "wrong-chip.bin")));
});

test("image type is checked by signature, SVG and oversized files refused", async () => {
  assert.equal(await imageExtension(new File([Uint8Array.of(255, 216, 255, 0)], "unrelated.name")), "jpg");
  assert.equal(await imageExtension(new File([Uint8Array.of(137,80,78,71,13,10,26,10)], "photo.png")), "png");
  await assert.rejects(imageExtension(new File(["<svg/>"], "fake.jpg")));
  await assert.rejects(imageExtension({ size: 9 * 1024 * 1024 }));
});

test("add publishes all files and catalog in one commit, preserving unrelated files", async () => {
  const { client, state } = github();
  const snapshot = await client.connect("");
  assert.equal(client.branch, "master");
  const added = product("new");
  const writes = [
    { path: "source/new.jpg", bytes: Uint8Array.of(255, 216, 255) },
    { path: "source/new.bin", bytes: Uint8Array.of(1,2,3) },
    { path: "manifests/new.json", text: JSON.stringify(createManifest(added)) }
  ];
  const saved = await client.save(snapshot, [...snapshot.products, added], writes, "Add");
  assert.notEqual(saved.head, snapshot.head);
  const loaded = await client.load();
  assert.deepEqual(loaded.products, [product(), added]);
  for (const p of referencedFiles(loaded.products)) assert.ok(state.files.has(p));
  assert.ok(state.files.has("index.html"));
  assert.ok(state.files.has("source/unrelated.bin"));
  assert.equal(state.calls.filter(c => c.method === "PATCH").length, 1);
});

test("replacement removes obsolete asset, retains shared binary; last delete supports empty catalog", async () => {
  const shared = { ...product("two"), firmware: product().firmware };
  const { client, state } = github([product(), shared]);
  let snapshot = await client.connect("");
  const changed = { ...product(), name: "Renamed", image: "./source/new-picture.png", revision: "rev-1" };
  snapshot = await client.save(snapshot, [changed, shared], [
    { path: "source/new-picture.png", bytes: Uint8Array.of(1) },
    { path: "manifests/one.json", text: JSON.stringify(createManifest(changed)) }
  ], "Update");
  assert.ok(!state.files.has("source/one.jpg"));
  assert.ok(state.files.has("source/one.bin"));
  snapshot = await client.save(snapshot, [shared], [], "Delete first");
  assert.ok(state.files.has("source/one.bin"));
  assert.ok(!state.files.has("manifests/one.json"));
  await client.save(snapshot, [], [], "Delete last");
  assert.ok(!state.files.has("source/one.bin"));
  assert.deepEqual((await client.load()).products, []);
  assert.ok(state.files.has("source/unrelated.bin"));
});

test("stale snapshot and concurrent ref update cannot overwrite the branch", async () => {
  const { client, state } = github();
  const snapshot = await client.connect("");
  state.head = "someone-else";
  await assert.rejects(client.save(snapshot, [], [], "stale"));
  assert.equal(state.calls.filter(c => c.method === "POST").length, 0);
  state.head = snapshot.head;
  state.race = true;
  await assert.rejects(client.save(snapshot, [], [], "raced"));
  assert.equal(state.head, snapshot.head);
  assert.ok(state.files.has("source/one.bin"));
});

test("failed blob upload leaves live catalog and assets unchanged", async () => {
  const { client, state } = github();
  const snapshot = await client.connect("");
  state.failBlob = true;
  await assert.rejects(client.save(snapshot, snapshot.products, [{ path: "manifests/one.json", text: "{}" }], "Fail"));
  assert.equal(state.head, snapshot.head);
  assert.equal(state.calls.filter(c => c.method === "PATCH").length, 0);
});

test("disconnect invalidates client and errors never include credentials", async () => {
  const { client } = github();
  client.disconnect();
  await assert.rejects(client.connect(""));
  const bad = new Repository("secret-token", async () => ({ ok: false, status: 401 }));
  await assert.rejects(bad.connect(""), error => !error.message.includes("secret-token"));
});
