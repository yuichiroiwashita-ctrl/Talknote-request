const SHEETS = {
  REQUESTS: 'requests',
  RESPONSES: 'responses',
  EXTENSIONS: 'deadline_extensions',
  COMPLETIONS: 'completions',
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

    let result;
    switch (action) {
      case 'create_request':
        result = createRequest_(body);
        break;
      case 'respond_request':
        result = respondRequest_(body);
        break;
      case 'request_deadline_extension':
        result = requestDeadlineExtension_(body);
        break;
      case 'respond_deadline_extension':
        result = respondDeadlineExtension_(body);
        break;
      case 'report_completion':
        result = reportCompletion_(body);
        break;
      case 'get_kpi':
        result = getKpi_(body);
        break;
      default:
        return jsonOutput_({ ok: false, error: `unsupported action: ${action}` });
    }

    return jsonOutput_({ ok: true, data: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message, stack: err.stack });
  }
}

function createRequest_(body) {
  required_(body, ['requester_user_id', 'assignee_user_id', 'title', 'description', 'due_at', 'reason']);
  const requestId = generateId_('REQ');
  const now = nowIso_();

  const requester = getMemberByUserId_(body.requester_user_id);
  const assignee = getMemberByUserId_(body.assignee_user_id);

  appendRow_(SHEETS.REQUESTS, [
    requestId,
    body.requester_user_id,
    requester.name,
    body.assignee_user_id,
    assignee.name,
    body.title,
    body.description,
    body.reason,
    body.due_at,
    'requested',
    now,
    now,
  ]);

  postTalknoteMessage_([
    `【リクエスト作成】${body.title}`,
    `request_id: ${requestId}`,
    `依頼者: ${requester.name} (${body.requester_user_id})`,
    `担当者: ${assignee.name} (${body.assignee_user_id})`,
    `期日: ${body.due_at}`,
    `内容: ${body.description}`,
    `理由: ${body.reason}`,
  ].join('\n'));

  return { request_id: requestId };
}

function respondRequest_(body) {
  required_(body, ['request_id', 'responder_user_id', 'response_type', 'message']);
  const allowed = ['yes', 'no', 'conditional_yes'];
  if (allowed.indexOf(body.response_type) === -1) throw new Error('response_type must be yes/no/conditional_yes');

  const now = nowIso_();
  appendRow_(SHEETS.RESPONSES, [
    generateId_('RSP'),
    body.request_id,
    body.responder_user_id,
    body.response_type,
    body.message,
    now,
  ]);

  const nextStatus = body.response_type === 'yes' ? 'accepted' : (body.response_type === 'no' ? 'declined' : 'conditional');
  updateRequestStatus_(body.request_id, nextStatus);

  postTalknoteMessage_([
    `【リクエスト回答】${body.request_id}`,
    `回答者: ${body.responder_user_id}`,
    `回答: ${body.response_type}`,
    `内容: ${body.message}`,
  ].join('\n'));

  return { request_id: body.request_id, status: nextStatus };
}

