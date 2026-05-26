// ============================================================
// localCache.js — Mongoose-compatible in-memory DB
// Backed by Google Apps Script / Google Sheets for persistence
// ============================================================
'use strict';

const SHEETS_URL = process.env.GOOGLE_SHEET_URL || '';

// ── Unique ID generator ──────────────────────────────────────
function generateId() {
  return Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

// ── Initial clean state ──────────────────────────────────────
const adminId = generateId();

const INITIAL_STATE = {
  employees: [
    {
      _id: adminId,
      fullName: 'System Admin',
      email: process.env.ADMIN_EMAIL || 'admin@gmail.com',
      password: process.env.ADMIN_PASSWORD || 'Admin123',
      role: 'admin',
      isActive: true,
      isVerified: true,
      assignedAssessments: [],
      loginHistory: [],
      examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 },
    },
  ],
  questions:    [],
  assessments:  [],
  results:      [],
  violations:   [],
  auditlogs:    [],
};

let IN_MEMORY_DB = JSON.parse(JSON.stringify(INITIAL_STATE));

// ── DB accessors ─────────────────────────────────────────────
function readDB()       { return IN_MEMORY_DB; }
function writeDB(data)  { IN_MEMORY_DB = data; }

// ── Google Sheets helpers ─────────────────────────────────────

/**
 * POST a payload to Google Apps Script.
 * Returns the parsed JSON response, or null on failure.
 */
async function sheetsPost(payload) {
  if (!SHEETS_URL) return null;
  try {
    const url = new URL(SHEETS_URL);
    if (payload && payload.action) {
      url.searchParams.set('action', payload.action);
    }
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    console.error('[Sheets POST error]', payload ? payload.action : 'unknown', err.message);
    return null;
  }
}

/**
 * GET from Google Apps Script with query params.
 */
async function sheetsGet(params) {
  if (!SHEETS_URL) return null;
  try {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(`${SHEETS_URL}?${qs}`, { cache: 'no-store' });
    return await res.json();
  } catch (err) {
    console.error('[Sheets GET error]', params.action, err.message);
    return null;
  }
}

/**
 * Persist a single entity change to Google Sheets without blocking the
 * request.  Failures are logged but never crash the server.
 *
 * Usage:
 *   persistEntity('createEmployee', { _id, fullName, email, ... })
 *   persistEntity('addQuestion',    { _id, assessmentId, title, ... })
 */
function persistEntity(action, payload) {
  if (!SHEETS_URL) return;
  sheetsPost({ action, ...payload }).catch((err) =>
    console.error('[persistEntity]', action, err.message)
  );
}

// ── Startup: load entire DB from Google Sheets ───────────────

/**
 * Maps sheet data rows (plain objects with string values) back into
 * the in-memory format expected by the MockModel layer.
 */
