const SHEETS = {
  REQUESTS: 'requests',
  RESPONSES: 'responses',
  EXTENSIONS: 'deadline_extensions',
  COMPLETIONS: 'completions',
};

const REQUEST_STATUS = {
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CONDITIONAL: 'conditional',
  EXTENSION_PENDING: 'extension_pending',
  COMPLETION_REPORTED: 'completion_reported',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

function doGet() {
  return jsonOutput_({ ok: true, message: 'Talknote Request Management API is running.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    if (!action) return jsonOutput_({ ok: false, error: 'action is required' });

    initializeSheets_();

    let data;
    switch (action) {
      case 'create_request': data = createRequest_(body); break;
      case 'respond_request': data = respondRequest_(body); break;
      case 'request_deadline_extension': data = requestDeadlineExtension_(body); break;
      case 'respond_deadline_extension': data = respondDeadlineExtension_(body); break;
      case 'report_completion': data = reportCompletion_(body); break;
      case 'close_request': data = closeRequest_(body); break;
      case 'cancel_request': data = cancelRequest_(body); break;
      case 'admin_delete_request': data = adminDeleteRequest_(body); break;
      case 'list_requests': data = listRequests_(body); break;
      case 'get_kpi': data = getKpi_(body); break;
      case 'list_talknote_groups': data = listTalknoteGroups_(); break;
      default:
        return jsonOutput_({ ok: false, error: `unsupported action: ${action}` });
    }

    return jsonOutput_({ ok: true, data });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message, stack: err.stack });
  }
}

function createRequest_(body) {
  required_(body, ['requester_user_id', 'assignee_user_id', 'title', 'description', 'due_at', 'reason', 'talknote_group_id']);
  const requestId = generateId_('REQ');
  const now = nowIso_();
  const requester = getMemberByUserId_(body.requester_user_id);
  const assignee = getMemberByUserId_(body.assignee_user_id);

  appendRow_(SHEETS.REQUESTS, [
    requestId, body.requester_user_id, requester.name, requester.department,
    body.assignee_user_id, assignee.name, assignee.department,
    body.title, body.description, body.reason, body.due_at,
    REQUEST_STATUS.REQUESTED,
    body.talknote_group_id,
    now, now,
    '', '',
    '', '',
    '0', '', '',
  ]);

  postToRequestGroup_(body.talknote_group_id, [
    `【リクエスト作成】${body.title}`,
    `request_id: ${requestId}`,
    `依頼者: ${requester.name} (${body.requester_user_id})`,
    `担当者: ${assignee.name} (${body.assignee_user_id})`,
    `期日: ${body.due_at}`,
    `内容: ${body.description}`,
    `理由: ${body.reason}`,
  ].join('\n'));

  return { request_id: requestId, status: REQUEST_STATUS.REQUESTED };
}

function respondRequest_(body) {
  required_(body, ['request_id', 'responder_user_id', 'response_type', 'message']);
  const req = findRequest_(body.request_id);
  assertAssignee_(req, body.responder_user_id);

  const allowed = ['yes', 'no', 'conditional_yes'];
  if (allowed.indexOf(body.response_type) === -1) throw new Error('response_type must be yes/no/conditional_yes');

  appendRow_(SHEETS.RESPONSES, [
    generateId_('RSP'), body.request_id, body.responder_user_id,
    body.response_type, body.message, nowIso_(),
  ]);

  const nextStatus = body.response_type === 'yes'
    ? REQUEST_STATUS.ACCEPTED
    : (body.response_type === 'no' ? REQUEST_STATUS.DECLINED : REQUEST_STATUS.CONDITIONAL);
  updateRequest_(body.request_id, { status: nextStatus });

  postToRequestGroup_(req.talknote_group_id, [
    `【リクエスト回答】${body.request_id}`,
    `回答者: ${body.responder_user_id}`,
    `回答: ${body.response_type}`,
    `内容: ${body.message}`,
  ].join('\n'));

  return { request_id: body.request_id, status: nextStatus };
}

function requestDeadlineExtension_(body) {
  required_(body, ['request_id', 'applicant_user_id', 'proposed_due_at', 'reason']);
  const req = findRequest_(body.request_id);
  assertAssignee_(req, body.applicant_user_id);

  const extensionId = generateId_('EXT');
  appendRow_(SHEETS.EXTENSIONS, [
    extensionId, body.request_id, body.applicant_user_id,
    req.due_at, body.proposed_due_at, body.reason,
    'pending', '', '', nowIso_(), '',
  ]);

  updateRequest_(body.request_id, { status: REQUEST_STATUS.EXTENSION_PENDING });

  postToRequestGroup_(req.talknote_group_id, [
    `【期日変更申請】${body.request_id}`,
    `extension_id: ${extensionId}`,
    `申請者: ${body.applicant_user_id}`,
    `現行期日: ${req.due_at}`,
    `申請期日: ${body.proposed_due_at}`,
    `理由: ${body.reason}`,
  ].join('\n'));

  return { extension_id: extensionId, status: 'pending' };
}

