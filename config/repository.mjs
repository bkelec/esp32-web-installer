import { validateCatalog, referencedFiles } from "../catalog.mjs";

export const OWNER = "bkelec";
export const REPO = "esp32-web-installer";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const json = value => JSON.stringify(value, null, 2) + "\n";

export function decodeBase64(content) {
  return Uint8Array.from(atob(content.replace(/\s/g, "")), c => c.charCodeAt(0));
}

export function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export async function validateFirmware(file) {
  if (!/\.bin$/i.test(file.name) || file.size < 0x10018 || file.size > 16 * 1024 * 1024) {
    throw new Error("เลือก merged .bin สำหรับ ESP32 ขนาดไม่เกิน 16 MB");
  }
  const bytes = new Uint8Array(await file.slice(0, 0x10018).arrayBuffer());
  if (bytes[0x1000] !== 0xe9 || bytes[0x8000] !== 0xaa || bytes[0x8001] !== 0x50 ||
      bytes[0x10000] !== 0xe9 || bytes[0x100c] !== 0 || bytes[0x100d] !== 0 ||
      bytes[0x1000c] !== 0 || bytes[0x1000d] !== 0) {
    throw new Error("ไม่พบโครงสร้าง merged ESP32 ที่เริ่มแฟลช 0x0 (ไม่รองรับไฟล์แอปเดี่ยวหรือชิปรุ่นอื่น)");
  }
}

export async function imageExtension(file) {
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("รูปต้องมีขนาดไม่เกิน 8 MB");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  let extension;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) extension = "jpg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) extension = "png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") extension = "webp";
  if (!extension) throw new Error("รองรับรูป JPG, PNG และ WebP เท่านั้น");
  return extension;
}

export class Repository {
  #token;
  constructor(token, fetcher = (...args) => globalThis.fetch(...args)) {
    this.#token = token;
    this.fetcher = fetcher;
  }
  disconnect() { this.#token = ""; }

  async request(path, method = "GET", body) {
    if (!this.#token) throw new Error("กรุณาเชื่อมต่อ GitHub อีกครั้ง");
    let response;
    try {
      response = await this.fetcher(API + path, {
        method, cache: "no-store", redirect: "error",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.#token}`,
          "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(120000)
      });
    } catch {
      throw new Error("ติดต่อ GitHub ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต แล้วโหลดรายการล่าสุดก่อนลองอีกครั้ง");
    }
    if (!response.ok) {
      const messages = {
        401: "Token ไม่ถูกต้องหรือหมดอายุ กรุณาเชื่อมต่อใหม่",
        403: "GitHub ปฏิเสธการเข้าถึง ตรวจสิทธิ์ Contents: Read and write และขีดจำกัด API",
        404: "ไม่พบ repository, branch หรือไฟล์ ตรวจ branch และสิทธิ์ของ Token",
        409: "ข้อมูลบน GitHub เปลี่ยนแล้ว กรุณาโหลดรายการล่าสุดก่อนบันทึกใหม่",
        422: "บันทึกไม่ได้: branch อาจมีข้อมูลใหม่หรือมีกฎป้องกัน กรุณาโหลดรายการล่าสุดและตรวจการตั้งค่า GitHub"
      };
      throw new Error(messages[response.status] || `GitHub ตอบกลับข้อผิดพลาด HTTP ${response.status}`);
    }
    return response.json();
  }

  async connect(branch) {
    const repo = await this.request("");
    this.branch = branch.trim() || repo.default_branch;
    if (!this.branch || /[\u0000-\u0020?#%\\]/.test(this.branch)) throw new Error("ชื่อ branch ไม่ถูกต้อง");
    return this.load();
  }

  get refPath() { return `/git/ref/heads/${this.branch.split("/").map(encodeURIComponent).join("/")}`; }

  async load() {
    const ref = await this.request(this.refPath);
    const commit = await this.request(`/git/commits/${ref.object.sha}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error("รายการไฟล์มีขนาดใหญ่เกินไป ไม่สามารถจัดการอย่างครบถ้วนได้");
    const files = new Map(tree.tree.filter(p => p.type === "blob" && p.mode === "100644").map(p => [p.path, p.sha]));
    const catalog = files.get("products.json");
    if (!catalog) throw new Error("ยังไม่พบ products.json กรุณาเผยแพร่โค้ดเวอร์ชันนี้ก่อนใช้งาน config");
    const blob = await this.request(`/git/blobs/${catalog}`);
    const products = validateCatalog(JSON.parse(new TextDecoder().decode(decodeBase64(blob.content))));
    for (const path of referencedFiles(products)) {
      if (!files.has(path)) throw new Error(`รายการอ้างอิงไฟล์ที่ไม่พบ: ${path}`);
    }
    return { head: ref.object.sha, tree: commit.tree.sha, files, products };
  }

  // Upload immutable blobs first, then publish catalog + assets + cleanup in ONE commit.
  async save(snapshot, products, writes, message) {
    const references = referencedFiles(products);
    const oldReferences = referencedFiles(snapshot.products);
    const ref = await this.request(this.refPath);
    if (ref.object.sha !== snapshot.head) throw new Error("มีการเปลี่ยนแปลงบน GitHub กรุณาโหลดรายการล่าสุดก่อนบันทึก");
    const entries = new Map();
    for (const write of writes) {
      if (!references.has(write.path) || write.path === "products.json") throw new Error("ไฟล์ไม่ได้อยู่ในรายการที่จะบันทึก");
      // Every uploaded asset gets a new name; do not overwrite shared assets.
      if (snapshot.files.has(write.path) && write.path.startsWith("source/")) throw new Error("ชื่อไฟล์ซ้ำ กรุณาลองบันทึกใหม่");
      const blob = await this.request("/git/blobs", "POST", {
        content: write.bytes ? encodeBase64(write.bytes) : write.text,
        encoding: write.bytes ? "base64" : "utf-8"
      });
      entries.set(write.path, { path: write.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const path of references) {
      if (!snapshot.files.has(path) && !entries.has(path)) throw new Error(`ยังไม่มีไฟล์สำหรับรายการ: ${path}`);
    }
    for (const path of oldReferences) {
      if (!references.has(path) && snapshot.files.has(path)) entries.set(path, { path, mode: "100644", type: "blob", sha: null });
    }
    entries.set("products.json", { path: "products.json", mode: "100644", type: "blob", content: json(products) });
    const tree = await this.request("/git/trees", "POST", { base_tree: snapshot.tree, tree: [...entries.values()] });
    const commit = await this.request("/git/commits", "POST", { message, tree: tree.sha, parents: [snapshot.head] });
    // Never force: concurrent edits must fail instead of being overwritten.
    await this.request(this.refPath.replace("/git/ref/", "/git/refs/"), "PATCH", { sha: commit.sha, force: false });
    const files = new Map(snapshot.files);
    for (const entry of entries.values()) {
      if (entry.sha === null) files.delete(entry.path);
      else files.set(entry.path, entry.sha || "pending-reload");
    }
    return { head: commit.sha, tree: tree.sha, files, products };
  }
}
