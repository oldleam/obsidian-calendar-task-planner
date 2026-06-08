/*
 * Calendar Task Planner v1.0.0
 * Obsidian Plugin
 */

'use strict';

const { Plugin, ItemView, WorkspaceLeaf, Modal, Notice, TFile } = require('obsidian');

const VIEW_TYPE = 'calendar-task-planner';

const UA_MONTHS = [
  'Січень','Лютий','Березень','Квітень','Травень','Червень',
  'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
];
const UA_MONTHS_GEN = [
  'Січня','Лютого','Березня','Квітня','Травня','Червня',
  'Липня','Серпня','Вересня','Жовтня','Листопада','Грудня'
];
const UA_WEEKDAYS_LONG = ['Неділя','Понеділок','Вівторок','Середа','Четвер','П\'ятниця','Субота'];
const UA_WEEKDAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

/* ─────────────────────────────────────────
   Data helpers
───────────────────────────────────────── */

function dateKey(year, month, day) {
  return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function today() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/* ─────────────────────────────────────────
   Storage
───────────────────────────────────────── */

class TaskStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.data = {};
    this.fileName = 'Calendar Task Planner.json';
  }

  async load() {
    try {
      const adapter = this.plugin.app.vault.adapter;
      const exists = await adapter.exists(this.fileName);
      if (exists) {
        const raw = await adapter.read(this.fileName);
        this.data = JSON.parse(raw);
      }
    } catch(e) {
      console.error('CTP: failed to load data', e);
      this.data = {};
    }
  }

  async save() {
    try {
      const adapter = this.plugin.app.vault.adapter;
      await adapter.write(this.fileName, JSON.stringify(this.data, null, 2));
    } catch(e) {
      console.error('CTP: failed to save data', e);
    }
  }

  getTasks(key) {
    return this.data[key] || [];
  }

  setTasks(key, tasks) {
    this.data[key] = tasks;
    this.save();
  }

  getStats(year, month) {
    let total = 0, done = 0;
    const prefix = `${year}-${String(month+1).padStart(2,'0')}-`;
    for (const [k,tasks] of Object.entries(this.data)) {
      if (!k.startsWith(prefix)) continue;
      total += tasks.length;
      done  += tasks.filter(t => t.done).length;
    }
    return { total, done, pct: total ? Math.round(done/total*100) : 0 };
  }
}

/* ─────────────────────────────────────────
   Day Modal
───────────────────────────────────────── */

class DayModal extends Modal {
  constructor(app, store, year, month, day, onClose) {
    super(app);
    this.store   = store;
    this.year    = year;
    this.month   = month;
    this.day     = day;
    this.onClose = onClose;
    this.key     = dateKey(year, month, day);
    this.tasks   = JSON.parse(JSON.stringify(store.getTasks(this.key)));
    this.modalEl.addClass('ctp-modal');
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    const d     = new Date(this.year, this.month, this.day);
    const wdName = UA_WEEKDAYS_LONG[d.getDay()];
    const mName  = UA_MONTHS_GEN[this.month];

    // Header
    const header = contentEl.createDiv('ctp-modal-header');
    header.createEl('h2', { text: `${wdName}, ${this.day} ${mName} ${this.year}` });

    // Body
    const body = contentEl.createDiv('ctp-modal-body');

    // Task list
    const taskList = body.createDiv('ctp-task-list');
    this.renderTasks(taskList);

    // Add input
    const addRow = body.createDiv('ctp-add-row');
    const input  = addRow.createEl('input', {
      type: 'text',
      cls: 'ctp-add-input',
      attr: { placeholder: 'Нова задача…' }
    });
    const addBtn = addRow.createEl('button', { text: '+ Додати', cls: 'ctp-add-btn' });

    const addTask = () => {
      const text = input.value.trim();
      if (!text) return;
      this.tasks.push({ id: Date.now(), text, done: false });
      this.persist();
      input.value = '';
      this.renderTasks(taskList);
    };

    addBtn.onclick = addTask;
    input.onkeydown = e => { if (e.key === 'Enter') addTask(); };

    // Footer
    const footer = contentEl.createDiv('ctp-modal-footer');

    const exportBtn = footer.createEl('button', { text: '📄 Експорт в нотатку', cls: 'ctp-export-btn' });
    exportBtn.onclick = () => this.exportToNote();

    const canvasBtn = footer.createEl('button', { text: '🗂 Додати день у Canvas', cls: 'ctp-canvas-btn' });
    canvasBtn.onclick = () => this.addToCanvas();
  }