function respondDeadlineExtension_(body) {
  required_(body, ['extension_id', 'request_id', 'approver_user_id', 'approved']);
  const req = findRequest_(body.request_id);
  assertRequester_(req, body.approver_user_id);

  const status = body.approved ? 'approved' : 'rejected';
  updateExtension_(body.extension_id, {
    status,
    approver_user_id: body.approver_user_id,
    approver_message: body.message || '',
    responded_at: nowIso_(),
  });

  if (body.approved) {
    const ext = findExtension_(body.extension_id);
    updateRequest_(body.request_id, { due_at: ext.proposed_due_at, status: REQUEST_STATUS.ACCEPTED });
  } else {
    updateRequest_(body.request_id, { status: REQUEST_STATUS.ACCEPTED });
  }

  postToRequestGroup_(req.talknote_group_id, [
    `【期日変更回答】${body.request_id}`,
    `extension_id: ${body.extension_id}`,
    `回答者: ${body.approver_user_id}`,
    `結果: ${status}`,
    `メッセージ: ${body.message || ''}`,
  ].join('\n'));

  return { extension_id: body.extension_id, status };
}

function reportCompletion_(body) {
  required_(body, ['request_id', 'reporter_user_id', 'message']);
  const req = findRequest_(body.request_id);
  assertAssignee_(req, body.reporter_user_id);

  appendRow_(SHEETS.COMPLETIONS, [
    generateId_('CMP'), body.request_id, body.reporter_user_id,
    body.message, JSON.stringify(body.artifact_urls || []), nowIso_(),
  ]);

  updateRequest_(body.request_id, { status: REQUEST_STATUS.COMPLETION_REPORTED });

  postToRequestGroup_(req.talknote_group_id, [
    `【完了報告】${body.request_id}`,
    `報告者: ${body.reporter_user_id}`,
    `内容: ${body.message}`,
    `成果物: ${(body.artifact_urls || []).join(', ') || '(なし)'}`,
  ].join('\n'));

  return { request_id: body.request_id, status: REQUEST_STATUS.COMPLETION_REPORTED };
}

function closeRequest_(body) {
  required_(body, ['request_id', 'closer_user_id']);
  const req = findRequest_(body.request_id);
  assertRequester_(req, body.closer_user_id);

  updateRequest_(body.request_id, {
    status: REQUEST_STATUS.COMPLETED,
    closed_at: nowIso_(),
    closed_by: body.closer_user_id,
  });

  postToRequestGroup_(req.talknote_group_id, [
    `【リクエスト完了】${body.request_id}`,
    `完了確定者: ${body.closer_user_id}`,
  ].join('\n'));

  return { request_id: body.request_id, status: REQUEST_STATUS.COMPLETED };
}

function cancelRequest_(body) {
  required_(body, ['request_id', 'requester_user_id', 'reason']);
  const req = findRequest_(body.request_id);
  assertRequester_(req, body.requester_user_id);

  updateRequest_(body.request_id, {
    status: REQUEST_STATUS.CANCELLED,
    cancelled_at: nowIso_(),
    cancelled_by: body.requester_user_id,
  });

  postToRequestGroup_(req.talknote_group_id, [
    `【リクエスト取り下げ】${body.request_id}`,
    `依頼者: ${body.requester_user_id}`,
    `理由: ${body.reason}`,
  ].join('\n'));

  return { request_id: body.request_id, status: REQUEST_STATUS.CANCELLED };
}

function adminDeleteRequest_(body) {
  required_(body, ['request_id', 'admin_user_id']);
  assertAdmin_(body.admin_user_id);
  updateRequest_(body.request_id, { is_deleted: '1', deleted_at: nowIso_(), deleted_by: body.admin_user_id });
  return { request_id: body.request_id, deleted: true };
}

function listRequests_(body) {
  const scope = body.scope || 'all'; // all|sent|received
  const userId = body.user_id || '';
  const includeDeleted = body.include_deleted === true;
  const rows = getRowsAsObjects_(SHEETS.REQUESTS).filter(r => includeDeleted || String(r.is_deleted) !== '1');

  return rows.filter(r => {
    if (scope === 'sent') return String(r.requester_user_id) === String(userId);
    if (scope === 'received') return String(r.assignee_user_id) === String(userId);
    return true;
  });
}