function hydrateSheetsData(raw) {
  const db = JSON.parse(JSON.stringify(INITIAL_STATE));

  if (!raw || typeof raw !== 'object') return db;

  // ── employees ──
  if (Array.isArray(raw.employees)) {
    const adminFromSheets = raw.employees.find(
      (e) => e.role === 'admin' || e.email === (process.env.ADMIN_EMAIL || 'admin@gmail.com')
    );
    const sheetEmployees = raw.employees.map((e) => ({
      _id:                  e._id || generateId(),
      employeeId:           e.employeeId || '',
      fullName:             e.fullName || e.name || '',
      email:                e.email || '',
      phone:                e.phone || '',
      password:             e.password || '',
      department:           e.department || '',
      designation:          e.designation || '',
      company:              e.company || '',
      role:                 (e.role || 'employee').toLowerCase(),
      isActive:             e.isActive !== 'false' && e.isActive !== false,
      isVerified:           true,
      assignedAssessments:  safeParseArray(e.assignedAssessments),
      loginHistory:         safeParseArray(e.loginHistory),
      examStats:            safeParseObject(e.examStats) || {
        totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0,
      },
      createdAt:            e.createdAt || new Date().toISOString(),
      updatedAt:            e.updatedAt || new Date().toISOString(),
    }));

    // Replace built-in admin only if sheets already has an admin record
    if (adminFromSheets) {
      db.employees = sheetEmployees;
    } else {
      // Keep seeded admin, add sheet employees
      db.employees = [db.employees[0], ...sheetEmployees.filter((e) => e.role !== 'admin')];
    }
  }

  // ── assessments ──
  if (Array.isArray(raw.assessments)) {
    db.assessments = raw.assessments.map((a) => ({
      _id:          a._id || generateId(),
      title:        a.title || '',
      description:  a.description || '',
      duration:     Number(a.duration) || 30,
      passingScore: Number(a.passingScore) || 60,
      category:     a.category || 'General',
      status:       a.status || 'draft',
      maxViolations:Number(a.maxViolations) || 3,
      isRandomized: a.isRandomized === 'true' || a.isRandomized === true,
      questions:    safeParseArray(a.questions),
      assignedTo:   safeParseArray(a.assignedTo),
      createdBy:    a.createdBy || '',
      createdAt:    a.createdAt || new Date().toISOString(),
      updatedAt:    a.updatedAt || new Date().toISOString(),
    }));
  }

  // ── questions ──
  if (Array.isArray(raw.questions)) {
    db.questions = raw.questions.map((q) => {
      // Reconstruct options array from flat columns
      const options = [];
      if (q.option1 !== undefined) {
        [q.option1, q.option2, q.option3, q.option4].forEach((txt, idx) => {
          if (txt !== undefined && txt !== '') {
            options.push({
              text:      txt,
              isCorrect: Number(q.correctOptionIndex) === idx ||
                         String(q.correctAnswer) === idx.toString(),
            });
          }
        });
      } else if (q.options) {
        options.push(...safeParseArray(q.options));
      }
      return {
        _id:        q._id || generateId(),
        title:      q.title || q.question || '',
        type:       q.type || 'mcq',
        options,
        marks:      Number(q.marks) || 1,
        difficulty: q.difficulty || 'medium',
        explanation:q.explanation || '',
        createdBy:  q.createdBy || '',
        assessment: q.assessmentId || q.assessment || '',
        createdAt:  q.createdAt || new Date().toISOString(),
      };
    });
  }

  // ── results ──
  if (Array.isArray(raw.results)) {
    db.results = raw.results.map((r) => ({
      _id:            r._id || generateId(),
      employee:       r.employeeMongoId || r.employeeId || '',
      employeeName:   r.employeeName || '',
      employeeEmail:  r.employeeEmail || r.email || '',
      assessment:     r.assessmentId || '',
      totalScore:     Number(r.totalScore)    || 0,
      totalMarks:     Number(r.totalMarks)    || 0,
      percentage:     Number(r.percentage)    || 0,
      passed:         r.passed === 'true'     || r.passed === true,
      status:         r.status               || 'submitted',
      violationCount: Number(r.violationCount)|| 0,
      completionTime: Number(r.completionTime)|| 0,
      startedAt:      r.startedAt            || '',
      submittedAt:    r.submittedAt          || '',
      autoSubmitReason:r.autoSubmitReason    || null,
      answers:        safeParseArray(r.answers),
      createdAt:      r.createdAt            || new Date().toISOString(),
    }));
  }

  // ── violations ──
  if (Array.isArray(raw.violations)) {
    db.violations = raw.violations.map((v) => ({
      _id:        v._id || generateId(),
      employee:   v.employeeMongoId || v.employeeId || '',
      assessment: v.assessmentId || '',
      result:     v.resultId || '',
      type:       v.type || '',
      description:v.description || '',
      severity:   v.severity || 'medium',
      timestamp:  v.timestamp || new Date().toISOString(),
    }));
  }

  return db;
}

function safeParseArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim().startsWith('[')) {
    try { return JSON.parse(val); } catch (_) {}
  }
  return [];
}

function safeParseObject(val) {
  if (val && typeof val === 'object') return val;
  if (typeof val === 'string' && val.trim().startsWith('{')) {
    try { return JSON.parse(val); } catch (_) {}
  }
  return null;
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
          employee:   db.employees,
          createdBy:  db.employees,
        };
        const col = colMap[targetPath];
        if (col && result[targetPath]) {
          result[targetPath] = resolve(result[targetPath], col) || result[targetPath];
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
  sort()   { return this; }
  slice()  { return this; }

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
    if (!this.loginHistory)        this.loginHistory        = [];
    if (!this.questions)           this.questions           = [];
    if (!this.options)             this.options             = [];
    if (!this.assignedTo)          this.assignedTo          = [];
    if (!this.violations)          this.violations          = [];
    if (!this.examStats) {
      this.examStats = { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 };
    }
  }

  static _colName() {
    return this.name.toLowerCase() + 's';
  }

  static getCollection(name) {
    const db     = readDB();
    const colName = name.toLowerCase() + 's';
    if (!db[colName]) { db[colName] = []; writeDB(db); }
    return db[colName];
  }

  static saveCollection(name, items) {
    const db      = readDB();
    const colName = name.toLowerCase() + 's';
    db[colName]   = items;
    writeDB(db);
  }

  async save() {
    const colName = this.constructor.name;
    const col     = MockModel.getCollection(colName);
    const idx     = col.findIndex((x) => x._id.toString() === this._id.toString());

    if (!this.createdAt) this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();

    const plain = {};
    for (const key of Object.keys(this)) plain[key] = this[key];

    if (idx !== -1) col[idx] = plain;
    else            col.push(plain);

    MockModel.saveCollection(colName, col);
    return this;
  }

  static find(query = {}) {
    let list = MockModel.getCollection(this.name);
    if (query && Object.keys(query).length > 0) {
      list = list.filter((item) =>
        Object.entries(query).every(([key, val]) => {
          if (val && typeof val === 'object') {
            if (val.$in) return val.$in.map(String).includes(String(item[key]));
          }
          return String(item[key]) === String(val);
        })
      );
    }
    return new QueryChain(list.map((x) => new this(x)));
  }

  static findOne(query = {}) {
    const list  = MockModel.getCollection(this.name);
    const found = list.find((item) =>
      Object.entries(query).every(([key, val]) => String(item[key]) === String(val))
    );
    return new QueryChain(found ? new this(found) : null);
  }

  static findById(id) {
    if (!id) return new QueryChain(null);
    const list  = MockModel.getCollection(this.name);
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
    const idx  = list.findIndex((item) => item._id.toString() === id.toString());
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

    list[idx] = item;
    MockModel.saveCollection(this.name, list);
    return new this(item);
  }

  static async findByIdAndDelete(id) {
    const list = MockModel.getCollection(this.name);
    const idx  = list.findIndex((item) => item._id.toString() === id.toString());
    if (idx === -1) return null;
    const deleted = list.splice(idx, 1)[0];
    MockModel.saveCollection(this.name, list);
    return new this(deleted);
  }

  static async updateMany(query, update) {
    const list = MockModel.getCollection(this.name);
    let count  = 0;
    for (let i = 0; i < list.length; i++) {
      let match = true;
      if (query._id && query._id.$in) {
        match = query._id.$in.map(String).includes(list[i]._id.toString());
      }
      if (!match) continue;
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
    const list     = MockModel.getCollection(this.name);
    const filtered = list.filter(
      (item) => !Object.entries(query).every(([k, v]) => String(item[k]) === String(v))
    );
    const count = list.length - filtered.length;
    MockModel.saveCollection(this.name, filtered);
    return { deletedCount: count };
  }

  static async countDocuments(query = {}) {
    const list = MockModel.getCollection(this.name);
    if (!query || Object.keys(query).length === 0) return list.length;
    return list.filter((item) =>
      Object.entries(query).every(([k, v]) => {
        if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(item[k]));
        return String(item[k]) === String(v);
      })
    ).length;
  }

  static async aggregate() {
    return [];
  }
}