  renderTasks(container) {
    container.empty();
    if (!this.tasks.length) {
      container.createDiv({ text: 'Задач ще немає. Додайте першу!', cls: 'ctp-empty' });
      return;
    }
    this.tasks.forEach((task, i) => {
      const row  = container.createDiv('ctp-modal-task');

      const cb   = row.createDiv('ctp-modal-cb' + (task.done ? ' checked' : ''));
      cb.onclick = () => {
        this.tasks[i].done = !this.tasks[i].done;
        this.persist();
        cb.className = 'ctp-modal-cb' + (this.tasks[i].done ? ' checked' : '');
        lbl.className = 'ctp-modal-task-text' + (this.tasks[i].done ? ' done' : '');
      };

      const lbl  = row.createEl('span', {
        text: task.text,
        cls: 'ctp-modal-task-text' + (task.done ? ' done' : '')
      });
      lbl.contentEditable = 'true';
      lbl.onblur = () => {
        const newText = lbl.innerText.trim();
        if (newText) { this.tasks[i].text = newText; this.persist(); }
        else { lbl.innerText = task.text; }
      };
      lbl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); lbl.blur(); } };

      const del  = row.createEl('button', { text: '×', cls: 'ctp-delete-task' });
      del.onclick = () => {
        this.tasks.splice(i, 1);
        this.persist();
        this.renderTasks(container);
      };
    });
  }

  persist() {
    this.store.setTasks(this.key, this.tasks);
  }

  async exportToNote() {
    const d     = new Date(this.year, this.month, this.day);
    const wdName = UA_WEEKDAYS_LONG[d.getDay()];
    const mName  = UA_MONTHS_GEN[this.month];
    const dateStr = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(this.day).padStart(2,'0')}`;
    const fileName = `${dateStr}.md`;

    let content = `# ${wdName}, ${this.day} ${mName} ${this.year}\n\n`;
    if (this.tasks.length) {
      content += this.tasks.map(t => `- [${t.done?'x':' '}] ${t.text}`).join('\n');
    } else {
      content += '_Задач немає._';
    }

    try {
      const existing = this.app.vault.getAbstractFileByPath(fileName);
      if (existing) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(fileName, content);
      }
      new Notice(`✅ Збережено у ${fileName}`);
    } catch(e) {
      new Notice('❌ Помилка при збереженні нотатки');
    }
  }

  async addToCanvas() {
    // Find or create a canvas file
    let canvasFile = this.app.vault.getAbstractFileByPath('Calendar Task Planner.canvas');
    const d     = new Date(this.year, this.month, this.day);
    const wdName = UA_WEEKDAYS_LONG[d.getDay()];
    const mName  = UA_MONTHS_GEN[this.month];

    const nodeText = `**${wdName}, ${this.day} ${mName} ${this.year}**\n\n` +
      (this.tasks.length
        ? this.tasks.map(t => `- [${t.done?'x':' '}] ${t.text}`).join('\n')
        : '_Задач немає._');

    const newNode = {
      id: `day-${this.key}`,
      type: 'text',
      text: nodeText,
      x: Math.floor(Math.random() * 400),
      y: Math.floor(Math.random() * 400),
      width: 280,
      height: this.tasks.length * 30 + 80
    };

    try {
      let canvasData = { nodes: [], edges: [] };
      if (canvasFile) {
        const raw = await this.app.vault.read(canvasFile);
        canvasData = JSON.parse(raw);
      }
      // Replace node if same key exists
      canvasData.nodes = canvasData.nodes.filter(n => n.id !== newNode.id);
      canvasData.nodes.push(newNode);

      const json = JSON.stringify(canvasData, null, 2);
      if (canvasFile) {
        await this.app.vault.modify(canvasFile, json);
      } else {
        await this.app.vault.create('Calendar Task Planner.canvas', json);
      }
      new Notice('🗂 День додано у Canvas');
      this.close();
      // Open canvas
      const file = this.app.vault.getAbstractFileByPath('Calendar Task Planner.canvas');
      if (file) this.app.workspace.getLeaf(true).openFile(file);
    } catch(e) {
      new Notice('❌ Помилка при додаванні у Canvas');
      console.error(e);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.onClose) this.onClose();
  }
}