function requestDeadlineExtension_(body) {
  required_(body, ['request_id', 'applicant_user_id', 'proposed_due_at', 'reason']);
  const extensionId = generateId_('EXT');
  const now = nowIso_();
  const req = findRequest_(body.request_id);

  appendRow_(SHEETS.EXTENSIONS, [
    extensionId,
    body.request_id,
    body.applicant_user_id,
    req.due_at,
    body.proposed_due_at,
    body.reason,
    'pending',
    '',
    '',
    now,
  ]);

  updateRequestStatus_(body.request_id, 'extension_pending');

  postTalknoteMessage_([
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
  const status = body.approved ? 'approved' : 'rejected';
  const now = nowIso_();

  updateExtension_(body.extension_id, {
    status,
    approver_user_id: body.approver_user_id,
    approver_message: body.message || '',
    responded_at: now,
  });

  if (body.approved) {
    const ext = findExtension_(body.extension_id);
    updateRequestDueAt_(body.request_id, ext.proposed_due_at);
    updateRequestStatus_(body.request_id, 'accepted');
  } else {
    updateRequestStatus_(body.request_id, 'accepted');
  }

  postTalknoteMessage_([
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
  const now = nowIso_();

  appendRow_(SHEETS.COMPLETIONS, [
    generateId_('CMP'),
    body.request_id,
    body.reporter_user_id,
    body.message,
    JSON.stringify(body.artifact_urls || []),
    now,
  ]);

  updateRequestStatus_(body.request_id, 'completed');

  postTalknoteMessage_([
    `【完了報告】${body.request_id}`,
    `報告者: ${body.reporter_user_id}`,
    `内容: ${body.message}`,
    `成果物: ${(body.artifact_urls || []).join(', ') || '(なし)'}`,
  ].join('\n'));

  return { request_id: body.request_id, status: 'completed' };
}

function getKpi_(body) {
  const from = body.from ? new Date(body.from) : new Date('1970-01-01T00:00:00Z');
  const to = body.to ? new Date(body.to) : new Date();

  const requests = getRowsAsObjects_(SHEETS.REQUESTS).filter(r => inRange_(new Date(r.created_at), from, to));
  const completions = getRowsAsObjects_(SHEETS.COMPLETIONS);
  const extensions = getRowsAsObjects_(SHEETS.EXTENSIONS);

  const completionSet = {};
  completions.forEach(c => { completionSet[c.request_id] = true; });

  const now = new Date();
  const total = requests.length;
  const completed = requests.filter(r => completionSet[r.request_id]).length;
  const overdue = requests.filter(r => !completionSet[r.request_id] && new Date(r.due_at) < now).length;

  const extInRange = extensions.filter(e => inRange_(new Date(e.requested_at), from, to));
  const extBeforeDue = extInRange.filter(e => new Date(e.requested_at) <= new Date(e.current_due_at)).length;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    total_requests: total,
    completed_requests: completed,
    completion_rate: rate_(completed, total),
    overdue_count: overdue,
    extension_request_count: extInRange.length,
    extension_requested_before_due_count: extBeforeDue,
    extension_before_due_rate: rate_(extBeforeDue, extInRange.length),
  };
}

function initializeSheets_() {
  ensureSheet_(SHEETS.REQUESTS, [
    'request_id', 'requester_user_id', 'requester_name', 'assignee_user_id', 'assignee_name',
    'title', 'description', 'reason', 'due_at', 'status', 'created_at', 'updated_at',
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
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('MASTER_SPREADSHEET_ID');
  const sheetName = props.getProperty('MASTER_MEMBER_SHEET_NAME') || 'メンバー一覧';
  if (!ssId) throw new Error('MASTER_SPREADSHEET_ID is not set');

  const ss = SpreadsheetApp.openById(ssId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`master sheet not found: ${sheetName}`);

  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idxUserId = header.indexOf('user_id');
  const idxName = header.indexOf('名前');

  if (idxUserId < 0 || idxName < 0) throw new Error('master sheet header must contain user_id and 名前');

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[idxUserId]) === String(userId)) {
      return { user_id: String(row[idxUserId]), name: String(row[idxName]) };
    }
  }

  throw new Error(`user_id not found in member list: ${userId}`);
}

function postTalknoteMessage_(message) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TALKNOTE_TOKEN');
  const mode = props.getProperty('TALKNOTE_POST_MODE') || 'group';
  const destinationId = props.getProperty('TALKNOTE_DESTINATION_ID');

  if (!token || !destinationId) {
    Logger.log('Skip Talknote post because TALKNOTE_TOKEN or TALKNOTE_DESTINATION_ID is not set.');
    return;
  }

  const endpoint = mode === 'dm'
    ? 'https://api.talknote.com/api/v1/dm/post'
    : 'https://api.talknote.com/api/v1/group/post';

  const payload = mode === 'dm'
    ? { dm_id: destinationId, message }
    : { group_id: destinationId, message };

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    payload,
    headers: { 'X-Talknote-Token': token },
    muteHttpExceptions: true,
  });

  Logger.log(`Talknote response: ${res.getResponseCode()} ${res.getContentText()}`);
}

