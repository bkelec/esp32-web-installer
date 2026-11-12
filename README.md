# ESP32 Web Installer

เว็บเลือกสินค้าและติดตั้ง merged firmware สำหรับ ESP32 ผ่าน USB ด้วย Chrome หรือ Edge บนคอมพิวเตอร์

## การเพิ่มสินค้าและเฟิร์มแวร์

ใช้หน้า `https://bkelec.github.io/esp32-web-installer/config/` เพื่อเพิ่มและจัดการรายการ (`/config` จะเปลี่ยนไปยัง `/config/` บน GitHub Pages)

1. เชื่อมต่อด้วย GitHub Token และเลือก branch ที่ใช้เผยแพร่
2. กดเพิ่มรายการ กรอกชื่อหัวข้อและคำอธิบาย (ถ้ามี) เลือก merged `.bin` และรูป แล้วกดเพิ่มและบันทึก รายการใหม่อยู่ท้ายรายการเดิม
3. หากต้องการแก้ไข ให้เลือกรายการเดิมแล้วแก้ชื่อ เปลี่ยนรูป หรือเปลี่ยน firmware ช่องไฟล์ที่เว้นว่างจะใช้ไฟล์เดิม
4. หากต้องการลบ ให้เลือกรายการแล้วกดลบและยืนยัน ระบบลบไฟล์ที่ไม่มีรายการอื่นใช้งานแล้วด้วย

ชื่อหัวข้อ ชื่อ firmware และชื่อรูปไม่จำเป็นต้องตรงกัน ระบบสร้างชื่อไฟล์ภายในที่ไม่ซ้ำให้ และบันทึกการเชื่อมโยงใน `products.json` ไม่ต้องแก้ `index.html` เพื่อเพิ่มสินค้าอีก

รองรับรูป JPG, PNG และ WebP ไม่เกิน 8 MB และ merged `.bin` สำหรับ ESP32 รุ่นดั้งเดิมที่เริ่มแฟลช `0x0` ไม่เกิน 16 MB ตรวจโครงสร้างเบื้องต้นที่ bootloader `0x1000`, partition table `0x8000`, แอป `0x10000` และ chip ID ไม่รองรับไฟล์แอปเดี่ยวหรือ ESP32-S2/S3/C3 การตรวจนี้ไม่รับรองความเหมาะสมกับวงจร ผู้ดูแลต้องเลือกไฟล์ให้ตรงกับสินค้า

แต่ละสินค้าใช้ manifest แยกกัน และปุ่มติดตั้งจะแสดงชื่อรุ่นที่เลือกเพื่อป้องกันการเลือกเฟิร์มแวร์ผิดรุ่น

รุ่นที่รองรับ: PM16x32 indoor, PM16x32 outdoor, PM16x32 outdoor_air4thai, PM32x64_full_color, PM32x64_mono, score_นับคะแนน และ score_นับคะแนน_จับเวลา

## การล้าง Flash ก่อนติดตั้ง

ทุกครั้งที่ติดตั้ง ระบบจะล้าง Flash ทั้งชิปอัตโนมัติ โดยไม่มีคำถามให้เลือก Erase Flash ข้อมูลเดิมใน Flash รวมถึง Wi-Fi และค่าตั้งที่บันทึกไว้จะถูกลบ ผู้ใช้ยังต้องเลือกพอร์ต USB และกดยืนยันการติดตั้งตามขั้นตอนของ ESP Web Tools

ปุ่มติดตั้งกำหนด `overrides.checkSameFirmware` ให้คืนค่า `false` เพื่อให้ ESP Web Tools ใช้ขั้นตอนติดตั้งใหม่และล้างทั้งชิป แม้อุปกรณ์รายงาน firmware ชื่อเดิมผ่าน Improv Serial แทนการอัปเดตแบบเก็บข้อมูล

## ตั้งค่าหน้าจัดการครั้งแรก

1. นำโค้ดเวอร์ชันนี้ รวมถึง `products.json`, `catalog.mjs` และโฟลเดอร์ `config` ขึ้น repository และรอ GitHub Pages เผยแพร่ก่อน
2. ตรวจ repository → **Settings → Pages** ว่าเผยแพร่จาก branch ใด หากใช้ GitHub Actions ต้องตั้ง workflow ให้เผยแพร่เมื่อมีการ push ไปยัง branch นั้น
3. เปิด [สร้าง Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) เลือก Resource owner ที่มีสิทธิ์จัดการ repository นี้ กำหนดวันหมดอายุ เลือก **Only select repositories → esp32-web-installer** และ **Repository permissions → Contents: Read and write** ไม่ต้องเพิ่มสิทธิ์แก้ workflow
4. เก็บ Token ในโปรแกรมจัดการรหัสผ่าน เปิดหน้า `/config/` กรอก Token และ branch ที่ใช้เผยแพร่ หากเว้น branch ว่าง ระบบใช้ default branch ของ repository

