import { createManifest, filePath } from "../catalog.mjs";
import { Repository, OWNER, REPO, validateFirmware, imageExtension } from "./repository.mjs";

const $ = id => document.getElementById(id);
let repository, snapshot, selectedId = null, previewUrl = null, busy = false, publicationWatch = 0, imageCheck = 0;

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function setBusy(value) {
  busy = value;
  $("connection-fields").disabled = value;
  $("editor-fields").disabled = value;
  for (const id of ["add", "reload", "disconnect"]) $(id).disabled = value;
  for (const button of $("product-list").querySelectorAll("button")) button.disabled = value;
}

function rawImage(product) {
  const path = filePath(product.image, "source", [".jpg", ".jpeg", ".png", ".webp"]);
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${snapshot.head}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function preview(source) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("preview").removeAttribute("src");
  $("preview").hidden = !source;
  if (source instanceof Blob) {
    previewUrl = URL.createObjectURL(source);
    $("preview").src = previewUrl;
  } else if (source) $("preview").src = source;
}

function renderList() {
  $("product-list").replaceChildren();
  $("count").textContent = `${snapshot.products.length} รายการ`;
  for (const product of snapshot.products) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = product.name;
    button.setAttribute("aria-pressed", String(product.id === selectedId));
    button.addEventListener("click", () => { if (!busy) edit(product.id); });
    $("product-list").append(button);
  }
}

function edit(id = null) {
  imageCheck++;
  selectedId = id;
  const product = snapshot.products.find(p => p.id === id);
  $("editor").reset();
  $("name").value = product?.name || "";
  $("description").value = product?.description || "";
  $("firmware").required = !product;
  $("image").required = !product;
  $("delete").hidden = !product;
  $("editor-title").textContent = product ? "แก้ไขรายการ" : "เพิ่มรายการใหม่";
  $("save").textContent = product ? "บันทึกการแก้ไข" : "เพิ่มและบันทึก";
  $("current-firmware").textContent = product ? `ไฟล์เดิม: ${product.firmware}` : "เลือก merged ESP32 ที่เริ่มแฟลช 0x0 ขนาดไม่เกิน 16 MB";
  $("current-image").textContent = product ? `รูปเดิม: ${product.image}` : "รูปขนาดไม่เกิน 8 MB ชื่อไฟล์ต่างจาก firmware ได้";
  preview(product ? rawImage(product) : null);
  renderList();
}

$("connect-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const token = $("token").value.trim();
  $("token").value = "";
  if (!token) return status("กรุณากรอก GitHub Token", true);
  setBusy(true);
  const client = new Repository(token);
  try {
    status("กำลังเชื่อมต่อและโหลดรายการจาก GitHub…");
    const loaded = await client.connect($("branch").value);
    repository = client;
    snapshot = loaded;
    $("connect-form").hidden = true;
    $("connection").hidden = false;
    $("workspace").hidden = false;
    $("connection-info").textContent = `เชื่อมต่อ ${OWNER}/${REPO} · branch: ${repository.branch}`;
    edit();
    status("เชื่อมต่อแล้ว เลือกรายการเพื่อแก้ไข หรือเพิ่มรายการใหม่");
  } catch (error) {
    client.disconnect();
    status(error.message, true);
  } finally { setBusy(false); }
});

$("disconnect").addEventListener("click", () => {
  if (busy) return;
  repository?.disconnect();
  repository = snapshot = undefined;
  selectedId = null;
  publicationWatch++;
  preview(null);
  $("editor").reset();
  $("product-list").replaceChildren();
  $("workspace").hidden = $("connection").hidden = $("publication").hidden = true;
  $("connect-form").hidden = false;
  $("token").value = "";
  status("ตัดการเชื่อมต่อแล้ว Token ถูกนำออกจากหน่วยความจำของระบบจัดการ");
});

$("reload").addEventListener("click", async () => {
  if (busy || !repository) return;
  if (!confirm("โหลดข้อมูลล่าสุดและยกเลิกสิ่งที่ยังไม่ได้บันทึกในแบบฟอร์ม?")) return;
  setBusy(true);
  try {
    snapshot = await repository.load();
    edit();
    status("โหลดรายการล่าสุดแล้ว");
  } catch (error) { status(error.message, true); }
  finally { setBusy(false); }
});

$("add").addEventListener("click", () => { if (!busy) { edit(); $("name").focus(); } });

$("image").addEventListener("change", async () => {
  const check = ++imageCheck;
  const file = $("image").files[0];
  try {
    if (file) await imageExtension(file);
    if (check !== imageCheck) return;
    const product = snapshot?.products.find(p => p.id === selectedId);
    preview(file || (product ? rawImage(product) : null));
  } catch (error) {
    if (check !== imageCheck) return;
    $("image").value = "";
    preview(null);
    status(error.message, true);
  }
});

