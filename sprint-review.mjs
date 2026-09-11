const REPOSITORY = 'hydroslide/live_storytelling';
const DRAFT_PREFIX = 'live-storytelling:sprint-feedback:';
const clean = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim();

export function sprintIdFromSearch(search = '') { return new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('sprint'); }
export function resolvePublicSprint(catalog, sprintId) { return catalog?.sprints?.find((sprint) => sprint.id === clean(sprintId)) ?? null; }
export function draftKey(sprintId) { return `${DRAFT_PREFIX}${clean(sprintId)}`; }
export function loadDraft(storage, sprintId) { try { return JSON.parse(storage?.getItem(draftKey(sprintId)) || '{}'); } catch { return {}; } }
export function saveDraft(storage, sprintId, draft) { try { storage?.setItem(draftKey(sprintId), JSON.stringify(draft)); return true; } catch { return false; } }

export function createFeedbackSubmissionPayload({ sprint, answers = {}, generalFeedback = '' }) {
  if (!/^SPRINT-\d{3}$/.test(sprint?.id ?? '') || !Number.isInteger(sprint?.demoRevision) || sprint.demoRevision < 1) throw new TypeError('A public sprint ID and positive demo revision are required.');
  const questions = sprint.questions ?? []; const allowedIds = new Set(questions.map((question) => question.id));
  if (!questions.length || Object.keys(answers).some((id) => !allowedIds.has(id))) throw new TypeError('Every feedback answer must belong to this sprint.');
  const normalized = Object.fromEntries(questions.map((question) => {
    const response = answers[question.id]; const choice = clean(response?.choice); const other = clean(response?.other);
    if (!question.choices?.includes(choice)) throw new TypeError('Choose one listed answer for every question.');
    if (choice === 'Other' && !other) throw new TypeError('Add an Other detail before continuing.');
    return [question.id, { choice, other: choice === 'Other' ? other : '' }];
  }));
  return { schemaVersion: 1, sprintId: sprint.id, demoRevision: sprint.demoRevision, answers: normalized, generalFeedback: clean(generalFeedback) };
}

export function feedbackSubmissionMarker(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `<!-- outcome-sprint-feedback:v1 ${json} -->`;
}

export function parseFeedbackSubmissionMarker(markdown) {
  const match = /<!-- outcome-sprint-feedback:v1 (\{[\s\S]*?\}) -->/.exec(markdown); if (!match) throw new TypeError('Sprint feedback marker is missing.');
  const payload = JSON.parse(match[1]); const keys = ['schemaVersion', 'sprintId', 'demoRevision', 'answers', 'generalFeedback'];
  if (!payload || Object.keys(payload).length !== keys.length || keys.some((key) => !Object.hasOwn(payload, key)) || payload.schemaVersion !== 1 || !/^SPRINT-\d{3}$/.test(payload.sprintId) || !Number.isInteger(payload.demoRevision) || payload.demoRevision < 1 || typeof payload.generalFeedback !== 'string' || !payload.answers || typeof payload.answers !== 'object' || Array.isArray(payload.answers)) throw new TypeError('Sprint feedback marker is invalid.');
  for (const answer of Object.values(payload.answers)) if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).length !== 2 || typeof answer.choice !== 'string' || typeof answer.other !== 'string') throw new TypeError('Sprint feedback marker is invalid.');
  return payload;
}

export function serializeFeedback({ sprint, answers = {}, generalFeedback = '' }) {
  const payload = createFeedbackSubmissionPayload({ sprint, answers, generalFeedback });
  const rows = [`# Sprint feedback: ${sprint.id}`, '', '## Review metadata', `- Sprint ID: ${sprint.id}`, `- Demo revision: ${sprint.demoRevision}`, '', '## Answers'];
  for (const question of sprint.questions ?? []) { const response = answers[question.id] ?? {}; rows.push('', `### ${question.prompt}`, `- Answer: ${clean(response.choice) || 'No response'}`); if (clean(response.other)) rows.push(`- Other: ${clean(response.other)}`); }
  rows.push('', '## General feedback', clean(generalFeedback) || 'No general feedback provided.', '', feedbackSubmissionMarker(payload)); return rows.join('\n');
}

export function createGitHubIssueUrl({ sprint, answers, generalFeedback, repository = REPOSITORY }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError('A GitHub owner/repository path is required.');
  const issue = new URL(`https://github.com/${repository}/issues/new`); issue.searchParams.set('title', `[Sprint Feedback] ${sprint.id}`); issue.searchParams.set('labels', 'sprint-feedback'); issue.searchParams.set('body', serializeFeedback({ sprint, answers, generalFeedback })); return issue.toString();
}
export async function copyFeedback(markdown, clipboard) { try { if (!clipboard?.writeText) throw new Error('Clipboard unavailable'); await clipboard.writeText(markdown); return { copied: true, fallback: false }; } catch { return { copied: false, fallback: true, text: markdown }; } }

function node(document, tag, props = {}, content = '') { const value = document.createElement(tag); Object.entries(props).forEach(([key, prop]) => { if (key === 'className') value.className = prop; else if (key.startsWith('data-')) value.setAttribute(key, prop); else value[key] = prop; }); if (content) value.textContent = content; return value; }
function list(document, title, values) { const section = node(document, 'section', { className: 'review-card' }); section.append(node(document, 'h2', {}, title)); const items = node(document, 'ul'); values.forEach((value) => items.append(node(document, 'li', {}, value))); section.append(items); return section; }
function prose(document, title, value) { const section = node(document, 'section', { className: 'review-card' }); section.append(node(document, 'h2', {}, title), node(document, 'p', {}, value)); return section; }