หน้า config เป็นหน้าสาธารณะ แต่การเขียนและลบต้องใช้ Token ที่ GitHub อนุญาต Token ถูกส่งเฉพาะไปยัง `https://api.github.com` เก็บในหน่วยความจำของแท็บ ไม่เก็บใน localStorage, sessionStorage, cookie, URL หรือไฟล์ repository รีเฟรช/ปิดแท็บแล้วต้องกรอกใหม่ กดตัดการเชื่อมต่อเพื่อล้าง Token จากระบบจัดการได้

## การบันทึกและเผยแพร่

ระบบใช้ GitHub Git Database API สร้าง blobs แล้วรวมรูป, firmware, manifest, รายการสินค้า และการลบไฟล์เก่าใน **commit เดียว** ก่อนเลื่อน branch โดยไม่ใช้ force หาก branch เปลี่ยนระหว่างแก้ไขจะหยุดแทนการเขียนทับข้อมูลใหม่ หากอัปโหลดไฟล์ไม่ครบจะยังไม่เปลี่ยนรายการที่เผยแพร่

บันทึกสำเร็จหมายถึงมี commit บน GitHub แล้ว ต้องรอ GitHub Pages เผยแพร่ก่อน หน้า config ตรวจรายการสาธารณะทุก 10 วินาทีเป็นเวลาประมาณ 3 นาที หากยังไม่พบ ให้ตรวจ GitHub Actions และ branch ใน Settings → Pages เมื่อเผยแพร่แล้วให้เปิดหรือรีเฟรชหน้าติดตั้ง หน้าที่เปิดค้างอยู่ไม่ได้เพิ่มรายการเองโดยไม่รีเฟรช

หากเครือข่ายขาดตอนระหว่างบันทึก ให้โหลดรายการล่าสุดก่อนลองใหม่ เพราะ commit อาจบันทึกสำเร็จไปแล้ว ปุ่มโหลดรายการล่าสุดจะยกเลิกข้อมูลที่ยังไม่บันทึกในแบบฟอร์ม ไฟล์ที่ลบยังคงอยู่ในประวัติ Git และการแทนที่ไฟล์จำนวนมากจะทำให้ repository โตขึ้น

การใช้งาน config เขียนลง GitHub โดยตรง ไม่แก้ไฟล์ในเครื่องนี้ หลังแก้ผ่าน config ให้ `git pull` ก่อนแก้โค้ดและ push จากเครื่องเพื่อรับข้อมูลล่าสุด

## โครงสร้างและการตรวจสอบ

- `products.json`: รายการสินค้าและเส้นทางรูป, firmware, manifest
- `source/`: รูปและ merged firmware
- `manifests/`: manifest แยกตามรายการ
- `catalog.mjs`: ตรวจข้อมูลและสร้าง manifest
- `config/`: หน้าจัดการและ client สำหรับ GitHub API

ใช้ Node.js 22 ขึ้นไปเพื่อตรวจสอบ:

```sh
node --test tests/repository.test.mjs
```

ทดสอบไฟล์จริงทั้ง 7 รุ่น, ชื่อไฟล์ต่างกัน, เพิ่ม/แทนที่/ลบใน commit เดียว, ไฟล์ที่ใช้ร่วมกัน, อัปโหลดล้มเหลว และป้องกันเขียนทับเมื่อ branch เปลี่ยน โดยจำลอง GitHub API ไม่เขียนข้อมูลไปยัง GitHub จริง

เปิดเว็บในเครื่องด้วย HTTP server ที่ให้บริการ `.mjs` เป็น JavaScript เช่น `npx http-server .` แทนการเปิด HTML โดยตรง การแฟลชผ่าน USB ต้องใช้ HTTPS หรือ localhost

มีการทดสอบเบราว์เซอร์เพิ่มเติมใน `tests/browser.cjs` ใช้ Playwright โดยกำหนด `PLAYWRIGHT_MODULE` เป็นตำแหน่งแพ็กเกจหากติดตั้งแยกจาก repository และ `BROWSER_EXECUTABLE` เป็นตำแหน่ง Chrome/Edge หากไม่ได้ติดตั้ง Chromium ของ Playwright แล้วรัน `node tests/browser.cjs` การทดสอบนี้จำลอง GitHub เช่นกัน
