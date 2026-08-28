/**
 * Thin client for an OpenAI-compatible chat endpoint.
 *
 * Everything that calls this must work without it: when no key is configured
 * (or the provider is down) the caller falls back to its own rule base, so the
 * workshop never sees a dead screen because a third party is unavailable.
 */
import config from '../config.js';

export const aiConfigured = () => config.ai.configured;

export const aiModelName = () => (config.ai.configured ? config.ai.model : null);

function extractJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  // Models sometimes wrap JSON in ```json fences or add a sentence around it.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Asks the model for a JSON object.
 * Returns `{ ok, data, model, error }` — it never throws, so a provider outage
 * degrades to the local path instead of a 500.
 */
export async function aiJson({ system, user, images = [], maxTokens = 900, model = null } = {}) {
  if (!config.ai.configured) return { ok: false, error: 'ai_not_configured' };

  const content = images.length
    ? [
        { type: 'text', text: user },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : user;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

  try {
    const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: model || (images.length ? config.ai.visionModel : config.ai.model),
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[ai] provider replied ${response.status}: ${body.slice(0, 200)}`);
      return { ok: false, error: `provider_${response.status}` };
    }

    const payload = await response.json();
    const data = extractJson(payload?.choices?.[0]?.message?.content);
    if (!data) return { ok: false, error: 'unparseable_response' };
    return { ok: true, data, model: payload?.model ?? config.ai.model };
  } catch (error) {
    console.warn(`[ai] request failed: ${error.message}`);
    return { ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}
