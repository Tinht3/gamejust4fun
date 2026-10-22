// Hàm máy chủ: nhận câu lệnh (và ảnh) từ trang trò chơi, gọi Claude API bằng khoá bí mật,
// trả về chữ AI viết. Khoá API chỉ nằm trên Netlify, trình duyệt không bao giờ thấy.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default async (req) => {
  // Trang hỏi trước: có cần mã dùng AI không, đã có khoá API chưa
  if (req.method === 'GET') return json({ needPass: !!process.env.APP_PASSCODE, hasKey: !!process.env.ANTHROPIC_API_KEY });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'no_key' }, 500);

  // Mã dùng AI: chặn người lạ dùng ké tiền API của cô
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers.get('x-passcode') !== pass) return json({ error: 'bad_passcode' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const prompt = String(body.prompt || '').slice(0, 60000);
  if (!prompt) return json({ error: 'bad_request' }, 400);
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];

  const content = [];
  for (const im of images) {
    if (!im || !OK_TYPES.includes(im.type) || typeof im.data !== 'string' || im.data.length > 7000000) {
      return json({ error: 'image_rejected' }, 400);
    }
    content.push({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } });
  }
  content.push({ type: 'text', text: prompt });

  let r, data;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: 'user', content }] })
    });
    data = await r.json().catch(() => ({}));
  } catch {
    return json({ error: 'network' }, 502);
  }
  if (!r.ok) {
    const code = r.status === 429 ? 'rate_limited' : 'upstream';
    return json({ error: code, message: (data && data.error && data.error.message) || `HTTP ${r.status}` }, 502);
  }
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  if (!text) return json({ error: 'empty_completion' }, 502);
  return json({ text });
};

export const config = { path: '/api/claude' };
