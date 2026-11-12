// Optional browser integration: install playwright outside the repo and set PLAYWRIGHT_MODULE.
// Uses local files and mocked GitHub; never writes to GitHub.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const original = JSON.parse(await fs.readFile(path.join(root, 'products.json'), 'utf8'));
  let products = structuredClone(original), head = 'head-0', counter = 0;
  const blobs = new Map(), files = new Map(), trees = new Map(), commits = new Map();
  const makeBlob = bytes => { const sha = `blob-${++counter}`; blobs.set(sha, Buffer.from(bytes)); return sha; };
  for (const p of products) {
    for (const key of ['image','firmware','manifest']) {
      const file = p[key].replace(/^\.\//, '');
      files.set(file, makeBlob(await fs.readFile(path.join(root, file))));
    }
  }
  files.set('products.json', makeBlob(JSON.stringify(products)));
  trees.set('tree-0', new Map(files)); commits.set(head, { tree: 'tree-0' });
  const server = http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/config') { res.writeHead(301, { Location: '/config/' }); return res.end(); }
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('outside root');
      const mime = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png' };
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control','no-store');
      res.end(pathname === '/products.json' ? JSON.stringify(products) : await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: {width:1280,height:1000} });
  const errors = [];
  const diagnostics = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if(message.type() === 'error') diagnostics.push(message.text()); });
  page.on('requestfailed', request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  let failedSave = false;
  await page.route('https://api.github.com/**', async route => {
    const req = route.request();
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-github-api-version' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status:204, headers });
    assert.equal(req.headers().authorization, 'Bearer test-token');
    const pathname = new URL(req.url()).pathname.replace('/repos/bkelec/esp32-web-installer','');
    const data = req.postDataJSON();
    let result;
    if (failedSave && req.method() === 'POST') return route.fulfill({ status:403, headers, json:{} });
    if (!pathname) result = { default_branch:'master' };
    else if (pathname === '/git/ref/heads/master') result = { object:{sha:head} };
    else if (req.method() === 'GET' && pathname.startsWith('/git/commits/')) result = { tree:{sha:commits.get(pathname.split('/').pop()).tree} };
    else if (req.method() === 'GET' && pathname.startsWith('/git/trees/')) result = {truncated:false,tree:[...trees.get(pathname.split('/').pop())].map(([path,sha])=>({path,sha,type:'blob',mode:'100644'}))};
    else if (req.method() === 'GET' && pathname.startsWith('/git/blobs/')) result = {content:blobs.get(pathname.split('/').pop()).toString('base64')};
    else if (pathname === '/git/blobs') result = {sha:makeBlob(data.encoding === 'base64' ? Buffer.from(data.content,'base64') : data.content)};
    else if (pathname === '/git/trees') {
      const tree = new Map(trees.get(data.base_tree));
      for(const e of data.tree) { if(e.sha === null) tree.delete(e.path); else tree.set(e.path,e.sha || makeBlob(e.content)); }
      const sha = `tree-${++counter}`; trees.set(sha,tree); result = {sha};
    } else if (pathname === '/git/commits') { const sha=`head-${++counter}`; commits.set(sha,data); result={sha}; }
    else if (pathname === '/git/refs/heads/master') {
      assert.equal(data.force,false);
      assert.equal(commits.get(data.sha).parents[0],head);
      head=data.sha;
      files.clear(); for(const [p,s] of trees.get(commits.get(head).tree)) files.set(p,s);
      products=JSON.parse(blobs.get(files.get('products.json')).toString());
      result={object:{sha:head}};
    } else throw new Error(`Unexpected API ${pathname}`);
    await route.fulfill({headers,json:result});
  });
  await page.route('https://raw.githubusercontent.com/**', async route => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.split('/').slice(4).join('/'));
    const sha = files.get(file);
    await route.fulfill(sha ? {body:blobs.get(sha),contentType:file.endsWith('.png')?'image/png':'image/jpeg'} : {status:404});
  });
  await page.route('https://unpkg.com/**', route => route.fulfill({contentType:'text/javascript',body:'customElements.define("esp-web-install-button", class extends HTMLElement {});'}));
  try {
    await page.goto(origin + '/config');
    await page.locator('#token').fill('test-token');
    await page.locator('#connect-form button').click();
    await page.waitForFunction(() => !document.getElementById('workspace').hidden && !document.getElementById('editor-fields').disabled);
    assert.equal(await page.locator('#token').inputValue(),'');
    assert.equal(await page.locator('#product-list button').count(),original.length);
    assert.equal(await page.evaluate(()=>localStorage.length + sessionStorage.length),0);
    await page.locator('#name').fill('Independent heading');
    await page.locator('#firmware').setInputFiles(path.join(root,original[0].firmware));
    await page.locator('#image').setInputFiles(path.join(root,original[3].image));
    await page.locator('#save').click();
    await page.waitForFunction(count=>document.getElementById('count').textContent.startsWith(`${count} `) && !document.getElementById('editor-fields').disabled, original.length + 1);
    assert.equal(products.length,original.length + 1);
    const added=products.at(-1);
    assert.equal(added.name,'Independent heading');
    assert.ok(!added.firmware.includes('indoor'));
    assert.ok(files.has(added.firmware.slice(2)));
    assert.equal(JSON.parse(blobs.get(files.get(added.manifest.slice(2)))).new_install_prompt_erase,false);
    await page.locator('#name').fill('Renamed item');
    await page.locator('#save').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#product-list button')].some(b=>b.textContent==='Renamed item') && !document.getElementById('editor-fields').disabled);
    assert.equal(products.at(-1).firmware,added.firmware);
    assert.equal(products.at(-1).image,added.image);
    await page.locator('#firmware').setInputFiles(path.join(root,original[1].firmware));
    await page.locator('#image').setInputFiles(path.join(root,original[4].image));
    await page.locator('#save').click();
    await page.waitForFunction(()=>!document.getElementById('editor-fields').disabled);
    assert.notEqual(products.at(-1).firmware,added.firmware);
    assert.ok(!files.has(added.firmware.slice(2)));
    assert.ok(!files.has(added.image.slice(2)));
    const beforeFail=head;
    failedSave=true;
    await page.locator('#name').fill('Must not publish');
    await page.locator('#save').click();
    await page.waitForFunction(()=>document.getElementById('status').classList.contains('error'));
    assert.equal(head,beforeFail);
    failedSave=false;
    page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('#delete').click();
    assert.equal(products.length,original.length + 1);
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#delete').click();
    await page.waitForFunction(count=>document.getElementById('count').textContent.startsWith(`${count} `) && !document.getElementById('editor-fields').disabled, original.length);
    assert.equal(products.length,original.length);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.QA_SCREENSHOT) await page.screenshot({path:process.env.QA_SCREENSHOT,fullPage:true});
    await page.locator('#disconnect').click();
    assert.equal(await page.locator('#workspace').isVisible(),false);
    await page.reload();
    assert.equal(await page.locator('#workspace').isVisible(),false);
    await page.goto(origin + '/');
    await page.waitForSelector('.product-card');
    assert.equal(await page.locator('.product-card').count(),original.length);
    for (const product of original.slice(-2)) {
      const card = page.locator(`.product-card[data-product-id="${product.id}"]`);
      await card.scrollIntoViewIfNeeded();
      await card.click();
      await page.waitForFunction(name=>document.getElementById('selected-name').textContent===name, product.name);
      await page.waitForFunction(id=>{
        const img=document.querySelector(`.product-card[data-product-id="${id}"] img`);
        return img.complete && img.naturalWidth>0;
      },product.id);
    }
    await page.locator('.product-card').last().click();
    await page.waitForSelector('esp-web-install-button');
    assert.equal(await page.locator('#selected-name').textContent(),original.at(-1).name);
    assert.equal(await page.locator('esp-web-install-button').evaluate(el=>el.overrides.checkSameFirmware()),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    products=[];
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('.product-card').length===0 && document.getElementById('selected-name').textContent.length>0);
    assert.equal(await page.locator('esp-web-install-button').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS browser: connect, no token persistence, add, rename, replace files, failed save, cancel/delete, mobile layout, disconnect/reload, home selection, empty catalog. GitHub API mocked.');
  } catch (error) {
    console.error('Browser status:', await page.locator('#status').textContent().catch(()=>''));
    console.error('Page errors:', errors);
    console.error('Diagnostics:', diagnostics);
    throw error;
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