/* ─────────────────────────────────────────
   Planner View
───────────────────────────────────────── */

class CalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin   = plugin;
    this.store    = plugin.store;
    const t       = today();
    this.viewYear  = t.year;
    this.viewMonth = t.month;
  }

  getViewType()        { return VIEW_TYPE; }
  getDisplayText()     { return 'Calendar Task Planner'; }
  getIcon()            { return 'calendar-days'; }

  async onOpen() {
    await this.store.load();
    this.render();
  }

  render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('ctp-view');

    this.renderHeader(root);
    this.renderStats(root);
    this.renderCalendar(root);
  }

  renderHeader(root) {
    const header = root.createDiv('ctp-header');

    const nav = header.createDiv('ctp-nav');

    const prevBtn = nav.createEl('button', { text: '‹', cls: 'ctp-nav-btn', attr: { title: 'Попередній місяць' } });
    prevBtn.onclick = () => {
      this.viewMonth--;
      if (this.viewMonth < 0) { this.viewMonth = 11; this.viewYear--; }
      this.render();
    };

    const title = nav.createDiv('ctp-month-title');
    title.setText(`${UA_MONTHS[this.viewMonth]} ${this.viewYear}`);

    const nextBtn = nav.createEl('button', { text: '›', cls: 'ctp-nav-btn', attr: { title: 'Наступний місяць' } });
    nextBtn.onclick = () => {
      this.viewMonth++;
      if (this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++; }
      this.render();
    };

    const todayBtn = header.createEl('button', { text: 'Сьогодні', cls: 'ctp-today-btn' });
    todayBtn.onclick = () => {
      const t = today();
      this.viewYear  = t.year;
      this.viewMonth = t.month;
      this.render();
    };
  }

  renderStats(root) {
    const stats = this.store.getStats(this.viewYear, this.viewMonth);
    const bar   = root.createDiv('ctp-stats');

    const s1 = bar.createDiv('ctp-stat');
    s1.innerHTML = `Всього: <span>${stats.total}</span>`;

    const s2 = bar.createDiv('ctp-stat ctp-stat-done');
    s2.innerHTML = `Виконано: <span>${stats.done}</span>`;

    const s3 = bar.createDiv('ctp-stat');
    s3.innerHTML = `Не виконано: <span>${stats.total - stats.done}</span>`;

    const s4 = bar.createDiv('ctp-stat ctp-stat-pct');
    s4.innerHTML = `Виконання: <span>${stats.pct}%</span>`;
  }

  renderCalendar(root) {
    const cal = root.createDiv('ctp-calendar');

    // Weekday headers (Mon first)
    const wdRow = cal.createDiv('ctp-weekdays');
    UA_WEEKDAYS_SHORT.forEach(wd => {
      wdRow.createDiv({ text: wd, cls: 'ctp-weekday' });
    });

    const grid = cal.createDiv('ctp-grid');

    const firstDay  = new Date(this.viewYear, this.viewMonth, 1);
    const lastDay   = new Date(this.viewYear, this.viewMonth+1, 0);
    const t         = today();

    // Monday-first offset: Sun=0 → need 6 blanks, Mon=1 → 0, Tue=2 → 1 ...
    let startOffset = (firstDay.getDay() + 6) % 7;

    // Prev month filler cells
    for (let i = 0; i < startOffset; i++) {
      const prevLast = new Date(this.viewYear, this.viewMonth, 0).getDate();
      const dayNum   = prevLast - startOffset + i + 1;
      this.renderDayCard(grid, this.viewYear, this.viewMonth - 1, dayNum, true);
    }

    // Current month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      this.renderDayCard(grid, this.viewYear, this.viewMonth, d, false);
    }

    // Next month filler
    const total = startOffset + lastDay.getDate();
    const remainder = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 1; i <= remainder; i++) {
      this.renderDayCard(grid, this.viewYear, this.viewMonth + 1, i, true);
    }
  }

  renderDayCard(grid, year, month, day, otherMonth) {
    // Normalise month/year for other-month cells
    let ny = year, nm = month;
    if (nm < 0)  { nm = 11; ny--; }
    if (nm > 11) { nm = 0;  ny++; }

    const t       = today();
    const isToday = !otherMonth && year === t.year && month === t.month && day === t.day;
    const dow     = new Date(ny, nm, day).getDay(); // 0=Sun,6=Sat
    const isWeekend = dow === 0 || dow === 6;

    const key     = dateKey(ny, nm, day);
    const tasks   = this.store.getTasks(key);

    let cls = 'ctp-day';
    if (otherMonth) cls += ' is-other-month';
    if (isToday)    cls += ' is-today';
    if (isWeekend)  cls += ' is-weekend';

    const card = grid.createDiv(cls);

    const numEl = card.createDiv('ctp-day-num');
    numEl.setText(String(day));

    // Tasks preview
    const taskArea = card.createDiv('ctp-day-tasks');
    const MAX_SHOW = 4;
    tasks.slice(0, MAX_SHOW).forEach((task, i) => {
      const row = taskArea.createDiv('ctp-task-row');

      const cb  = row.createDiv('ctp-task-cb' + (task.done ? ' checked' : ''));
      cb.onclick = (e) => {
        e.stopPropagation();
        const all = this.store.getTasks(key);
        all[i].done = !all[i].done;
        this.store.setTasks(key, all);
        cb.className = 'ctp-task-cb' + (all[i].done ? ' checked' : '');
        lbl.className = 'ctp-task-label' + (all[i].done ? ' done' : '');
      };

      const lbl = row.createEl('span', {
        text: task.text,
        cls: 'ctp-task-label' + (task.done ? ' done' : '')
      });
    });

    if (tasks.length > MAX_SHOW) {
      taskArea.createDiv({ text: `+${tasks.length - MAX_SHOW} ще…`, cls: 'ctp-more' });
    }

    // Click → modal
    card.onclick = () => {
      if (otherMonth) {
        // Navigate to that month
        this.viewYear  = ny;
        this.viewMonth = nm;
        this.render();
        return;
      }
      new DayModal(this.app, this.store, year, month, day, () => this.render()).open();
    };
  }

  async onClose() {}
}

/* ─────────────────────────────────────────
   Plugin
───────────────────────────────────────── */

class CalendarTaskPlanner extends Plugin {
  async onload() {
    this.store = new PlannerStore(this);
    await this.store.load();

    this.registerView(VIEW_TYPE, (leaf) => new PlannerView(leaf, this));

    this.addRibbonIcon('calendar-days', 'Calendar Task Planner', () => this.activateView());

    this.addCommand({
      id: 'open-ctp-planner',
      name: 'Відкрити Calendar Task Planner',
      callback: () => this.activateView()
    });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  onunload() {}
}

module.exports = CalendarTaskPlanner;
