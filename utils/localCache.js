// ============================================================
// localCache.js — Mongoose-compatible in-memory DB
// Backed by Google Apps Script / Google Sheets for persistence
// ============================================================
'use strict';

// ── Dynamic SHEETS_URL — read at call time so dotenv is already loaded ──────
function getSheetsUrl() {
  return process.env.GOOGLE_SHEET_URL || '';
}

// ── Unique ID generator ──────────────────────────────────────
function generateId() {
  return Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

// ── Initial clean state (built lazily so env vars are read after dotenv) ─────
const STATIC_ADMIN_ID = '000000000000000000000000';

function makeInitialState() {
  return {
    employees: [
      {
        _id: STATIC_ADMIN_ID,
        fullName: 'System Admin',
        email: process.env.ADMIN_EMAIL || 'admin@gmail.com',
        password: process.env.ADMIN_PASSWORD || 'Admin123',
        role: 'admin',
        isActive: true,
        isVerified: true,
        assignedAssessments: [],
        loginHistory: [],
        examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    questions: [],
    assessments: [],
    results: [],
    violations: [],
    auditlogs: [],
  };
}

let IN_MEMORY_DB = null; // lazily initialized

// ── DB accessors ─────────────────────────────────────────────
function readDB() {
  if (!IN_MEMORY_DB) IN_MEMORY_DB = makeInitialState();
  return IN_MEMORY_DB;
}
function writeDB(data) { IN_MEMORY_DB = data; }

// ── Google Sheets helpers ─────────────────────────────────────

/**
 * Parse a Response safely — detects HTML auth pages from Google.
 */
async function safeParseResponse(res, action) {
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    // Google returned an HTML page — Apps Script not deployed as public web app
    console.error(
      `[Sheets] ❌ Got HTML instead of JSON for action "${action}".\n` +
      `  This means the Apps Script is NOT deployed as a public web app.\n` +
      `  Fix: In Google Apps Script → Deploy → Manage Deployments → Edit → Who has access: Anyone → Save.\n` +
      `  URL used: ${getSheetsUrl()}`
    );
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[Sheets] ❌ JSON parse failed for "${action}":`, text.slice(0, 200));
    return null;
  }
}

/**
 * POST a payload to Google Apps Script.
 * Returns the parsed JSON response, or null on failure.
 */
async function sheetsPost(payload) {
  const SHEETS_URL = getSheetsUrl();
  if (!SHEETS_URL) return null;
  const action = payload?.action || 'unknown';
  try {
    const url = new URL(SHEETS_URL);
    url.searchParams.set('action', action);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    return await safeParseResponse(res, action);
  } catch (err) {
    console.error(`[Sheets POST] ❌ ${action}:`, err.message);
    return null;
  }
}

/**
 * GET from Google Apps Script with query params.
 */
async function sheetsGet(params) {
  const SHEETS_URL = getSheetsUrl();
  if (!SHEETS_URL) return null;
  const action = params?.action || 'unknown';
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${SHEETS_URL}?${qs}`, {
      cache: 'no-store',
      redirect: 'follow',
    });
    return await safeParseResponse(res, action);
  } catch (err) {
    console.error(`[Sheets GET] ❌ ${action}:`, err.message);
    return null;
  }
}

/**
 * Persist a single entity change to Google Sheets.
 * ALWAYS resolves (never throws) — safe for fire-and-forget calls.
 * Returns { ok: true } on success, { ok: false, error } on failure.
 * Callers that await it can check result.ok to know if Sheets was updated.
 */
async function persistEntity(action, payload) {
  const SHEETS_URL = getSheetsUrl();
  if (!SHEETS_URL) {
    console.warn(`[persistEntity] ⚠️  GOOGLE_SHEET_URL not set — ${action} skipped`);
    return { ok: false, error: 'GOOGLE_SHEET_URL not configured' };
  }
  console.log(`[persistEntity] → ${action}`, JSON.stringify(payload).slice(0, 150));
  try {
    const result = await sheetsPost({ action, ...payload });
    if (!result) {
      console.error(`[persistEntity] ← ${action} FAILED — no response (network/auth issue)`);
      return { ok: false, error: 'No response from Google Sheets' };
    }
    if (result.success === false) {
      console.error(`[persistEntity] ← ${action} FAILED — ${result.message || JSON.stringify(result)}`);
      return { ok: false, error: result.message || 'Sheets returned success:false' };
    }
    console.log(`[persistEntity] ← ${action} ✅ OK`);
    return { ok: true, data: result };
  } catch (err) {
    console.error(`[persistEntity] ← ${action} ERROR:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ── Startup: load entire DB from Google Sheets ───────────────

function safeParseArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    let str = val.trim();
    if (str.startsWith('"') && str.endsWith('"')) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === 'string') str = parsed.trim();
      } catch (_) {}
    }
    if (str.startsWith('[')) {
      try { return JSON.parse(str); } catch (_) { }
    }
  }
  return [];
}

function safeParseObject(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    let str = val.trim();
    if (str.startsWith('"') && str.endsWith('"')) {
      try {
        const parsed = JSON.parse(str);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        if (typeof parsed === 'string') str = parsed.trim();
      } catch (_) {}
    }
    if (str.startsWith('{')) {
      try { return JSON.parse(str); } catch (_) { }
    }
  }
  return null;
}

/**
 * Maps sheet data rows back into the in-memory format.
 */
function hydrateSheetsData(raw) {
  const db = makeInitialState();

  if (!raw || typeof raw !== 'object') return db;

  // ── employees ──
  if (Array.isArray(raw.employees) && raw.employees.length > 0) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
    const adminFromSheets = raw.employees.find(
      (e) => e.role === 'admin' || e.email === adminEmail
    );
    const sheetEmployees = raw.employees.map((e) => ({
      _id: e._id || generateId(),
      employeeId: e.employeeId || '',
      fullName: e.fullName || e.name || '',
      email: e.email || '',
      phone: e.phone || '',
      password: e.password || '',
      department: e.department || '',
      designation: e.designation || '',
      company: e.company || '',
      role: (e.role || 'employee').toLowerCase(),
      isActive: e.isActive !== 'false' && e.isActive !== false,
      isVerified: e.isVerified !== 'false' && e.isVerified !== false,
      assignedAssessments: safeParseArray(e.assignedAssessments),
      loginHistory: [],
      examStats: safeParseObject(e.examStats) || {
        totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0,
      },
      createdAt: e.createdAt || new Date().toISOString(),
      updatedAt: e.updatedAt || new Date().toISOString(),
    }));


    if (adminFromSheets) {
      db.employees = sheetEmployees;
    } else {
      db.employees = [db.employees[0], ...sheetEmployees.filter((e) => e.role !== 'admin')];
    }
  }

  // ── assessments ──
  if (Array.isArray(raw.assessments)) {
    db.assessments = raw.assessments.map((a) => ({
      _id: a._id || generateId(),
      title: a.title || '',
      description: a.description || '',
      duration: Number(a.duration) || 30,
      passingScore: Number(a.passingScore) || 60,
      category: a.category || 'General',
      status: a.status || 'draft',
      maxViolations: Number(a.maxViolations) || 3,
      isRandomized: a.isRandomized === 'true' || a.isRandomized === true,
      questions: safeParseArray(a.questions),
      assignedTo: safeParseArray(a.assignedTo),
      createdBy: a.createdBy || '',
      createdAt: a.createdAt || new Date().toISOString(),
      updatedAt: a.updatedAt || new Date().toISOString(),
    }));
  }

  // ── questions ──
  if (Array.isArray(raw.questions)) {
    db.questions = raw.questions.map((q) => {
      const options = [];
      if (q.option1 !== undefined) {
        [q.option1, q.option2, q.option3, q.option4].forEach((txt, idx) => {
          if (txt !== undefined && txt !== '') {
            options.push({
              text: txt,
              isCorrect: Number(q.correctOptionIndex) === idx ||
                String(q.correctAnswer) === idx.toString(),
            });
          }
        });
      } else if (q.options) {
        options.push(...safeParseArray(q.options));
      }
      return {
        _id: q._id || generateId(),
        title: q.title || q.question || '',
        type: q.type || 'mcq',
        options,
        marks: Number(q.marks) || 1,
        difficulty: q.difficulty || 'medium',
        explanation: q.explanation || '',
        createdBy: q.createdBy || '',
        assessment: q.assessmentId || q.assessment || '',
        createdAt: q.createdAt || new Date().toISOString(),
      };
    });
  }

  // ── results ──
  if (Array.isArray(raw.results)) {
    db.results = raw.results.map((r) => ({
      _id: r._id || generateId(),
      employee: r.employeeMongoId || r.employeeId || '',
      employeeName: r.employeeName || '',
      employeeEmail: r.employeeEmail || r.email || '',
      assessment: r.assessmentId || '',
      totalScore: Number(r.totalScore) || 0,
      totalMarks: Number(r.totalMarks) || 0,
      percentage: Number(r.percentage) || 0,
      passed: r.passed === 'true' || r.passed === true,
      status: r.status || 'submitted',
      violationCount: Number(r.violationCount) || 0,
      completionTime: Number(r.completionTime) || 0,
      startedAt: r.startedAt || '',
      submittedAt: r.submittedAt || '',
      autoSubmitReason: r.autoSubmitReason || null,
      correctAnswers: Number(r.correctAnswers) || 0,
      wrongAnswers: Number(r.wrongAnswers) || 0,
      answers: safeParseArray(r.answers),
      createdAt: r.createdAt || new Date().toISOString(),
    }));
  }

  // ── violations ──
  if (Array.isArray(raw.violations)) {
    db.violations = raw.violations.map((v) => ({
      _id: v._id || generateId(),
      employee: v.employeeMongoId || v.employeeId || '',
      assessment: v.assessmentId || '',
      result: v.resultId || '',
      type: v.type || '',
      description: v.description || '',
      severity: v.severity || 'medium',
      timestamp: v.timestamp || new Date().toISOString(),
    }));
  }

  // Fallback: associate questions to assessments if empty (resolves Google Sheet sync bug)
  db.assessments.forEach((a) => {
    if (!a.questions || a.questions.length === 0) {
      const qIds = db.questions
        .filter((q) => String(q.assessment) === String(a._id))
        .map((q) => q._id);
      if (qIds.length > 0) {
        a.questions = qIds;
      }
    }
  });

  return db;
}

// ── Query matcher ─────────────────────────────────────────────
// Handles: equality, $in, $gt, $lt, $gte, $lte, $ne, boolean matching, $or, $regex
function matchesQuery(item, query) {
  return Object.entries(query).every(([key, val]) => {
    if (key === '$or' && Array.isArray(val)) {
      return val.some(subQuery => matchesQuery(item, subQuery));
    }

    const itemVal = item[key];
    if (val === null || val === undefined) return itemVal == null;
    if (typeof val === 'boolean') return itemVal === val || String(itemVal) === String(val);

    if (val && typeof val === 'object') {
      if (val.$regex) {
        const regex = new RegExp(val.$regex, val.$options || 'i');
        return regex.test(String(itemVal || ''));
      }
      if (val.$in) return val.$in.some((v) => String(itemVal) === String(v));
      if (val.$nin) return !val.$nin.some((v) => String(itemVal) === String(v));
      if (val.$gt) return Number(itemVal) > Number(val.$gt);
      if (val.$gte) return Number(itemVal) >= Number(val.$gte);
      if (val.$lt) return Number(itemVal) < Number(val.$lt);
      if (val.$lte) return Number(itemVal) <= Number(val.$lte);
      if (val.$ne) return String(itemVal) !== String(val.$ne);
    }
    return String(itemVal) === String(val);
  });
}

// ── QueryChain ───────────────────────────────────────────────

class QueryChain {
  constructor(data) { this.data = data; }

  populate(field) {
    const db = readDB();
    const targetPath = field && typeof field === 'object' ? field.path : field;

    const resolve = (id, collection) => {
      if (!id) return null;
      const targetId = typeof id === 'object' ? (id._id || id.id || id) : id;
      const found = collection.find((x) => String(x._id) === String(targetId));
      if (!found) return null;
      return { ...found, toObject: () => ({ ...found }) };
    };

    const populateItem = (item) => {
      if (!item) return item;
      const plain =
        typeof item === 'object' && item !== null
          ? typeof item.toObject === 'function'
            ? item.toObject()
            : { ...item }
          : item;
      const result = { ...plain };

      if (targetPath === 'questions') {
        if (Array.isArray(result.questions)) {
          result.questions = result.questions.map(
            (qId) => resolve(qId, db.questions) || { _id: qId, toObject: () => ({ _id: qId }) }
          );
        }
      } else if (targetPath === 'assignedAssessments') {
        if (Array.isArray(result.assignedAssessments)) {
          result.assignedAssessments = result.assignedAssessments.map((aId) => {
            const asst = resolve(aId, db.assessments);
            return asst || { _id: aId, toObject: () => ({ _id: aId }) };
          });
        }
      } else if (['assessment', 'employee', 'createdBy'].includes(targetPath)) {
        const colMap = {
          assessment: db.assessments,
          employee: db.employees,
          createdBy: db.employees,
        };
        const col = colMap[targetPath];
        if (col && result[targetPath]) {
          const resolved = resolve(result[targetPath], col);
          if (resolved && targetPath === 'assessment' && Array.isArray(resolved.questions)) {
            // Automatically populate nested questions for assessment to support nested populate controller queries
            resolved.questions = resolved.questions.map(
              (qId) => resolve(qId, db.questions) || { _id: qId, toObject: () => ({ _id: qId }) }
            );
          }
          result[targetPath] = resolved || result[targetPath];
        }
      }

      result.toObject = () => {
        const copy = { ...result };
        delete copy.toObject;
        return copy;
      };
      return result;
    };

    if (this.data === null || this.data === undefined) return new QueryChain(null);

    const populated = Array.isArray(this.data)
      ? this.data.map(populateItem)
      : populateItem(this.data);

    return new QueryChain(populated);
  }

  select() { return this; }
  sort(spec) {
    if (!Array.isArray(this.data) || !spec) return this;
    const entries = Object.entries(spec);
    const sorted = [...this.data].sort((a, b) => {
      for (const [key, dir] of entries) {
        const aVal = a[key] ?? '';
        const bVal = b[key] ?? '';
        if (aVal < bVal) return dir === -1 ? 1 : -1;
        if (aVal > bVal) return dir === -1 ? -1 : 1;
      }
      return 0;
    });
    return new QueryChain(sorted);
  }
  slice() { return this; }
  limit(n) {
    if (!Array.isArray(this.data)) return this;
    return new QueryChain(this.data.slice(0, n));
  }
  skip(n) {
    if (!Array.isArray(this.data)) return this;
    return new QueryChain(this.data.slice(n));
  }

  then(onResolve) {
    return Promise.resolve(onResolve ? onResolve(this.data) : this.data);
  }
  catch() {
    return Promise.resolve(this.data);
  }
}

// ── MockModel ────────────────────────────────────────────────

class MockModel {
  constructor(data = {}) {
    Object.assign(this, data);
    if (!this._id) this._id = generateId();
    if (!this.assignedAssessments) this.assignedAssessments = [];
    if (!this.loginHistory) this.loginHistory = [];
    if (!this.questions) this.questions = [];
    if (!this.options) this.options = [];
    if (!this.assignedTo) this.assignedTo = [];
    if (!this.violations) this.violations = [];
    if (!this.examStats) {
      this.examStats = { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 };
    }
  }

  static getCollection(name) {
    const db = readDB();
    const colName = name.toLowerCase() + 's';
    if (!db[colName]) { db[colName] = []; writeDB(db); }
    return db[colName];
  }

  static saveCollection(name, items) {
    const db = readDB();
    const colName = name.toLowerCase() + 's';
    db[colName] = items;
    writeDB(db);
  }

  toObject() {
    const copy = { ...this };
    delete copy.toObject;
    return copy;
  }

  async save() {
    const colName = this.constructor.name;
    const col = MockModel.getCollection(colName);
    const idx = col.findIndex((x) => x._id.toString() === this._id.toString());

    if (!this.createdAt) this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();

    const plain = {};
    for (const key of Object.keys(this)) {
      if (key !== 'toObject') plain[key] = this[key];
    }

    if (idx !== -1) col[idx] = plain;
    else col.push(plain);

    MockModel.saveCollection(colName, col);
    return this;
  }

  static find(query = {}) {
    let list = MockModel.getCollection(this.name);
    if (query && Object.keys(query).length > 0) {
      list = list.filter((item) => matchesQuery(item, query));
    }
    return new QueryChain(list.map((x) => new this(x)));
  }

  static findOne(query = {}) {
    const list = MockModel.getCollection(this.name);
    const found = list.find((item) => matchesQuery(item, query));
    return new QueryChain(found ? new this(found) : null);
  }

  static findById(id) {
    if (!id) return new QueryChain(null);
    const list = MockModel.getCollection(this.name);
    const found = list.find((item) => item._id.toString() === id.toString());
    return new QueryChain(found ? new this(found) : null);
  }

  static async create(data) {
    const instance = new this(data);
    await instance.save();
    return instance;
  }

  static async insertMany(docs) {
    const instances = [];
    for (const data of docs) {
      const inst = new this(data);
      await inst.save();
      instances.push(inst);
    }
    return instances;
  }

  static async findByIdAndUpdate(id, update, options = {}) {
    const list = MockModel.getCollection(this.name);
    const idx = list.findIndex((item) => item._id.toString() === id.toString());
    if (idx === -1) return null;

    let item = { ...list[idx] };
    const hasOps = update.$set || update.$push || update.$addToSet || update.$pull || update.$inc;

    if (hasOps) {
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) item[k] = v;
      }
      if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) {
          if (!item[k]) item[k] = [];
          if (v && v.$each) item[k].push(...v.$each);
          else item[k].push(v);
        }
      }
      if (update.$addToSet) {
        for (const [k, v] of Object.entries(update.$addToSet)) {
          if (!item[k]) item[k] = [];
          if (!item[k].map(String).includes(String(v))) item[k].push(v);
        }
      }
      if (update.$pull) {
        for (const [k, v] of Object.entries(update.$pull)) {
          if (item[k]) item[k] = item[k].filter((x) => String(x) !== String(v));
        }
      }
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) item[k] = (item[k] || 0) + v;
      }
    } else {
      item = { ...item, ...update };
    }

    item.updatedAt = new Date().toISOString();
    list[idx] = item;
    MockModel.saveCollection(this.name, list);
    return new this(item);
  }

  static async findByIdAndDelete(id) {
    const list = MockModel.getCollection(this.name);
    const idx = list.findIndex((item) => item._id.toString() === id.toString());
    if (idx === -1) return null;
    const deleted = list.splice(idx, 1)[0];
    MockModel.saveCollection(this.name, list);
    return new this(deleted);
  }

  static async updateMany(query, update) {
    const list = MockModel.getCollection(this.name);
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      if (Object.keys(query).length > 0 && !matchesQuery(list[i], query)) continue;
      if (update.$addToSet) {
        for (const [k, v] of Object.entries(update.$addToSet)) {
          if (!list[i][k]) list[i][k] = [];
          if (!list[i][k].map(String).includes(String(v))) list[i][k].push(v);
        }
      }
      if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) {
          if (!list[i][k]) list[i][k] = [];
          if (v.$each) list[i][k].push(...v.$each);
          else list[i][k].push(v);
        }
      }
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) list[i][k] = v;
      }
      count++;
    }
    MockModel.saveCollection(this.name, list);
    return { modifiedCount: count };
  }

  static async deleteMany(query) {
    if (!query || Object.keys(query).length === 0) {
      MockModel.saveCollection(this.name, []);
      return { deletedCount: 0 };
    }
    const list = MockModel.getCollection(this.name);
    const filtered = list.filter((item) => !matchesQuery(item, query));
    const count = list.length - filtered.length;
    MockModel.saveCollection(this.name, filtered);
    return { deletedCount: count };
  }

  static async countDocuments(query = {}) {
    const list = MockModel.getCollection(this.name);
    if (!query || Object.keys(query).length === 0) return list.length;
    return list.filter((item) => matchesQuery(item, query)).length;
  }

  /**
   * Real aggregate implementation for dashboard analytics.
   * Supports: $group with $avg/$sum/$first, $lookup, $unwind, $sort, $match.
   */
  static async aggregate(pipeline = []) {
    const db = readDB();
    const colName = this.name.toLowerCase() + 's';
    let data = [...(db[colName] || [])];

    for (const stage of pipeline) {
      if (stage.$match) {
        data = data.filter((item) => matchesQuery(item, stage.$match));
      } else if (stage.$sort) {
        const entries = Object.entries(stage.$sort);
        data = data.sort((a, b) => {
          for (const [key, dir] of entries) {
            if ((a[key] ?? '') < (b[key] ?? '')) return dir === -1 ? 1 : -1;
            if ((a[key] ?? '') > (b[key] ?? '')) return dir === -1 ? -1 : 1;
          }
          return 0;
        });
      } else if (stage.$limit) {
        data = data.slice(0, stage.$limit);
      } else if (stage.$skip) {
        data = data.slice(stage.$skip);
      } else if (stage.$lookup) {
        const { from, localField, foreignField, as } = stage.$lookup;
        const refCol = db[from] || db[from + 's'] || [];
        data = data.map((item) => {
          const matches = refCol.filter(
            (ref) => String(ref[foreignField]) === String(item[localField])
          );
          return { ...item, [as]: matches };
        });
      } else if (stage.$unwind) {
        const path = typeof stage.$unwind === 'string'
          ? stage.$unwind.replace('$', '')
          : stage.$unwind.path?.replace('$', '');
        const preserveNull = stage.$unwind?.preserveNullAndEmptyArrays;
        const next = [];
        for (const item of data) {
          const arr = item[path];
          if (!Array.isArray(arr) || arr.length === 0) {
            if (preserveNull) next.push({ ...item, [path]: undefined });
          } else {
            for (const el of arr) next.push({ ...item, [path]: el });
          }
        }
        data = next;
      } else if (stage.$group) {
        const { _id: idExpr, ...accumulators } = stage.$group;
        const groups = new Map();

        for (const item of data) {
          // Resolve group key
          let key;
          if (idExpr === null) {
            key = '__all__';
          } else if (typeof idExpr === 'string' && idExpr.startsWith('$')) {
            const field = idExpr.slice(1);
            key = field.includes('.')
              ? field.split('.').reduce((obj, k) => obj?.[k], item)
              : item[field];
          } else {
            key = idExpr;
          }

          const keyStr = JSON.stringify(key);
          if (!groups.has(keyStr)) {
            groups.set(keyStr, { _id: key, _items: [] });
          }
          groups.get(keyStr)._items.push(item);
        }

        data = Array.from(groups.values()).map(({ _id, _items }) => {
          const row = { _id };
          for (const [outField, expr] of Object.entries(accumulators)) {
            if (expr.$sum !== undefined) {
              const src = typeof expr.$sum === 'number'
                ? () => expr.$sum
                : (it) => {
                  const f = String(expr.$sum).replace('$', '');
                  return Number(it[f]) || 0;
                };
              row[outField] = _items.reduce((s, it) => s + src(it), 0);
            } else if (expr.$avg !== undefined) {
              const f = String(expr.$avg).replace('$', '');
              const vals = _items.map((it) => Number(it[f])).filter((v) => !isNaN(v));
              row[outField] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
            } else if (expr.$first !== undefined) {
              const f = String(expr.$first).replace('$', '');
              row[outField] = _items[0]?.[f];
            } else if (expr.$last !== undefined) {
              const f = String(expr.$last).replace('$', '');
              row[outField] = _items[_items.length - 1]?.[f];
            } else if (expr.$min !== undefined) {
              const f = String(expr.$min).replace('$', '');
              row[outField] = Math.min(..._items.map((it) => Number(it[f])));
            } else if (expr.$max !== undefined) {
              const f = String(expr.$max).replace('$', '');
              row[outField] = Math.max(..._items.map((it) => Number(it[f])));
            } else if (expr.$push !== undefined) {
              const f = String(expr.$push).replace('$', '');
              row[outField] = _items.map((it) => it[f]);
            }
          }
          return row;
        });
      }
    }

    return data;
  }
}

// ── Password helpers ─────────────────────────────────────────
MockModel.comparePassword = async function (pwd) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123';
  if (this.email && this.email.toLowerCase() === adminEmail.toLowerCase() &&
    (pwd === adminPassword || pwd.toLowerCase() === adminPassword.toLowerCase())) {
    return true;
  }
  try {
    const bcrypt = require('bcryptjs');
    if (this.password && this.password.startsWith('$2')) {
      return await bcrypt.compare(pwd, this.password);
    }
  } catch (_) { }
  return pwd === this.password;
};

MockModel.prototype.comparePassword = async function (pwd) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123';
  if (this.email && this.email.toLowerCase() === adminEmail.toLowerCase() &&
    (pwd === adminPassword || pwd.toLowerCase() === adminPassword.toLowerCase())) {
    return true;
  }
  try {
    const bcrypt = require('bcryptjs');
    if (this.password && this.password.startsWith('$2')) {
      return await bcrypt.compare(pwd, this.password);
    }
  } catch (_) { }
  return pwd === this.password;
};

// ── Schema mock ──────────────────────────────────────────────

const SchemaMock = function () {
  return { pre() { }, methods: {}, index() { } };
};
SchemaMock.Types = { ObjectId: String, Mixed: Object };

// ── mongoose mock (the exported object) ─────────────────────

const mongooseMock = {
  Schema: SchemaMock,

  model(name) {
    const CustomModel = class extends MockModel { };
    Object.defineProperty(CustomModel, 'name', { value: name });
    return CustomModel;
  },

  /**
   * Called once at server startup.
   * Fetches the full DB from Google Sheets and hydrates IN_MEMORY_DB.
   */
  async connect() {
    console.log('⚡ Initialising in-memory DB with Google Sheets sync...');
    const SHEETS_URL = getSheetsUrl();

    if (!SHEETS_URL) {
      console.warn('⚠️  GOOGLE_SHEET_URL not set — running in memory-only mode.');
      console.log('⚡ In-memory DB ready (no persistence to Google Sheets).');
      // Ensure DB is initialized
      readDB();
      return true;
    }

    try {
      console.log('📥 Loading database from Google Sheets...');
      const res = await fetch(`${SHEETS_URL}?action=getDatabase`, { cache: 'no-store' });
      const json = await res.json();

      if (json && json.success && json.data) {
        IN_MEMORY_DB = hydrateSheetsData(json.data);

        // Dedup employees by email — prevents ghost 5th employee when admin
        // appears in both the seed state AND in the Google Sheet
        const seen = new Map();
        IN_MEMORY_DB.employees.forEach(e => {
          const key = (e.email || '').toLowerCase().trim();
          if (key) seen.set(key, e);
        });
        IN_MEMORY_DB.employees = Array.from(seen.values());

        const counts = Object.entries(IN_MEMORY_DB)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : 0}`)
          .join(', ');
        console.log(`✅ Google Sheets DB loaded — ${counts}`);

      } else {
        console.warn('⚠️  Google Sheets returned no data. Using initial state.');
        console.warn('    Response:', JSON.stringify(json).substring(0, 300));
        readDB(); // ensure initialized
      }
    } catch (err) {
      console.error('❌ Failed to load from Google Sheets:', err.message);
      console.warn('   Continuing with initial in-memory state.');
      readDB(); // ensure initialized
    }

    console.log('⚡ In-memory DB ready.');
    return true;
  },

  async disconnect() {
    console.log('⚡ DB disconnecting.');
    return true;
  },
};

module.exports = mongooseMock;
module.exports.persistEntity = persistEntity;
module.exports.sheetsPost = sheetsPost;
module.exports.sheetsGet = sheetsGet;
module.exports.readDB = readDB;
module.exports.writeDB = writeDB;
