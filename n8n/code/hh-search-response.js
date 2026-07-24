/**
 * MARK — HeadHunter Search Response Parser
 * Version: 1.0.0
 * n8n Code node mode: Run Once for All Items
 */

const HH_SEARCH_RESPONSE_VERSION = '1.0.0';

function text(value) {
  return String(value ?? '').trim();
}

function stripHtml(value) {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function responseBody(json) {
  return json && typeof json.body === 'object' && json.body !== null
    ? json.body
    : json;
}

function workFormatIds(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item?.id)).filter(Boolean)
    : [];
}

const output = [];
const seen = new Set();

for (const inputItem of $input.all()) {
  const response = inputItem?.json ?? {};
  const statusCode = Number(response.statusCode ?? 200);
  const body = responseBody(response);

  if (statusCode < 200 || statusCode >= 300 || !body || !Array.isArray(body.items)) {
    const errorType = text(body?.errors?.[0]?.type || body?.description || 'invalid_response');
    throw new Error(`HH search failed (${statusCode}): ${errorType}`);
  }

  for (const vacancy of body.items) {
    const sourceId = text(vacancy?.id);
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);

    const requirement = stripHtml(vacancy?.snippet?.requirement);
    const responsibility = stripHtml(vacancy?.snippet?.responsibility);
    const areaName = text(vacancy?.area?.name);
    const apiUrl = text(vacancy?.url) || `https://api.hh.ru/vacancies/${sourceId}`;
    const publicUrl = text(vacancy?.alternate_url) || `https://hh.ru/vacancy/${sourceId}`;
    const formats = workFormatIds(vacancy?.work_format);

    output.push({
      json: {
        source: 'headhunter',
        source_id: sourceId,
        source_guid: `hh:${sourceId}`,
        source_state_key: `hh:${sourceId}`,
        vacancy_key: `hh:${sourceId}`,
        api_url: apiUrl,
        url: publicUrl,
        title: text(vacancy?.name),
        company: text(vacancy?.employer?.name),
        location: areaName,
        city: areaName,
        description_snippet: [requirement, responsibility].filter(Boolean).join(' '),
        hh_preview_experience_id: text(vacancy?.experience?.id),
        hh_preview_experience_name: text(vacancy?.experience?.name),
        hh_preview_work_format_ids: formats,
        published_at: text(vacancy?.published_at),
        created_at: text(vacancy?.created_at),
        salary: vacancy?.salary_range ?? vacancy?.salary ?? null,
        hh_search_response_version: HH_SEARCH_RESPONSE_VERSION,
        salary_filter_applied: false,
      },
      pairedItem: inputItem?.pairedItem,
    });
  }
}

return output;
