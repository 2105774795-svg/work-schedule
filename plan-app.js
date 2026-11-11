'use strict';

// 页面外壳提供工作计划界面使用的渲染、对话框与通知入口。
const icons = {
  file: 'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h6',
  folder: 'M3 7V5h6l2 2h10v13H3z',
  calendar: 'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M7 14h2 M14 14h2 M7 17h2',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  chevron: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12 M6 18L18 6',
  download: 'M12 3v13 M7 11l5 5 5-5 M3 16v5h18v-5',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  pen: 'M14 4l6 6 M4 20l5-1L21 7l-5-5L4 14z M13 21h8',
  search: 'M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  layers: 'M12 2L2 7l10 5 10-5z M2 12l10 5 10-5 M2 17l10 5 10-5',
  users: 'M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M21 21v-2a4 4 0 0 0-3-4 M17 4a4 4 0 0 1 0 8'
};

const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.file}"/></svg>`;
const escapes = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => escapes[character]);
const state = {view: 'plan', projects: []};
const main = document.getElementById('main');
const dialog = document.getElementById('workspace-dialog');
const dialogContent = document.getElementById('dialog-content');
const notification = document.getElementById('toast');
let toastTimer;

function paintIcons(root) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    element.innerHTML = icon(element.dataset.icon);
  });
}

function render() {
  main.innerHTML = window.workbenchPlan.view();
  window.workbenchPlan.enhance();
}

function go(view) {
  state.view = view;
  render();
  window.scrollTo({top: 0});
}

function toast(message) {
  notification.textContent = message;
  notification.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => notification.classList.remove('visible'), 4200);
}

function showDialog(html, compact = false) {
  dialog.classList.toggle('compact-dialog', compact);
  dialogContent.innerHTML = html;
  paintIcons(dialog);
  if (!dialog.open) dialog.showModal();
}

function dialogHeader(title, description, symbol = 'file') {
  return `<div class="dialog-header">
    <div class="dialog-title-wrap"><span class="tool-icon">${icon(symbol)}</span>
      <div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div>
    </div>
    <button type="button" class="icon-btn" data-close aria-label="关闭窗口">${icon('close')}</button>
  </div>`;
}

dialog.addEventListener('click', event => {
  if (event.target.closest('[data-close]')) dialog.close();
});

document.addEventListener('DOMContentLoaded', () => {
  paintIcons(document);
  render();
}, {once: true});