export function mountSprintReview(document, catalog, { location = globalThis.location, storage = globalThis.localStorage, clipboard = globalThis.navigator?.clipboard, open = globalThis.open } = {}) {
  const root = document.querySelector('[data-sprint-review]'); if (!root) return null; const sprint = resolvePublicSprint(catalog, sprintIdFromSearch(location?.search ?? '')); root.replaceChildren();
  if (!sprint) { root.append(node(document, 'section', { className: 'review-card error' }, 'This sprint is not in the public review allowlist.')); return null; }
  const draft = loadDraft(storage, sprint.id); const header = node(document, 'header', { className: 'hero' });
  header.append(node(document, 'p', { className: 'eyebrow' }, `${sprint.id} · ${sprint.state === 'archived' ? 'Archived review' : 'Current sprint'}`), node(document, 'h1', { id: 'sprint-title' }, sprint.theme), node(document, 'p', { className: 'lede' }, sprint.goal), node(document, 'a', { className: 'button', href: sprint.demonstration.url, target: '_blank', rel: 'noreferrer' }, 'Open demonstration'));
  root.append(header, prose(document, 'Why it matters', sprint.whyItMatters), prose(document, 'Narrative', sprint.narrative), list(document, 'Exact navigation and test steps', sprint.navigationSteps), list(document, 'Expected behavior', sprint.expectedBehavior), list(document, 'What should wow Ryan', sprint.wowPoints), list(document, 'Limitations', sprint.limitations), prose(document, 'Candidate next direction', sprint.candidateNextDirection));
  const form = node(document, 'form', { className: 'review-card feedback', noValidate: true }); form.append(node(document, 'h2', {}, 'Share sprint feedback'), node(document, 'p', { className: 'muted' }, `Feedback is retained in this browser temporarily and opens a prefilled GitHub Issue for ${sprint.id}.`));
  for (const question of sprint.questions) { const set = node(document, 'fieldset'); set.append(node(document, 'legend', {}, question.prompt)); for (const choice of question.choices.filter((choice) => choice !== 'Other')) { const label = node(document, 'label', { className: 'choice' }); label.append(node(document, 'input', { type: 'radio', name: question.id, value: choice, checked: draft.answers?.[question.id]?.choice === choice }), document.createTextNode(choice)); set.append(label); } const otherChoice = node(document, 'label', { className: 'choice' }); otherChoice.append(node(document, 'input', { type: 'radio', name: question.id, value: 'Other', checked: draft.answers?.[question.id]?.choice === 'Other' }), document.createTextNode('Other')); set.append(otherChoice); const otherLabel = node(document, 'label', { className: 'other' }, 'Other detail'); otherLabel.append(node(document, 'input', { type: 'text', name: `${question.id}-other`, value: draft.answers?.[question.id]?.other ?? '', maxLength: 1000 })); set.append(otherLabel); form.append(set); }
  const generalLabel = node(document, 'label', { className: 'general' }, 'General feedback'); const general = node(document, 'textarea', { name: 'general-feedback', rows: 6, maxLength: 5000, value: draft.generalFeedback ?? '' }); generalLabel.append(general); form.append(generalLabel);
  const actions = node(document, 'div', { className: 'actions' }); const submit = node(document, 'button', { type: 'submit' }, 'Review and submit on GitHub'); const copy = node(document, 'button', { type: 'button', className: 'secondary' }, 'Copy feedback'); actions.append(submit, copy); form.append(actions); const status = node(document, 'p', { className: 'status', role: 'status', ariaLive: 'polite' }); const fallback = node(document, 'textarea', { className: 'copy-fallback', readOnly: true, hidden: true, rows: 10, ariaLabel: 'Feedback to copy manually' }); form.append(status, fallback); root.append(form);
  const state = () => ({ answers: Object.fromEntries(sprint.questions.map((question) => [question.id, { choice: form.querySelector(`input[name="${question.id}"]:checked`)?.value ?? '', other: form.elements[`${question.id}-other`]?.value ?? '' }])), generalFeedback: general.value }); const persist = () => saveDraft(storage, sprint.id, state()); form.addEventListener('input', persist); form.addEventListener('change', persist);
  form.addEventListener('submit', (event) => { event.preventDefault(); const response = state(); persist(); try { open?.(createGitHubIssueUrl({ sprint, ...response, repository: catalog.repository ?? REPOSITORY }), '_blank', 'noopener,noreferrer'); status.textContent = 'Opening a prefilled GitHub Issue. Your local draft remains available here.'; } catch (error) { status.textContent = error.message; } });
  copy.addEventListener('click', async () => { let markdown; try { markdown = serializeFeedback({ sprint, ...state() }); } catch (error) { status.textContent = error.message; return; } persist(); const result = await copyFeedback(markdown, clipboard); if (result.copied) { fallback.hidden = true; status.textContent = 'Feedback copied. Your local draft remains available here.'; } else { fallback.hidden = false; fallback.value = result.text; fallback.focus(); fallback.select(); status.textContent = 'Clipboard access was unavailable. Copy the selected feedback manually.'; } }); return sprint;
}
export async function bootSprintReview({ documentRef = document, fetchImpl = fetch } = {}) { const response = await fetchImpl(new URL('./sprints.json', import.meta.url)); if (!response.ok) throw new Error('PUBLIC_SPRINT_CATALOG_UNAVAILABLE'); return mountSprintReview(documentRef, await response.json()); }
if (typeof document !== 'undefined') bootSprintReview().catch(() => { const root = document.querySelector('[data-sprint-review]'); if (root) root.textContent = 'Public sprint review data is unavailable.'; });
