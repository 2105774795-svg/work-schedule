const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const jsdomPath = process.env.PLAN_QA_MODULES ? path.join(process.env.PLAN_QA_MODULES, 'jsdom') : 'jsdom';
const {JSDOM} = require(jsdomPath);
const {handler} = require('../server/plan-server.cjs');
const Zip = require('../vendor/jszip.min.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script defer src="\.\/([^"]+)"/g)].map(match => match[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)"/g)].map(match => match[1]);

async function status(url) {
  let code;
  await handler({url, method: 'HEAD', headers: {}}, {
    writeHead(value) { code = value; },
    end() {}
  });
  return code;
}

test('独立页面所需的静态资源都可由后端提供', async () => {
  assert(scripts.length > 0 && styles.length > 0);
  for (const route of ['/', ...[...scripts, ...styles].map(file => '/' + file)]) {
    assert.equal(await status(route), 200, route);
  }
  assert.equal(await status('/server/.env'), 404);
});

test('独立页面可离线载入示例、编辑月历并导出 1 至 5 个工作表', {timeout: 10000}, async t => {
  const dom = new JSDOM(html, {url: 'http://localhost:8877/', runScripts: 'outside-only'});
  const {window} = dom;
  const {document} = window;
  t.after(() => window.close());
  window.Blob = Blob;
  window.setImmediate = setImmediate;
  window.clearImmediate = clearImmediate;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  let fetchCalls = 0;
  window.fetch = () => {
    fetchCalls++;
    throw Error('离线测试不访问网络');
  };

  for (const file of scripts) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), dom.getInternalVMContext(), {filename: file});
  }
  await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once: true}));

  function query(selector) {
    const element = document.querySelector(selector);
    assert(element, selector);
    return element;
  }

  assert(query('#plan-setup-form').elements.name);
  query('[data-plan-action="reference"]').click();
  query('[data-expand-all]').click();
  query('[data-node-edit]');
  query('[data-plan-action="generate"]').click();
  query('.plan-grid tbody [data-plan-task]').click();
  assert.equal(query('dialog').open, true, query('#toast').textContent);
  const form = query('#plan-task-form');
  form.elements.work.value = '公开示例验收任务';
  form.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  assert.equal(query('dialog').open, false, query('#toast').textContent);
  assert.equal(query('.plan-grid textarea[data-inline-field="work"]').value, '公开示例验收任务', query('#toast').textContent);

  let blob;
  window.URL.createObjectURL = value => {
    blob = value;
    return 'blob:offline';
  };
  window.URL.revokeObjectURL = () => {};

  const options = [...document.querySelectorAll('[data-plan-export-option]')].map(option => option.dataset.planExportOption);
  assert.equal(options.length, 4);
  function setOption(optionName, checked) {
    const option = [...document.querySelectorAll('[data-plan-export-option]')].find(input => input.dataset.planExportOption === optionName);
    option.checked = checked;
    option.dispatchEvent(new window.Event('change', {bubbles: true}));
  }

  options.forEach(option => setOption(option, false));
  for (let count = 1; count <= 5; count++) {
    if (count > 1) setOption(options[count - 2], true);
    const filename = await new Promise(resolve => {
      window.HTMLAnchorElement.prototype.click = function () { resolve(this.download); };
      query('[data-plan-action="download"]').click();
    });
    assert.match(filename, /\.xlsx$/);
    const workbook = await Zip.loadAsync(await blob.arrayBuffer());
    const sheetNames = Object.keys(workbook.files).filter(file => /^xl\/worksheets\/sheet\d+\.xml$/.test(file));
    assert.equal(sheetNames.length, count);
    assert.match(await workbook.file('xl/worksheets/sheet1.xml').async('string'), /公开示例验收任务/);
  }
  assert.equal(fetchCalls, 0);
});
