// Paths are relative to the site root, never external URLs or parent directories.
export function filePath(value, folder, extensions) {
  if (typeof value !== "string") throw new Error("ข้อมูลเส้นทางไฟล์ไม่ถูกต้อง");
  const path = value.replace(/^\.\//, "");
  if (!path.startsWith(`${folder}/`) || /[\\%?#\u0000-\u001f]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === "..") ||
      !extensions.some(extension => path.toLowerCase().endsWith(extension))) {
    throw new Error("เส้นทางไฟล์ต้องอยู่ในโฟลเดอร์ที่กำหนดและมีชนิดไฟล์ถูกต้อง");
  }
  return path;
}

export function validateCatalog(products) {
  if (!Array.isArray(products)) throw new Error("รายการ firmware ต้องเป็นรายการข้อมูล");
  const ids = new Set();
  const manifests = new Set();
  for (const product of products) {
    if (!product || typeof product.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(product.id) || ids.has(product.id) ||
        typeof product.name !== "string" || !product.name.trim() || product.name.length > 160 ||
        typeof product.description !== "string" || product.description.length > 1000 ||
        (product.revision !== undefined && (typeof product.revision !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(product.revision)))) {
      throw new Error("ข้อมูลรายการ firmware ไม่ถูกต้องหรือมีรหัสซ้ำ");
    }
    ids.add(product.id);
    filePath(product.image, "source", [".jpg", ".jpeg", ".png", ".webp"]);
    filePath(product.firmware, "source", [".bin"]);
    const manifest = filePath(product.manifest, "manifests", [".json"]);
    if (manifest.split("/").length !== 2 || manifests.has(manifest)) throw new Error("แต่ละรายการต้องมี manifest ของตัวเองในโฟลเดอร์ manifests");
    manifests.add(manifest);
  }
  return products;
}

export function createManifest(product) {
  const firmware = filePath(product.firmware, "source", [".bin"]);
  // Catalog manifests are all directly inside manifests/.
  if (filePath(product.manifest, "manifests", [".json"]).split("/").length !== 2) {
    throw new Error("manifest ต้องอยู่ในโฟลเดอร์ manifests โดยตรง");
  }
  return {
    name: product.name,
    version: product.revision || "",
    new_install_prompt_erase: false,
    builds: [{ chipFamily: "ESP32", parts: [{ path: `../${firmware}`, offset: 0 }] }]
  };
}

export function referencedFiles(products) {
  validateCatalog(products);
  return new Set(products.flatMap(p => [
    filePath(p.image, "source", [".jpg", ".jpeg", ".png", ".webp"]),
    filePath(p.firmware, "source", [".bin"]),
    filePath(p.manifest, "manifests", [".json"])
  ]));
}