// Password helpers
MockModel.comparePassword = async function (pwd) {
  if (this.email === 'admin@gmail.com' && pwd.toLowerCase() === 'admin123') {
    return true;
  }
  try {
    const bcrypt = require('bcryptjs');
    if (this.password && this.password.startsWith('$2')) {
      return await bcrypt.compare(pwd, this.password);
    }
  } catch (_) {}
  return pwd === this.password;
};
MockModel.prototype.comparePassword = async function (pwd) {
  if (this.email === 'admin@gmail.com' && pwd.toLowerCase() === 'admin123') {
    return true;
  }
  try {
    const bcrypt = require('bcryptjs');
    if (this.password && this.password.startsWith('$2')) {
      return await bcrypt.compare(pwd, this.password);
    }
  } catch (_) {}
  return pwd === this.password;
};

// ── Schema mock ──────────────────────────────────────────────

const SchemaMock = function () {
  return { pre() {}, methods: {}, index() {} };
};
SchemaMock.Types = { ObjectId: String, Mixed: Object };

// ── mongoose mock (the exported object) ─────────────────────

const mongooseMock = {
  Schema: SchemaMock,

  model(name) {
    const CustomModel = class extends MockModel {};
    Object.defineProperty(CustomModel, 'name', { value: name });
    return CustomModel;
  },

  /**
   * Called once at server startup.
   * Fetches the full DB from Google Sheets and hydrates IN_MEMORY_DB.
   */
  async connect() {
    console.log('⚡ Initialising in-memory DB with Google Sheets sync...');

    if (!SHEETS_URL) {
      console.warn('⚠️  GOOGLE_SHEET_URL not set — running in temporary memory-only mode.');
      console.log('⚡ In-memory DB ready (no persistence).');
      return true;
    }

    try {
      console.log('📥 Loading database from Google Sheets...');
      const res  = await fetch(`${SHEETS_URL}?action=getDatabase`, { cache: 'no-store' });
      const json = await res.json();

      if (json && json.success && json.data) {
        IN_MEMORY_DB = hydrateSheetsData(json.data);
        const counts = Object.entries(IN_MEMORY_DB)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : 0}`)
          .join(', ');
        console.log(`✅ Google Sheets DB loaded — ${counts}`);
      } else {
        console.warn('⚠️  Google Sheets returned no data. Using initial state.');
        console.warn('    Response:', JSON.stringify(json).substring(0, 200));
      }
    } catch (err) {
      console.error('❌ Failed to load from Google Sheets:', err.message);
      console.warn('   Continuing with initial in-memory state.');
    }

    console.log('⚡ In-memory DB ready.');
    return true;
  },

  async disconnect() {
    console.log('⚡ DB disconnecting (no flush needed — ops are persisted in real-time).');
    return true;
  },
};

// ── Exports ──────────────────────────────────────────────────

module.exports              = mongooseMock;
module.exports.persistEntity = persistEntity;
module.exports.sheetsPost   = sheetsPost;
module.exports.sheetsGet    = sheetsGet;