function updateRequestStatus_(requestId, status) {
  const sheet = getSheet_(SHEETS.REQUESTS);
  const rows = sheet.getDataRange().getValues();
  const h = rows[0];
  const idxReq = h.indexOf('request_id');
  const idxStatus = h.indexOf('status');
  const idxUpdatedAt = h.indexOf('updated_at');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idxReq]) === String(requestId)) {
      sheet.getRange(i + 1, idxStatus + 1).setValue(status);
      sheet.getRange(i + 1, idxUpdatedAt + 1).setValue(nowIso_());
      return;
    }
  }
  throw new Error(`request_id not found: ${requestId}`);
}

function updateRequestDueAt_(requestId, dueAt) {
  const sheet = getSheet_(SHEETS.REQUESTS);
  const rows = sheet.getDataRange().getValues();
  const h = rows[0];
  const idxReq = h.indexOf('request_id');
  const idxDueAt = h.indexOf('due_at');
  const idxUpdatedAt = h.indexOf('updated_at');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idxReq]) === String(requestId)) {
      sheet.getRange(i + 1, idxDueAt + 1).setValue(dueAt);
      sheet.getRange(i + 1, idxUpdatedAt + 1).setValue(nowIso_());
      return;
    }
  }
  throw new Error(`request_id not found: ${requestId}`);
}

function updateExtension_(extensionId, patch) {
  const sheet = getSheet_(SHEETS.EXTENSIONS);
  const rows = sheet.getDataRange().getValues();
  const h = rows[0];
  const idxExt = h.indexOf('extension_id');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idxExt]) === String(extensionId)) {
      Object.keys(patch).forEach(key => {
        const idx = h.indexOf(key);
        if (idx >= 0) sheet.getRange(i + 1, idx + 1).setValue(patch[key]);
      });
      return;
    }
  }
  throw new Error(`extension_id not found: ${extensionId}`);
}

function findRequest_(requestId) {
  const rows = getRowsAsObjects_(SHEETS.REQUESTS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].request_id) === String(requestId)) return rows[i];
  }
  throw new Error(`request_id not found: ${requestId}`);
}

function findExtension_(extensionId) {
  const rows = getRowsAsObjects_(SHEETS.EXTENSIONS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].extension_id) === String(extensionId)) return rows[i];
  }
  throw new Error(`extension_id not found: ${extensionId}`);
}

function getRowsAsObjects_(sheetName) {
  const values = getSheet_(sheetName).getDataRange().getValues();
  if (!values.length) return [];
  const header = values[0];
  return values.slice(1).map(row => {
    const o = {};
    header.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
}

function ensureSheet_(name, header) {
  const sheet = getOrCreateSheet_(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }
}

function appendRow_(name, row) {
  getSheet_(name).appendRow(row);
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
  const ssId = PropertiesService.getScriptProperties().getProperty('REQUEST_SPREADSHEET_ID');
  if (!ssId) throw new Error('REQUEST_SPREADSHEET_ID is not set');
  return SpreadsheetApp.openById(ssId);
}

function required_(obj, keys) {
  keys.forEach(k => {
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') {
      throw new Error(`${k} is required`);
    }
  });
}

function generateId_(prefix) {
  const d = new Date();
  const tz = PropertiesService.getScriptProperties().getProperty('TIMEZONE') || 'Asia/Tokyo';
  const date = Utilities.formatDate(d, tz, 'yyyyMMdd-HHmmss');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${date}-${rand}`;
}

function inRange_(target, from, to) {
  return target >= from && target <= to;
}

function rate_(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function nowIso_() {
  return new Date().toISOString();
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