function getKpi_(body) {
  const from = body.from ? new Date(body.from) : new Date('1970-01-01T00:00:00Z');
  const to = body.to ? new Date(body.to) : new Date();
  const groupBy = body.group_by || 'overall'; // overall|user|department

  const requests = getRowsAsObjects_(SHEETS.REQUESTS)
    .filter(r => String(r.is_deleted) !== '1')
    .filter(r => inRange_(new Date(r.created_at), from, to));

  const now = new Date();
  const base = requests.map(r => {
    const doneInTime = r.status === REQUEST_STATUS.COMPLETED && r.closed_at && new Date(r.closed_at) <= new Date(r.due_at);
    const overdue = r.status !== REQUEST_STATUS.COMPLETED && new Date(r.due_at) < now;
    return {
      request_id: r.request_id,
      assignee_user_id: r.assignee_user_id,
      assignee_department: r.assignee_department,
      completed_in_time: doneInTime ? 1 : 0,
      completed_total: r.status === REQUEST_STATUS.COMPLETED ? 1 : 0,
      overdue: overdue ? 1 : 0,
    };
  });

  if (groupBy === 'overall') return summarizeKpi_('overall', base);
  if (groupBy === 'user') return groupKpi_(base, 'assignee_user_id');
  if (groupBy === 'department') return groupKpi_(base, 'assignee_department');
  throw new Error('group_by must be overall/user/department');
}

function listTalknoteGroups_() {
  const res = callTalknoteApi_('https://api.talknote.com/api/v1/group', { method: 'get' });
  return parseMaybeJson_(res.getContentText());
}

function summarizeKpi_(key, rows) {
  const total = rows.length;
  const completed = sum_(rows, 'completed_total');
  const completedInTime = sum_(rows, 'completed_in_time');
  const overdue = sum_(rows, 'overdue');
  return {
    key,
    total_requests: total,
    completed_requests: completed,
    completed_in_time: completedInTime,
    completion_rate: rate_(completed, total),
    in_time_completion_rate: rate_(completedInTime, total),
    overdue_count: overdue,
  };
}

function groupKpi_(rows, keyName) {
  const groups = {};
  rows.forEach(r => {
    const k = r[keyName] || '(unknown)';
    groups[k] = groups[k] || [];
    groups[k].push(r);
  });
  return Object.keys(groups).map(k => summarizeKpi_(k, groups[k]));
}

function initializeSheets_() {
  ensureSheet_(SHEETS.REQUESTS, [
    'request_id', 'requester_user_id', 'requester_name', 'requester_department',
    'assignee_user_id', 'assignee_name', 'assignee_department',
    'title', 'description', 'reason', 'due_at',
    'status', 'talknote_group_id',
    'created_at', 'updated_at',
    'cancelled_at', 'cancelled_by',
    'closed_at', 'closed_by',
    'is_deleted', 'deleted_at', 'deleted_by',
  ]);
  ensureSheet_(SHEETS.RESPONSES, [
    'response_id', 'request_id', 'responder_user_id', 'response_type', 'message', 'responded_at',
  ]);
  ensureSheet_(SHEETS.EXTENSIONS, [
    'extension_id', 'request_id', 'applicant_user_id', 'current_due_at', 'proposed_due_at',
    'reason', 'status', 'approver_user_id', 'approver_message', 'requested_at', 'responded_at',
  ]);
  ensureSheet_(SHEETS.COMPLETIONS, [
    'completion_id', 'request_id', 'reporter_user_id', 'message', 'artifact_urls', 'completed_at',
  ]);
}

function getMemberByUserId_(userId) {
  const ss = SpreadsheetApp.openById(getRequiredProperty_('MASTER_SPREADSHEET_ID'));
  const sheet = ss.getSheetByName(PropertiesService.getScriptProperties().getProperty('MASTER_MEMBER_SHEET_NAME') || 'メンバー一覧');
  if (!sheet) throw new Error('master member sheet not found');

  const values = sheet.getDataRange().getValues();
  const h = values[0] || [];
  const idxUserId = h.indexOf('user_id');
  const idxName = h.indexOf('名前');
  const idxDept = h.indexOf('部署');
  if (idxUserId < 0 || idxName < 0) throw new Error('header must contain user_id and 名前');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idxUserId]) === String(userId)) {
      return {
        user_id: String(values[i][idxUserId]),
        name: String(values[i][idxName]),
        department: idxDept >= 0 ? String(values[i][idxDept]) : '',
      };
    }
  }
  throw new Error(`user_id not found: ${userId}`);
}