async function validateImage(file) {
  const extension = await imageExtension(file);
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error();
  } catch { throw new Error("ไฟล์รูปเสียหายหรือเบราว์เซอร์เปิดไม่ได้"); }
  finally { URL.revokeObjectURL(url); }
  return extension;
}

// Deployment is asynchronous. Poll only the public catalog; never send the token to Pages.
async function watchPublication(products) {
  const watch = ++publicationWatch;
  $("publication").hidden = false;
  $("publication-status").textContent = "บันทึกบน GitHub แล้ว กำลังรอ GitHub Pages เผยแพร่…";
  const expected = JSON.stringify(products);
  for (let attempt = 0; attempt < 18; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    if (watch !== publicationWatch) return;
    try {
      const url = new URL("../products.json", location.href);
      url.searchParams.set("check", Date.now());
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (response.ok && JSON.stringify(await response.json()) === expected) {
        if (watch === publicationWatch) $("publication-status").textContent = "เผยแพร่แล้ว เปิดหรือรีเฟรชหน้าติดตั้งเพื่อดูรายการล่าสุด";
        return;
      }
    } catch { /* The commit is saved even if deployment or this network check is delayed. */ }
  }
  if (watch === publicationWatch) $("publication-status").textContent = "บันทึกบน GitHub แล้ว แต่ยังตรวจไม่พบการเผยแพร่ กรุณาตรวจ GitHub Actions และ Settings → Pages ว่าใช้ branch ที่เลือก";
}

$("editor").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !repository || !snapshot) return;
  const name = $("name").value.trim();
  if (!name) return status("กรุณากรอกชื่อหัวข้อ", true);
  setBusy(true);
  try {
    status("กำลังตรวจไฟล์และบันทึก กรุณารอจนเสร็จ…");
    const current = snapshot.products.find(p => p.id === selectedId);
    const firmware = $("firmware").files[0], image = $("image").files[0];
    if (!current && (!firmware || !image)) throw new Error("รายการใหม่ต้องมีทั้ง firmware และรูป");
    if (firmware) await validateFirmware(firmware);
    const extension = image ? await validateImage(image) : null;
    const revision = crypto.randomUUID();
    const id = current?.id || `p-${crypto.randomUUID()}`;
    const product = {
      ...current, id, name, description: $("description").value.trim(),
      image: image ? `./source/${id}-${revision}.${extension}` : current.image,
      firmware: firmware ? `./source/${id}-${revision}.bin` : current.firmware,
      manifest: current?.manifest || `./manifests/${id}.json`, revision
    };
    const writes = [{ path: product.manifest.replace(/^\.\//, ""), text: JSON.stringify(createManifest(product), null, 2) + "\n" }];
    if (firmware) writes.push({ path: product.firmware.slice(2), bytes: new Uint8Array(await firmware.arrayBuffer()) });
    if (image) writes.push({ path: product.image.slice(2), bytes: new Uint8Array(await image.arrayBuffer()) });
    const products = current ? snapshot.products.map(p => p.id === id ? product : p) : [...snapshot.products, product];
    snapshot = await repository.save(snapshot, products, writes, `${current ? "Update" : "Add"} firmware: ${name}`);
    edit(id);
    status("บันทึกบน GitHub สำเร็จแล้ว กำลังรอเผยแพร่หน้าติดตั้ง");
    void watchPublication(products);
  } catch (error) { status(error.message, true); }
  finally { setBusy(false); }
});

$("delete").addEventListener("click", async () => {
  if (busy || !repository || !snapshot || !selectedId) return;
  const product = snapshot.products.find(p => p.id === selectedId);
  if (!confirm(`ลบรายการ “${product.name}” พร้อมไฟล์ที่ไม่มีรายการอื่นใช้งาน?`)) return;
  setBusy(true);
  try {
    status("กำลังลบรายการและไฟล์ที่ไม่ได้ใช้งาน…");
    const products = snapshot.products.filter(p => p.id !== selectedId);
    snapshot = await repository.save(snapshot, products, [], `Delete firmware: ${product.name}`);
    edit();
    status("ลบรายการบน GitHub แล้ว กำลังรอเผยแพร่หน้าติดตั้ง");
    void watchPublication(products);
  } catch (error) { status(error.message, true); }
  finally { setBusy(false); }
});

window.addEventListener("beforeunload", event => {
  if (busy) { event.preventDefault(); event.returnValue = ""; }
});
