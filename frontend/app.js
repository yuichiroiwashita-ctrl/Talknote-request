async function callApi(action, payload = {}) {
  const apiUrl = document.getElementById('apiUrl').value.trim();
  if (!apiUrl) throw new Error('API URLを入力してください');

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, raw: text };
  }
}

function setResult(obj) {
  document.getElementById('result').textContent = JSON.stringify(obj, null, 2);
}

document.getElementById('loadGroups').addEventListener('click', async () => {
  try {
    const data = await callApi('list_talknote_groups');
    setResult(data);

    const select = document.getElementById('groupId');
    select.innerHTML = '';
    const groups = (data.data && (data.data.groups || data.data)) || [];
    groups.forEach(g => {
      const op = document.createElement('option');
      op.value = g.id || g.group_id || '';
      op.textContent = `${g.name || g.title || '(no name)'} (${op.value})`;
      select.appendChild(op);
    });
  } catch (err) {
    setResult({ ok: false, error: err.message });
  }
});

document.getElementById('createRequest').addEventListener('click', async () => {
  try {
    const data = await callApi('create_request', {
      requester_user_id: document.getElementById('requester').value.trim(),
      assignee_user_id: document.getElementById('assignee').value.trim(),
      title: document.getElementById('title').value.trim(),
      description: document.getElementById('description').value.trim(),
      reason: document.getElementById('reason').value.trim(),
      due_at: document.getElementById('dueAt').value.trim(),
      talknote_group_id: document.getElementById('groupId').value,
    });
    setResult(data);
  } catch (err) {
    setResult({ ok: false, error: err.message });
  }
});

document.getElementById('respondRequest').addEventListener('click', async () => {
  try {
    const data = await callApi('respond_request', {
      request_id: document.getElementById('rspRequestId').value.trim(),
      responder_user_id: document.getElementById('responder').value.trim(),
      response_type: document.getElementById('responseType').value,
      message: document.getElementById('responseMessage').value.trim(),
    });
    setResult(data);
  } catch (err) {
    setResult({ ok: false, error: err.message });
  }
});