function postToRequestGroup_(groupId, message) {
  if (!groupId) throw new Error('talknote_group_id is required for notification');
  callTalknoteApi_('https://api.talknote.com/api/v1/group/post', {
    method: 'post',
    payload: { group_id: groupId, message },
  });
}

function callTalknoteApi_(url, opts) {
  const token = getRequiredProperty_('TALKNOTE_TOKEN');
  const retries = Number(PropertiesService.getScriptProperties().getProperty('TALKNOTE_RETRY_COUNT') || 3);
  const waitMs = Number(PropertiesService.getScriptProperties().getProperty('TALKNOTE_RETRY_WAIT_MS') || 700);

  let lastErr = '';
  for (let i = 0; i < retries; i++) {
    const res = UrlFetchApp.fetch(url, {
      method: opts.method || 'get',
      headers: { 'X-Talknote-Token': token },
      payload: opts.payload || null,
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return res;

    lastErr = `Talknote API failed: ${code} ${res.getContentText()}`;
    Utilities.sleep(waitMs * (i + 1));
  }
  throw new Error(lastErr || 'Talknote API failed');
}

function assertAssignee_(request, actorUserId) {
  if (String(request.assignee_user_id) !== String(actorUserId)) throw new Error('only assignee can perform this action');
}

function assertRequester_(request, actorUserId) {
  if (String(request.requester_user_id) !== String(actorUserId)) throw new Error('only requester can perform this action');
}

function assertAdmin_(actorUserId) {
  const admins = (PropertiesService.getScriptProperties().getProperty('ADMIN_USER_IDS') || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  if (admins.indexOf(String(actorUserId)) === -1) throw new Error('admin permission required');
}

function updateRequest_(requestId, patch) {
  patch.updated_at = nowIso_();
  updateById_(SHEETS.REQUESTS, 'request_id', requestId, patch);
}

function updateExtension_(extensionId, patch) {
  updateById_(SHEETS.EXTENSIONS, 'extension_id', extensionId, patch);
}

function updateById_(sheetName, idField, idValue, patch) {
  const sheet = getSheet_(sheetName);
  const rows = sheet.getDataRange().getValues();
  const h = rows[0] || [];
  const idxId = h.indexOf(idField);

  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][idxId]) === String(idValue)) {
      Object.keys(patch).forEach(k => {
        const idx = h.indexOf(k);
        if (idx >= 0) sheet.getRange(r + 1, idx + 1).setValue(patch[k]);
      });
      return;
    }
  }
  throw new Error(`${idField} not found: ${idValue}`);
}

function findRequest_(requestId) {
  return findById_(SHEETS.REQUESTS, 'request_id', requestId);
}

function findExtension_(extensionId) {
  return findById_(SHEETS.EXTENSIONS, 'extension_id', extensionId);
}

function findById_(sheetName, idField, idValue) {
  const rows = getRowsAsObjects_(sheetName);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][idField]) === String(idValue)) return rows[i];
  }
  throw new Error(`${idField} not found: ${idValue}`);
}

function getRowsAsObjects_(sheetName) {
  const values = getSheet_(sheetName).getDataRange().getValues();
  if (!values.length) return [];
  const h = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    h.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function ensureSheet_(name, header) {
  const sheet = getOrCreateSheet_(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(header);
}

function appendRow_(sheetName, row) {
  getSheet_(sheetName).appendRow(row);
}

function getSheet_(name) {
  const sheet = getRequestSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(`sheet not found: ${name}`);
  return sheet;
}

function getOrCreateSheet_(name) {
  const ss = getRequestSpreadsheet_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getRequestSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredProperty_('REQUEST_SPREADSHEET_ID'));
}

function getRequiredProperty_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function required_(obj, keys) {
  keys.forEach(k => {
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') throw new Error(`${k} is required`);
  });
}

function generateId_(prefix) {
  const tz = PropertiesService.getScriptProperties().getProperty('TIMEZONE') || 'Asia/Tokyo';
  const date = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${date}-${rand}`;
}

function nowIso_() {
  return new Date().toISOString();
}

function inRange_(target, from, to) {
  return target >= from && target <= to;
}

function sum_(arr, key) {
  return arr.reduce((acc, cur) => acc + Number(cur[key] || 0), 0);
}

function rate_(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function parseMaybeJson_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
